"""app-ai-web-search (owner, 2026-10-19): `ctrlai.ai.ask({ webSearch: true })`.

Anthropic's server web search, search only, at most 3 searches a call,
paid by the visitor inside the 1,000원 cap — the fee and room for results
reserved up front, the fee charged per billed search, the count on the
usage row. Off when the admin has web search off for the model. Mock only.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import BuilderProject, ChatModel, UsageEvent
from app.services import app_ai
from tests.test_app_platform_p2 import config, headers, shop, sign_in  # noqa: F401


def search_on(db_session: Session, on: bool = True) -> None:
    for row in db_session.query(ChatModel).all():
        row.tools_web_search = on
    db_session.commit()


def test_a_search_call_charges_the_fee_and_records_the_count(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted, monkeypatch
) -> None:
    search_on(db_session)
    seen = {}
    real = app_ai.run

    async def spy(provider, prepared):
        seen["tools"], seen["uses"] = prepared.request.tools, prepared.request.search_max_uses
        async for item in real(provider, prepared):
            yield item

    monkeypatch.setattr(app_ai, "run", spy)
    sign_in(client, shop)
    response = client.post(
        "/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "가능한 사랑 검색해 줘", "webSearch": True}
    )
    assert response.status_code == 200, response.text
    assert seen == {"tools": ("web_search",), "uses": app_ai.WEB_SEARCH_MAX_USES}
    event = db_session.query(UsageEvent).one()
    assert event.web_search_count == 2 and event.tool_fee_krw > 0  # the mock bills two searches
    assert event.charged_krw == response.json()["chargedKrw"] > event.tool_fee_krw


def test_without_the_option_nothing_searches(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted, monkeypatch
) -> None:
    search_on(db_session)
    seen = {}
    real = app_ai.run

    async def spy(provider, prepared):
        seen["tools"] = prepared.request.tools
        async for item in real(provider, prepared):
            yield item

    monkeypatch.setattr(app_ai, "run", spy)
    sign_in(client, shop)
    client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "검색해 줘"})
    assert seen["tools"] == ()
    assert db_session.query(UsageEvent).one().web_search_count is None


def test_the_estimate_reserves_the_searches_inside_the_cap(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted
) -> None:
    search_on(db_session)
    plain = client.post("/_ctrlai/v1/ai/estimate", headers=headers(shop), json={"prompt": "영화"}).json()
    searching = client.post(
        "/_ctrlai/v1/ai/estimate", headers=headers(shop), json={"prompt": "영화", "webSearch": True}
    ).json()
    assert searching["maxKrw"] > plain["maxKrw"] and searching["typicalKrw"] > plain["typicalKrw"]
    assert searching["maxKrw"] <= app_ai.CALL_CAP_KRW


def test_web_search_off_for_the_model_is_refused_before_anything_is_spent(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted
) -> None:
    search_on(db_session, False)
    sign_in(client, shop)
    refused = client.post(
        "/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "검색해 줘", "webSearch": True}
    )
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "web_search_off"
    assert db_session.query(UsageEvent).count() == 0


def test_a_json_retry_does_not_search_again(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted, monkeypatch
) -> None:
    search_on(db_session)
    tools = []
    real = app_ai.run

    async def spy(provider, prepared):
        tools.append(prepared.request.tools)
        async for item in real(provider, prepared):
            yield item

    monkeypatch.setattr(app_ai, "run", spy)
    sign_in(client, shop)
    schema = {"type": "object", "required": ["shop"], "properties": {"shop": {"type": "string"}}}
    client.post(
        "/_ctrlai/v1/ai/ask", headers=headers(shop),
        json={"prompt": "MOCK_BAD_JSON 검색", "json": schema, "webSearch": True},
    )
    assert tools == [("web_search",), ()]
