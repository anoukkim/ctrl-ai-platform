"""fix-composer-toolbar — the 도구 panel's prices come from the backend,
the same token prices the receipt charges."""

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import ChatModel
from app.services import pricing
from tests.test_chat import config  # noqa: F401 — fixture


def test_every_tool_price_is_served_with_the_model(
    client: TestClient, db_session: Session, budgeted, config  # noqa: F811
) -> None:
    sonnet = db_session.query(ChatModel).filter_by(model_id="claude-sonnet-5-5").one()
    options = {m["model_id"]: m for m in client.get("/api/chat/info").json()["models"]}
    option = options["claude-sonnet-5-5"]
    rate = pricing.current_rate(db_session)
    price = pricing.Price(
        model_id=sonnet.model_id,
        input_usd_per_mtok=sonnet.input_usd_per_mtok,
        output_usd_per_mtok=sonnet.output_usd_per_mtok,
        usd_krw=Decimal(rate.krw_per_unit),
    )

    assert option["web_fetch_krw_per_use"] == price.krw(pricing.TYPICAL_FETCH_TOKENS, 0) > 0
    assert option["code_execution_krw_per_use"] == price.krw(
        pricing.TYPICAL_CODE_INPUT_TOKENS, pricing.TYPICAL_CODE_OUTPUT_TOKENS
    ) > 0
    assert option["web_search_krw_per_call"] > 0
    assert option["thinking_extra_krw"] is not None
