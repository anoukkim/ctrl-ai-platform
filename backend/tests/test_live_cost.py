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
    assert done["usage"] == {
        "input_tokens": event.input_tokens,
        "output_tokens": event.output_tokens,
        "cache_write_tokens": event.cache_write_tokens,
        "cache_read_tokens": event.cache_read_tokens,
    }

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
        "charged_krw": event.charged_krw,
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
