"""PART F (audit-caching-and-distribution): one club key, many members.

The guards that keep one member — or one incident — from eating the
club's single Anthropic key: the process-wide concurrency limit, the
out-of-credit path (free, Korean, visible to the admin with its reason),
and the monthly budget bar.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import (
    ChatLimits,
    MembershipStatus,
    Quarter,
    QuarterAllocation,
    QuarterStatus,
    UsageEvent,
    UsageFeature,
)
from app.services import provider_limiter, providers
from app.services.quarters import set_membership
from tests.test_chat import events_of, new_conversation, send


@pytest.fixture
def config():
    settings = Settings(app_env="development", chat_mock_delay_ms=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def budgeted(db_session: Session, dev_user):
    quarter = Quarter(
        code="2026-Q4",
        display_name="2026 Q4",
        starts_at=date(2026, 10, 1),
        ends_at=date(2026, 12, 31),
        status=QuarterStatus.ACTIVE,
        subsidy_limit_krw=100_000,
    )
    db_session.add(quarter)
    db_session.flush()
    set_membership(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)
    allocation = QuarterAllocation(
        user_id=dev_user.id, quarter_id=quarter.id, budget_krw=100_000
    )
    db_session.add(allocation)
    db_session.commit()
    return allocation


@pytest.fixture(autouse=True)
def all_slots_free():
    """A test must never inherit another test's held slot."""
    while provider_limiter.active_calls() > 0:
        provider_limiter.release()
    yield
    while provider_limiter.active_calls() > 0:
        provider_limiter.release()


# ------------------------------------------------------------- the limiter


def test_the_limiter_counts_waits_and_recovers() -> None:
    assert provider_limiter.acquire(2, wait_seconds=0)
    assert provider_limiter.acquire(2, wait_seconds=0)
    assert provider_limiter.active_calls() == 2
    # Full: an immediate ask is refused…
    assert not provider_limiter.acquire(2, wait_seconds=0)
    # …and a raised limit applies to the very next ask, no restart.
    assert provider_limiter.acquire(3, wait_seconds=0)
    provider_limiter.release()
    provider_limiter.release()
    provider_limiter.release()
    assert provider_limiter.active_calls() == 0
    assert provider_limiter.acquire(1, wait_seconds=0)
    provider_limiter.release()


def test_a_full_limiter_refuses_a_reply_in_korean_charging_nothing(
    client: TestClient, db_session: Session, budgeted, config, monkeypatch
) -> None:
    db_session.add(
        ChatLimits(
            reply_cap_krw=100,
            long_history_tokens=8_000,
            daily_cap_krw=0,
            provider_concurrency=1,
        )
    )
    db_session.commit()
    monkeypatch.setattr(provider_limiter, "WAIT_SECONDS", 0.05)

    assert provider_limiter.acquire(1, wait_seconds=0)  # someone else's stream
    try:
        conversation = new_conversation(client)
        events = events_of(send(client, conversation, "안녕하세요").text)
    finally:
        provider_limiter.release()

    kinds = [kind for kind, _ in events]
    assert "error" in kinds and "done" not in kinds
    detail = dict(events)["error"]
    assert "지금 CTRL+AI에 요청이 많습니다" in detail["detail"]
    assert detail["kind"] == "busy"
    # Nothing charged, and the refusal is ours — the provider status board
    # must not blame Claude for a call that was never made.
    assert db_session.query(UsageEvent).count() == 0
    status = providers.all_status(db_session).get("claude")
    assert status is None or status.last_error_kind != "busy"
    # The slot count is back to zero: the refused call leaked nothing.
    assert provider_limiter.active_calls() == 0


def test_a_reply_releases_its_slot(client: TestClient, db_session, budgeted, config) -> None:
    conversation = new_conversation(client)
    send(client, conversation, "안녕하세요")
    assert provider_limiter.active_calls() == 0


# -------------------------------------------------------- out of credit


def test_out_of_credit_is_free_korean_and_named_on_the_dashboard(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "[mock-error:credit] 안녕").text)

    detail = dict(events)["error"]
    assert "크레딧이 바닥" in detail["detail"]
    assert db_session.query(UsageEvent).count() == 0

    # The dashboard names the reason — with a real provider selected, the
    # alert reads "Claude — 크레딧 소진", not just a name.
    real = Settings(
        app_env="development",
        chat_mock_delay_ms=0,
        claude_provider="anthropic",
        anthropic_api_key="test-not-a-key",
    )
    app.dependency_overrides[get_settings] = lambda: real
    body = client.get("/api/admin/dashboard").json()
    assert any("크레딧 소진" in name for name in body["failing_providers"]), body[
        "failing_providers"
    ]


# ------------------------------------------------- the monthly budget bar


def test_budget_shows_the_months_anthropic_dollars_against_the_setting(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    config.anthropic_monthly_budget_usd = "10"
    db_session.add(
        UsageEvent(
            user_id=budgeted.user_id,
            quarter_id=budgeted.quarter_id,
            funding_source="community",
            provider="claude",
            feature=UsageFeature.CHAT.value,
            model_id="claude-sonnet-5-5",
            charged_krw=1_400,
            provider_cost=Decimal("1.25"),
            provider_currency="USD",
            created_at=datetime.now(timezone.utc),
        )
    )
    db_session.commit()

    body = client.get(f"/api/admin/quarters/{budgeted.quarter_id}/budget").json()
    from datetime import timedelta

    assert body["anthropic_month_usd"] == pytest.approx(1.25)
    assert body["anthropic_month_budget_usd"] == pytest.approx(10.0)
    kst_month = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m")
    assert body["anthropic_month"] == kst_month


def test_the_concurrency_setting_is_saved_audited_and_bounded(
    client: TestClient, db_session: Session, config
) -> None:
    saved = client.post(
        "/api/admin/claude-pricing/chat-limits",
        json={
            "reply_cap_krw": 100,
            "long_history_tokens": 8_000,
            "daily_cap_krw": 0,
            "provider_concurrency": 5,
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["chat_limits"]["provider_concurrency"] == 5

    # 0 would stop every provider call outright — refused at the schema.
    refused = client.post(
        "/api/admin/claude-pricing/chat-limits",
        json={
            "reply_cap_krw": 100,
            "long_history_tokens": 8_000,
            "daily_cap_krw": 0,
            "provider_concurrency": 0,
        },
    )
    assert refused.status_code == 422
