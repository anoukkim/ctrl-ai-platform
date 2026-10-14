"""live-cost-display — the running estimate, the receipt, the live wallet.

The screen's arithmetic lives in the frontend; what these tests pin down
is the data it is fed:

* the `start` event carries the estimate's two halves,
* the `done` event's `usage` and `charged_krw` are the ledger's figures,
  and `wallet_remaining_krw` is the wallet after that same charge,
* reading a conversation back attaches each reply's receipt from its
  usage event, so receipts survive a reload.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import QuarterAllocation, UsageEvent
from app.services.chat_models import default_model
from app.services.pricing import price_for
from tests.test_chat import events_of, new_conversation, send
from app.services.accounting import receipt_fields

TOKEN_KEYS = (
    "input_tokens", "output_tokens", "cache_write_tokens", "cache_read_tokens",
    "web_search_count", "tool_fee_krw",
)
SPLIT_KEYS = (
    "input_krw", "cache_write_krw", "cache_read_krw", "output_krw", "tool_krw",
    "cache_saved_krw", "split_estimated",
)


@pytest.fixture
def config():
    settings = Settings(app_env="development", chat_mock_delay_ms=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def one(events: list[tuple[str, dict]], name: str) -> dict:
    payloads = [data for event, data in events if event == name]
    assert len(payloads) == 1, f"{name}: {len(payloads)}개"
    return payloads[0]


def test_the_start_event_carries_the_estimate(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "표로 정리해 줘").text)

    estimate = one(events, "start")["estimate"]
    assert estimate["base_krw"] >= 1

    price = price_for(db_session, default_model(db_session, config), cache_ttl=config.cache_ttl)
    assert estimate["won_per_1k_output"] == pytest.approx(
        float(price.output_usd_per_mtok * price.usd_krw) / 1000
    )
    assert estimate["won_per_1k_output"] > 0


def test_the_done_event_reports_the_ledgers_figures(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "안녕하세요").text)
    done = one(events, "done")

    event = db_session.scalars(select(UsageEvent)).one()
    assert done["charged_krw"] == event.charged_krw
    assert {key: done["usage"][key] for key in TOKEN_KEYS} == {
        "input_tokens": event.input_tokens,
        "output_tokens": event.output_tokens,
        "cache_write_tokens": event.cache_write_tokens,
        "cache_read_tokens": event.cache_read_tokens,
        # chat-plus-tools: no tool ran here.
        "web_search_count": 0,
        "tool_fee_krw": 0,
    }
    # cost-clarity: the same reply in won, by part, from the ledger row.
    assert {key: done["usage"][key] for key in SPLIT_KEYS} == receipt_fields(event)

    db_session.refresh(budgeted)
    assert done["wallet_remaining_krw"] == budgeted.remaining_krw
    assert done["wallet_remaining_krw"] == budgeted.budget_krw - event.charged_krw


def test_reading_the_conversation_attaches_each_replys_receipt(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    send(client, conversation, "안녕하세요")

    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    event = db_session.scalars(select(UsageEvent)).one()

    mine, reply = detail["messages"]
    assert mine["receipt"] is None
    assert reply["receipt"] == {
        "input_tokens": event.input_tokens,
        "output_tokens": event.output_tokens,
        "cache_write_tokens": event.cache_write_tokens,
        "cache_read_tokens": event.cache_read_tokens,
        # chat-plus-tools: no tool ran here, so no 검색 line.
        "web_search_count": 0,
        "tool_fee_krw": 0,
        "charged_krw": event.charged_krw,
        # cost-clarity: the won split, identical on reload.
        **receipt_fields(event),
    }


def test_a_conversation_without_charges_has_no_receipts(
    client: TestClient, budgeted, config
) -> None:
    conversation = new_conversation(client)
    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    assert detail["messages"] == []


def test_the_estimate_base_prices_input_as_the_precheck_does(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    """With caching on, the base prices the input as a cache write.

    The same text costs more as a write than as plain input, and the
    start event's base must reflect the dearer figure — otherwise the
    running estimate starts below what the pre-check reserved.
    """
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "가" * 2000).text)
    base = one(events, "start")["estimate"]["base_krw"]

    price = price_for(db_session, default_model(db_session, config), cache_ttl=config.cache_ttl)
    # 2,000 글자는 입력 어림 2,000토큰 이상 — 쓰기 가격이 일반 입력보다 비싸다.
    plain = price.krw(2000, 0)
    write = price.krw(0, 0, cache_write_tokens=2000)
    assert write > plain
    assert base >= write  # 시스템 프롬프트가 더해져 더 크다


def test_a_personal_funded_charge_carries_no_wallet_figure(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    """Review round 2, finding 3.

    The done event's wallet figure is the 동아리 지원 wallet. A charge the
    personal balance paid (top-ups on) leaves that wallet untouched but
    makes the *personal* figures stale — so the event must carry None and
    send the screen back to refetch, never an unchanged community number.
    """
    from app.services.wallet import get_or_create_balance

    settings = Settings(app_env="development", chat_mock_delay_ms=0, personal_topup_enabled=True)
    app.dependency_overrides[get_settings] = lambda: settings

    budgeted.consumed_krw = budgeted.budget_krw - 1  # 지갑에 1원만 남김
    balance = get_or_create_balance(db_session, budgeted.user_id)
    balance.balance_krw = 500_000
    balance.overage_enabled = True
    db_session.commit()

    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "안녕하세요").text)
    done = one(events, "done")

    event = db_session.scalars(select(UsageEvent)).one()
    assert event.funding_source.value == "personal"
    assert done["charged_krw"] == event.charged_krw
    assert done["usage"] is not None  # 영수증은 그대로 — 장부에 있으니까
    assert done["wallet_remaining_krw"] is None  # 지갑 숫자는 들고 오지 않는다


def test_no_ledger_row_means_no_receipt(
    client: TestClient, db_session: Session, budgeted, config, dev_user
) -> None:
    """Review round 2, finding 4: the quarter closed while streaming.

    finish_turn writes no usage event, so the done payload must carry no
    usage either — a 0원 receipt would claim a charge the ledger does not
    have, and vanish on reload.
    """
    from datetime import datetime, timezone

    from app.models import (
        ChatMessage,
        ChatMessageStatus,
        ChatRole,
        Conversation,
        Quarter,
        QuarterStatus,
    )
    from app.services import chat as chat_service
    from app.services.claude_provider import ChatRequest

    conversation = Conversation(user_id=dev_user.id, title="분기 끝")
    db_session.add(conversation)
    db_session.flush()
    mine = ChatMessage(
        conversation_id=conversation.id,
        user_id=dev_user.id,
        role=ChatRole.USER,
        content="안녕",
        status=ChatMessageStatus.COMPLETE,
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(mine)
    db_session.commit()

    model = default_model(db_session, config)
    turn = chat_service.PreparedTurn(
        conversation_id=conversation.id,
        user_id=dev_user.id,
        user_message=mine,
        request=ChatRequest(
            system="s",
            messages=[{"role": "user", "content": "안녕"}],
            max_tokens=100,
            model=model.model_id,
            cache_ttl=None,
        ),
        price=price_for(db_session, model),
        model_id=model.model_id,
        estimated_input_tokens=10,
    )
    state = chat_service.TurnState(
        raw_text="답장", input_tokens=10, output_tokens=5, stop_reason="end_turn"
    )

    # 스트림 도중 분기가 닫혔다: 더 이상 현재 분기가 없다.
    quarter = db_session.get(Quarter, budgeted.quarter_id)
    quarter.status = QuarterStatus.CLOSED
    db_session.commit()

    result = chat_service.finish_turn(db_session, config, turn, state)

    assert result.charged_krw == 0
    assert result.usage is None
    assert result.wallet_remaining_krw is None
    assert db_session.scalars(select(UsageEvent)).first() is None
    # 답장 자체는 회원의 것이라 저장된다.
    assert result.message is not None
