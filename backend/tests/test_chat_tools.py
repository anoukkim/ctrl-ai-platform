"""chat-plus-tools — server tools, their switches and their money.

Mock only: no real API is called and no real fee exists, but the whole
flow — both switches, the tool status events, the sources, the per-search
fee in the ledger and inside token-guard's cap — runs keyless.
"""

from decimal import ROUND_CEILING, Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import ChatLimits, UsageEvent
from app.services import chat_tools
from app.services.chat_models import default_model
from app.services.claude_provider import (
    WEB_FETCH_MAX_CONTENT_TOKENS,
    WEB_FETCH_MAX_USES,
    WEB_SEARCH_MAX_USES,
    AnthropicClaudeProvider,
    server_tool_params,
)
from app.services.pricing import price_for
from tests.test_chat import events_of, new_conversation, send
from tests.test_live_cost import one


@pytest.fixture
def config():
    settings = Settings(app_env="development", chat_mock_delay_ms=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def open_tools(db: Session, *, search=True, fetch=True, code=True) -> None:
    """The admin's switch: open the tools on the default (Sonnet) row."""
    from app.models import ChatModel

    sonnet = db.query(ChatModel).filter_by(model_id="claude-sonnet-5-5").one()
    sonnet.tools_web_search = search
    sonnet.tools_web_fetch = fetch
    sonnet.tools_code_execution = code
    db.commit()


def turn_on(client: TestClient, conversation: int, **flags) -> dict:
    response = client.patch(f"/api/chat/conversations/{conversation}", json=flags)
    assert response.status_code == 200, response.text
    return response.json()


# ------------------------------------------------- the request mapping


def test_haiku_gets_the_older_search_tool_and_sonnet_the_new_one() -> None:
    haiku = server_tool_params(("web_search",), "claude-haiku-4-5")
    sonnet = server_tool_params(("web_search",), "claude-sonnet-5-5")

    assert haiku[0]["type"] == "web_search_20250305"
    assert sonnet[0]["type"] == "web_search_20260209"
    for block in (haiku[0], sonnet[0]):
        assert block["max_uses"] == WEB_SEARCH_MAX_USES
        assert block["user_location"]["country"] == "KR"


def test_fetch_and_code_blocks_carry_the_specs_caps() -> None:
    blocks = server_tool_params(("web_fetch", "code_execution"), "claude-sonnet-5-5")

    assert blocks[0] == {
        "type": "web_fetch_20260209",
        "name": "web_fetch",
        "max_uses": WEB_FETCH_MAX_USES,
        "max_content_tokens": WEB_FETCH_MAX_CONTENT_TOKENS,
    }
    assert blocks[1] == {"type": "code_execution_20260521", "name": "code_execution"}


def test_the_real_request_carries_tools_only_when_asked(config) -> None:
    provider = AnthropicClaudeProvider(config)
    bare = provider.request_params("s", [], 100, "claude-sonnet-5-5")
    with_tools = provider.request_params(
        "s", [], 100, "claude-sonnet-5-5", tools=("web_search",)
    )

    assert "tools" not in bare
    assert with_tools["tools"][0]["name"] == "web_search"


# ------------------------------------------------- both switches


def test_a_tool_runs_only_when_model_and_conversation_both_allow(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)

    # Member toggle without the admin switch: refused outright.
    refused = client.patch(
        f"/api/chat/conversations/{conversation}", json={"use_web_search": True}
    )
    assert refused.status_code == 400
    assert "이 모델에서는 쓸 수 없는 도구" in refused.json()["detail"]

    # Admin switch without the member toggle: no tool events, no fee.
    open_tools(db_session)
    events = events_of(send(client, conversation, "서울 인구를 검색해 줘").text)
    assert not [data for event, data in events if event == "tool"]
    event = db_session.scalars(select(UsageEvent)).one()
    assert (event.web_search_count or 0) == 0 and (event.tool_fee_krw or 0) == 0


def test_turning_a_tool_off_is_allowed_even_when_the_model_lost_it(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    open_tools(db_session)
    conversation = new_conversation(client)
    turn_on(client, conversation, use_web_search=True)

    open_tools(db_session, search=False, fetch=False, code=False)
    body = turn_on(client, conversation, use_web_search=False)
    assert body["use_web_search"] is False


# ------------------------------------------------- the money


def search_fee(db: Session, config, searches: int) -> int:
    price = price_for(db, default_model(db, config), cache_ttl=config.cache_ttl)
    return int(
        (Decimal(searches) * Decimal("0.01") * price.usd_krw).to_integral_value(
            rounding=ROUND_CEILING
        )
    )


def test_searches_are_charged_at_the_catalogue_price(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    open_tools(db_session)
    conversation = new_conversation(client)
    turn_on(client, conversation, use_web_search=True)

    events = events_of(send(client, conversation, "서울 인구를 검색해 줘").text)

    statuses = [data for event, data in events if event == "tool"]
    assert statuses == [
        {"kind": "web_search", "status": "running"},
        {"kind": "web_search", "status": "done"},
    ]

    event = db_session.scalars(select(UsageEvent)).one()
    fee = search_fee(db_session, config, 2)
    assert event.web_search_count == 2
    assert event.tool_fee_krw == fee
    # KRW = tokens as always + the fee, in one charge from one wallet.
    price = price_for(db_session, default_model(db_session, config), cache_ttl=config.cache_ttl)
    tokens_krw = price.krw(
        event.input_tokens or 0,
        event.output_tokens or 0,
        event.cache_write_tokens or 0,
        event.cache_read_tokens or 0,
    )
    assert event.charged_krw == tokens_krw + fee

    done = one(events, "done")
    assert done["usage"]["web_search_count"] == 2
    assert done["usage"]["tool_fee_krw"] == fee

    # Sources: saved with the reply and carried on the done message.
    sources = done["message"]["sources"]
    assert len(sources) == 3 and all(source["url"].startswith("http") for source in sources)
    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    assert detail["messages"][-1]["sources"] == sources
    assert detail["messages"][-1]["receipt"]["web_search_count"] == 2


def test_the_precheck_adds_max_uses_searches(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    """Tokens alone affordable, tokens + 3 searches not → refused free."""
    open_tools(db_session)
    conversation = new_conversation(client)
    turn_on(client, conversation, use_web_search=True)

    # The default reply cap would shrink max_tokens and hide the wallet
    # arithmetic this test pins down — turn it off.
    db_session.add(ChatLimits(reply_cap_krw=0, long_history_tokens=8000, daily_cap_krw=0))
    db_session.commit()

    price = price_for(db_session, default_model(db_session, config), cache_ttl=config.cache_ttl)
    # Shrink the wallet to just under the token worst case + 3 searches.
    from app.models import QuarterAllocation

    allocation = db_session.scalars(select(QuarterAllocation)).one()
    text = "서울 인구를 검색해 줘"
    from app.services.pricing import estimate_tokens
    from app.services.claude_provider import CHAT_SYSTEM_PROMPT

    token_worst = price.worst_case_krw(
        estimate_tokens(CHAT_SYSTEM_PROMPT) + estimate_tokens(text) + 4,
        config.chat_max_output_tokens,
    )
    allocation.budget_krw = token_worst + search_fee(db_session, config, WEB_SEARCH_MAX_USES) - 1
    db_session.commit()

    refused = client.post(
        f"/api/chat/conversations/{conversation}/messages", json={"content": text}
    )
    assert refused.status_code == 402
    assert db_session.scalar(select(UsageEvent)) is None
    # With the toggle off, the same message goes through the pre-check.
    turn_on(client, conversation, use_web_search=False)
    ok = client.post(f"/api/chat/conversations/{conversation}/messages", json={"content": text})
    assert ok.status_code == 200


def test_the_reply_cap_covers_tool_fees(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    open_tools(db_session)
    conversation = new_conversation(client)
    turn_on(client, conversation, use_web_search=True)

    # A cap just above the 3-search worst case: with the tool on, nothing
    # is left for output → refused free, naming the tools.
    db_session.add(
        ChatLimits(
            reply_cap_krw=search_fee(db_session, config, WEB_SEARCH_MAX_USES) + 1,
            long_history_tokens=8000,
            daily_cap_krw=0,
        )
    )
    db_session.commit()

    refused = client.post(
        f"/api/chat/conversations/{conversation}/messages", json={"content": "검색해 줘"}
    )
    assert refused.status_code == 400
    assert "도구를 끄거나" in refused.json()["detail"]
    assert db_session.scalar(select(UsageEvent)) is None


# ------------------------------------------------- refusals and errors


def test_a_member_supplied_file_id_is_refused(
    client: TestClient, budgeted, config
) -> None:
    conversation = new_conversation(client)
    response = client.post(
        f"/api/chat/conversations/{conversation}/messages",
        json={"content": "안녕", "file_ids": ["file_abc123"]},
    )
    assert response.status_code == 422


def test_a_tool_error_shows_korean_and_charges_only_tokens(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    open_tools(db_session)
    conversation = new_conversation(client)
    turn_on(client, conversation, use_web_search=True)

    events = events_of(send(client, conversation, "검색 오류 상황을 보여 줘").text)

    statuses = [data for event, data in events if event == "tool"]
    assert statuses[-1] == {"kind": "web_search", "status": "error"}
    done = one(events, "done")
    assert "검색 없이" in done["message"]["content"]

    event = db_session.scalars(select(UsageEvent)).one()
    assert (event.web_search_count or 0) == 0
    assert (event.tool_fee_krw or 0) == 0


# ------------------------------------------------- fetch and code mocks


def test_the_mock_fetches_a_page_already_in_the_conversation(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    open_tools(db_session)
    conversation = new_conversation(client)
    turn_on(client, conversation, use_web_fetch=True)

    events = events_of(
        send(client, conversation, "https://example.com/guide 를 요약해 줘").text
    )

    statuses = [data for event, data in events if event == "tool"]
    assert statuses[0]["kind"] == "web_fetch"
    done = one(events, "done")
    assert done["message"]["sources"][0]["url"] == "https://example.com/guide"
    event = db_session.scalars(select(UsageEvent)).one()
    assert (event.tool_fee_krw or 0) == 0  # fetches carry no per-call fee


def test_the_mock_runs_code_on_anthropics_side_only(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    open_tools(db_session)
    conversation = new_conversation(client)
    turn_on(client, conversation, use_code_execution=True)

    events = events_of(send(client, conversation, "1부터 100까지 합을 계산해 줘").text)

    statuses = [data for event, data in events if event == "tool"]
    assert statuses[0]["kind"] == "code_execution"
    done = one(events, "done")
    assert "5050" in done["message"]["content"]
