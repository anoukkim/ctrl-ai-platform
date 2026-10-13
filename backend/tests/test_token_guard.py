"""token-guard: the per-reply cap, the long-history warning, the daily cap.

Everything runs on the mock provider, which honors `max_tokens` (one
character = one token, like its usage figures), so the capped flow runs
end to end with no key.
"""

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import AuditLog, ChatLimits, ChatMessage, ChatRole, UsageEvent
from app.models.chat import ChatMessageStatus
from app.services import chat_limits as limits_service
from app.services import usage as usage_service
from app.services.pricing import Price
from tests.test_chat import (
    CountingProvider,  # noqa: F401 — re-exported fixture dependency
    config,  # noqa: F401
    counting,  # noqa: F401
    events_of,
    new_conversation,
    reply_text,
    send,
    use_settings,
)

pytestmark = pytest.mark.usefixtures("config")


def set_limits(db: Session, reply: int = 100, history: int = 8_000, daily: int = 0) -> None:
    db.add(
        ChatLimits(reply_cap_krw=reply, long_history_tokens=history, daily_cap_krw=daily)
    )
    db.commit()


PRICE = Price(
    model_id="claude-sonnet-5-5",
    input_usd_per_mtok=Decimal("2"),
    output_usd_per_mtok=Decimal("10"),
    usd_krw=Decimal("1400"),
)
CACHED = Price(
    model_id="claude-sonnet-5-5",
    input_usd_per_mtok=Decimal("2"),
    output_usd_per_mtok=Decimal("10"),
    usd_krw=Decimal("1400"),
    cache_ttl="5m",
)


# ------------------------------------------------------------ the arithmetic


def test_output_budget_is_what_the_cap_buys_after_the_input() -> None:
    # 100원 = 100/1400 USD ≈ $0.0714286. 1,000 input tokens at $2/MTok
    # cost $0.002, leaving $0.0694286 → 6,942 output tokens at $10/MTok.
    assert limits_service.output_budget(PRICE, 100, 1_000) == 6_942


def test_output_budget_prices_input_as_a_cache_write_when_caching_is_on() -> None:
    # The same input costs 1.25x with the 5-minute cache: $0.0025,
    # leaving $0.0689286 → 6,892 tokens. Never dearer than assumed.
    assert limits_service.output_budget(CACHED, 100, 1_000) == 6_892


def test_output_budget_is_zero_when_the_input_alone_reaches_the_cap() -> None:
    # 3원 ≈ $0.00214; 1,000 cache-write tokens cost $0.0025 — over.
    assert limits_service.output_budget(CACHED, 3, 1_000) == 0


def test_history_cost_uses_the_cache_read_price_when_caching_is_on() -> None:
    # 10,000 tokens: cache read at $0.20/MTok (a tenth of input) = $0.002
    # = 2.8원 → 3원 ceiling; without caching, input price $0.02 = 28원.
    assert limits_service.history_cost_krw(CACHED, 10_000) == 3
    assert limits_service.history_cost_krw(PRICE, 10_000) == 28


def test_kst_day_window() -> None:
    from datetime import timezone

    # 2026-10-14 01:00 KST == 2026-10-13 16:00 UTC: the KST day started
    # 2026-10-13 15:00 UTC.
    moment = datetime(2026, 10, 13, 16, 0, tzinfo=timezone.utc)
    assert limits_service.kst_day_start(moment) == datetime(
        2026, 10, 13, 15, 0, tzinfo=timezone.utc
    )


# ----------------------------------------------------------- the capped reply


def test_a_capped_reply_is_saved_charged_and_marked(
    client: TestClient, budgeted, db_session: Session, counting  # noqa: F811
) -> None:
    """A tiny cap turns into a tiny max_tokens; the mock stops at it."""
    # The ~1,830-token input (mostly the system prompt), priced as a
    # cache write, costs about 6.4원. A 7원 cap leaves ~40 output tokens —
    # fewer than the mock's 74-character fallback reply — so the cap, not
    # the 4,096 global limit, cuts the reply.
    set_limits(db_session, reply=7)
    conversation = new_conversation(client)

    response = send(client, conversation, "안녕하세요")
    assert response.status_code == 200, response.text
    events = events_of(response.text)
    done = dict(events)["done"]

    saved = done["message"]
    assert saved is not None
    assert saved["status"] == "truncated"
    assert saved["capped_krw"] == 7
    # Charged for the tokens actually used — a real usage event, priced
    # within the cap (the cap bounds the true cost by construction).
    assert done["charged_krw"] >= 1
    event = db_session.query(UsageEvent).one()
    assert event.charged_krw == done["charged_krw"]
    assert event.charged_krw <= 7

    # Something genuinely arrived before the cap cut the reply off.
    assert reply_text(events)


def test_the_global_output_limit_is_not_reported_as_the_cap(
    client: TestClient, budgeted, db_session: Session, counting  # noqa: F811
) -> None:
    """A reply cut by CHAT_MAX_OUTPUT_TOKENS carries no capped_krw."""
    set_limits(db_session, reply=0)  # cap off
    use_settings(chat_max_output_tokens=10)
    conversation = new_conversation(client)

    response = send(client, conversation, "안녕하세요")
    saved = dict(events_of(response.text))["done"]["message"]
    assert saved["status"] == "truncated"
    assert saved["capped_krw"] is None


def test_input_alone_over_the_cap_is_refused_free(
    client: TestClient, budgeted, db_session: Session, counting  # noqa: F811
) -> None:
    set_limits(db_session, reply=1)
    conversation = new_conversation(client)

    response = send(client, conversation, "가" * 3_000)

    assert response.status_code == 400
    assert "1회 비용 한도" in response.json()["detail"]
    assert "새 대화" in response.json()["detail"]
    assert counting.calls == 0, "the provider must not be called"
    assert db_session.query(UsageEvent).count() == 0
    # The message was not saved either — nothing to pay for, nothing kept.
    assert db_session.query(ChatMessage).count() == 0


def test_the_default_cap_leaves_ordinary_replies_alone(
    client: TestClient, budgeted, db_session: Session, counting  # noqa: F811
) -> None:
    """With no row at all, the 200원 default is in force but a short mock
    reply finishes normally."""
    conversation = new_conversation(client)
    response = send(client, conversation, "안녕하세요")
    saved = dict(events_of(response.text))["done"]["message"]
    assert saved["status"] == "complete"
    assert saved["capped_krw"] is None


# ------------------------------------------------------ long-history warning


def fill_history(db: Session, client: TestClient, conversation_id: int, chars: int) -> None:
    """Insert a past exchange big enough to pass a low threshold."""
    from app.models import Conversation

    conversation = db.get(Conversation, conversation_id)
    for role, text in [(ChatRole.USER, "가" * chars), (ChatRole.ASSISTANT, "답" * 200)]:
        db.add(
            ChatMessage(
                conversation_id=conversation_id,
                user_id=conversation.user_id,
                role=role,
                content=text,
                status=ChatMessageStatus.COMPLETE,
            )
        )
    db.commit()


def test_the_warning_appears_over_the_threshold_with_its_figures(
    client: TestClient, budgeted, db_session: Session, counting  # noqa: F811
) -> None:
    set_limits(db_session, history=1_000)
    conversation = new_conversation(client)
    fill_history(db_session, client, conversation, chars=2_000)

    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    warning = detail["long_history"]
    assert warning is not None
    assert warning["history_tokens"] >= 2_000
    assert warning["extra_krw"] >= 1

    # And the done event refreshes it after a reply.
    response = send(client, conversation, "계속 이야기해 줘")
    done = dict(events_of(response.text))["done"]
    assert done["long_history"] is not None
    assert done["long_history"]["extra_krw"] >= 1


def test_no_warning_below_the_threshold_or_when_off(
    client: TestClient, budgeted, db_session: Session, counting  # noqa: F811
) -> None:
    set_limits(db_session, history=1_000)
    conversation = new_conversation(client)
    assert client.get(f"/api/chat/conversations/{conversation}").json()["long_history"] is None

    fill_history(db_session, client, conversation, chars=2_000)
    set_limits(db_session, history=0)  # switched off
    assert client.get(f"/api/chat/conversations/{conversation}").json()["long_history"] is None


# --------------------------------------------------------------- daily cap


def test_the_daily_cap_counts_every_feature_and_resets_at_kst_midnight(
    db_session: Session, dev_user, budgeted
) -> None:
    set_limits(db_session, daily=1_000)

    # 600원 of chat and 300원 of video today — different features, one day.
    for amount, provider, feature in [(600, "claude", "chat"), (300, "higgsfield", "video_generate")]:
        usage_service.charge(
            db_session, user=dev_user, amount_krw=amount, provider=provider, feature=feature
        )

    with pytest.raises(usage_service.InsufficientBudgetError) as caught:
        usage_service.ensure_affordable(db_session, user=dev_user, amount_krw=200)
    assert "오늘" in str(caught.value)

    # 100원 still fits under the 1,000원 day.
    usage_service.ensure_affordable(db_session, user=dev_user, amount_krw=100)

    # Yesterday's spending (23:00 KST = 14:00 UTC the same calendar day)
    # does not count: move one event before KST midnight.
    event = db_session.query(UsageEvent).filter_by(charged_krw=600).one()
    event.created_at = limits_service.kst_day_start() - timedelta(hours=1)
    db_session.commit()
    usage_service.ensure_affordable(db_session, user=dev_user, amount_krw=200)


def test_the_daily_cap_refuses_at_the_endpoint_with_nothing_spent(
    client: TestClient, budgeted, db_session: Session, dev_user, counting  # noqa: F811
) -> None:
    set_limits(db_session, daily=500)
    usage_service.charge(
        db_session, user=dev_user, amount_krw=499, provider="claude", feature="chat"
    )
    conversation = new_conversation(client)

    response = send(client, conversation, "안녕하세요")

    assert response.status_code == 402
    assert "오늘" in response.json()["detail"]
    assert counting.calls == 0
    assert db_session.query(UsageEvent).count() == 1  # only the setup charge


def test_a_daily_cap_of_zero_is_off(db_session: Session, dev_user, budgeted) -> None:
    set_limits(db_session, daily=0)
    usage_service.charge(
        db_session, user=dev_user, amount_krw=90_000, provider="claude", feature="chat"
    )
    usage_service.ensure_affordable(db_session, user=dev_user, amount_krw=5_000)


# ----------------------------------------------------------- the admin screen


def test_the_limits_are_an_audited_admin_setting(
    client: TestClient, db_session: Session, config  # noqa: F811
) -> None:
    before = client.get("/api/admin/claude-pricing").json()["chat_limits"]
    # The defaults, with no row at all (the cap is 200원 since the owner's
    # morning decision of 2026-10-14 — 100원 could not fit 페이지 읽기).
    assert before == {
        "reply_cap_krw": 200,
        "long_history_tokens": 8_000,
        "daily_cap_krw": 0,
        "provider_concurrency": 3,
        "web_fetch_max_uses": 1,
        "web_fetch_max_content_tokens": 10_000,
        "set_at": None,
        "set_by_username": "",
    }

    response = client.post(
        "/api/admin/claude-pricing/chat-limits",
        json={
            "reply_cap_krw": 300,
            "long_history_tokens": 10_000,
            "daily_cap_krw": 3_000,
            "provider_concurrency": 3,
            "web_fetch_max_uses": 2,
            "web_fetch_max_content_tokens": 8_000,
        },
    )
    assert response.status_code == 200, response.text
    after = response.json()["chat_limits"]
    assert (after["reply_cap_krw"], after["long_history_tokens"], after["daily_cap_krw"]) == (
        300,
        10_000,
        3_000,
    )
    assert (after["web_fetch_max_uses"], after["web_fetch_max_content_tokens"]) == (2, 8_000)
    assert after["set_by_username"] == "dev"

    row = db_session.query(AuditLog).filter_by(action="chat_limits.set").one()
    assert "답장 1회 한도 200원" in row.summary
    assert row.detail["before"]["reply_cap_krw"] == 100

    # History is rows: a second change keeps the first.
    client.post(
        "/api/admin/claude-pricing/chat-limits",
        json={
            "reply_cap_krw": 150,
            "long_history_tokens": 10_000,
            "daily_cap_krw": 0,
            "provider_concurrency": 3,
            "web_fetch_max_uses": 1,
            "web_fetch_max_content_tokens": 10_000,
        },
    )
    assert db_session.query(ChatLimits).count() == 2
    assert limits_service.current(db_session).reply_cap_krw == 150

    # Typo bounds.
    assert (
        client.post(
            "/api/admin/claude-pricing/chat-limits",
            json={
                "reply_cap_krw": -1,
                "long_history_tokens": 0,
                "daily_cap_krw": 0,
                "provider_concurrency": 3,
            },
        ).status_code
        == 422
    )
