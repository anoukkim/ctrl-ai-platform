"""Prompt caching (prompt-caching, 2026-10-13).

Three things have to hold, and all of them are checked here with the mock
and a fake transport — nothing reaches Anthropic:

* each Chat request carries the cache markers, and a later turn reads what
  an earlier one wrote, so a conversation costs less turn by turn;
* the ledger prices uncached input, cache writes and cache reads each at
  its own price, and the check *before* a call still assumes the worst;
* trimming a long conversation moves its start in steps, so the cached
  prefix survives many turns instead of being rewritten every reply.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import ChatMessage, ChatMessageStatus, ChatRole, UsageEvent
from app.services import chat as chat_service
from app.services.claude_provider import (
    AnthropicClaudeProvider,
    MockPromptCache,
    cache_minimum,
)
from app.services.pricing import Price

SONNET = dict(
    model_id="claude-sonnet-5-5",
    input_usd_per_mtok=Decimal("2"),
    output_usd_per_mtok=Decimal("10"),
    usd_krw=Decimal("1400"),
    # 0.05x of input — the official page's figure ($0.10/MTok); the first
    # seed said 0.20 (fixed by audit-caching-and-distribution).
    cache_read_usd_per_mtok=Decimal("0.10"),
)


# ------------------------------------------------------------------ pricing


def test_cache_writes_cost_more_and_reads_cost_far_less() -> None:
    five_minutes = Price(**SONNET, cache_ttl="5m")
    one_hour = Price(**SONNET, cache_ttl="1h")
    million = 1_000_000

    assert five_minutes.usd(million, 0) == Decimal("2")
    assert five_minutes.usd(0, 0, cache_write_tokens=million) == Decimal("2.5")
    assert one_hour.usd(0, 0, cache_write_tokens=million) == Decimal("4")
    assert five_minutes.usd(0, 0, cache_read_tokens=million) == Decimal("0.1")


def test_a_model_without_its_own_read_price_reads_at_a_tenth_of_input() -> None:
    price = Price(**{**SONNET, "cache_read_usd_per_mtok": None}, cache_ttl="5m")
    assert price.usd(0, 0, cache_read_tokens=1_000_000) == Decimal("0.2")


def test_opus_reads_at_a_twentieth() -> None:
    opus = Price(
        model_id="claude-opus-5-5",
        input_usd_per_mtok=Decimal("4"),
        output_usd_per_mtok=Decimal("20"),
        usd_krw=Decimal("1400"),
        cache_read_usd_per_mtok=Decimal("0.20"),
        cache_ttl="5m",
    )
    assert opus.usd(0, 0, cache_read_tokens=1_000_000) == Decimal("0.2")


def test_the_worst_case_prices_all_input_as_a_cache_write() -> None:
    cached = Price(**SONNET, cache_ttl="5m")
    uncached = Price(**SONNET)

    assert cached.worst_case_krw(10_000, 4_096) == cached.krw(0, 4_096, cache_write_tokens=10_000)
    assert cached.worst_case_krw(10_000, 4_096) > uncached.worst_case_krw(10_000, 4_096)
    assert uncached.worst_case_krw(10_000, 4_096) == uncached.krw(10_000, 4_096)


def test_the_cache_ttl_setting() -> None:
    assert Settings(chat_prompt_cache=True).cache_ttl == "5m"
    assert Settings(chat_cache_ttl="1h").cache_ttl == "1h"
    assert Settings(chat_cache_ttl="nonsense").cache_ttl == "5m"
    assert Settings(chat_prompt_cache=False, chat_cache_ttl="1h").cache_ttl is None


# ---------------------------------------------------------- request shape


def _params(cache_ttl: str | None) -> dict:
    provider = AnthropicClaudeProvider(
        Settings(anthropic_api_key="test-not-a-key", anthropic_model="claude-sonnet-5-5")
    )
    return provider.request_params(
        "SYSTEM", [{"role": "user", "content": "안녕"}], 100, "claude-sonnet-5-5", cache_ttl
    )


def test_a_one_hour_ttl_goes_on_both_breakpoints() -> None:
    body = _params("1h")
    assert body["system"] == [
        {"type": "text", "text": "SYSTEM", "cache_control": {"type": "ephemeral", "ttl": "1h"}}
    ]
    assert body["cache_control"] == {"type": "ephemeral", "ttl": "1h"}


def test_with_caching_off_nothing_is_marked() -> None:
    body = _params(None)
    assert body["system"] == "SYSTEM"
    assert "cache_control" not in body


# --------------------------------------------------------------- the mock


def test_the_mock_cache_reads_what_the_previous_turn_wrote() -> None:
    cache = MockPromptCache()
    system = "S" * 1_000
    first = [system, "질문 하나"]
    second = [system, "질문 하나", "답 하나", "질문 둘"]

    uncached, written, read = cache.bill("claude-sonnet-5-5", "5m", first, now=0)
    assert (uncached, read) == (0, 0) and written == 1_000 + len("질문 하나")

    uncached, written, read = cache.bill("claude-sonnet-5-5", "5m", second, now=60)
    assert read == 1_000 + len("질문 하나")
    assert written == len("답 하나") + len("질문 둘")
    assert uncached == 0


def test_the_mock_cache_expires_and_is_per_model() -> None:
    cache = MockPromptCache()
    blocks = ["S" * 1_000, "질문"]
    cache.bill("claude-sonnet-5-5", "5m", blocks, now=0)

    assert cache.bill("claude-opus-5-5", "5m", blocks, now=10)[2] == 0, "caches are per model"
    assert cache.bill("claude-sonnet-5-5", "5m", blocks, now=200)[2] > 0
    # A read refreshed the entry at 200, so it lives until 500.
    assert cache.bill("claude-sonnet-5-5", "5m", blocks, now=450)[2] > 0
    assert cache.bill("claude-sonnet-5-5", "5m", blocks, now=1_000)[2] == 0


def test_short_prompts_are_not_cached_below_the_model_minimum() -> None:
    cache = MockPromptCache()
    blocks = ["S" * 1_000, "질문"]
    # 1,002 tokens: enough for Sonnet 5.5 (512), not for Haiku 4.5 (4,096).
    assert cache_minimum("claude-haiku-4-5") == 4_096
    assert cache.bill("claude-haiku-4-5", "5m", blocks, now=0) == (1_002, 0, 0)
    assert cache.bill("claude-haiku-4-5", "5m", blocks, now=1)[2] == 0


# ------------------------------------------------- a conversation, end to end


@pytest.fixture
def config():
    settings = Settings(app_env="development", chat_mock_delay_ms=0, chat_rate_limit_per_minute=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def _talk(client: TestClient, turns: int) -> None:
    """One conversation of `turns` messages, through the real route."""
    conversation = client.post("/api/chat/conversations", json={}).json()["id"]
    for index in range(turns):
        response = client.post(
            f"/api/chat/conversations/{conversation}/messages",
            json={"content": f"{index}번째 질문입니다. 여행 계획을 도와 주세요."},
        )
        assert response.status_code == 200, response.text


def test_later_turns_read_the_conversation_from_the_cache(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    _talk(client, 3)

    events = db_session.query(UsageEvent).order_by(UsageEvent.id).all()
    assert len(events) == 3
    assert events[0].cache_read_tokens == 0 and events[0].cache_write_tokens > 0
    for later in events[1:]:
        # Everything up to the previous question comes from the cache.
        assert later.cache_read_tokens > events[0].cache_write_tokens / 2
        assert later.input_tokens == 0


def test_caching_makes_the_same_conversation_cheaper(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    _talk(client, 4)
    cached = [e.charged_krw for e in db_session.query(UsageEvent).order_by(UsageEvent.id)]

    db_session.query(UsageEvent).delete()
    db_session.commit()
    uncached_settings = Settings(
        app_env="development", chat_mock_delay_ms=0, chat_rate_limit_per_minute=0,
        chat_prompt_cache=False,
    )
    app.dependency_overrides[get_settings] = lambda: uncached_settings
    _talk(client, 4)
    uncached = [e.charged_krw for e in db_session.query(UsageEvent).order_by(UsageEvent.id)]

    # The first turn pays the write premium; from then on caching wins.
    assert cached[0] >= uncached[0]
    assert sum(cached[1:]) < sum(uncached[1:])


# ------------------------------------------------------- stable trimming


def _history(count: int, size: int) -> list[ChatMessage]:
    now = datetime.now(timezone.utc)
    rows = []
    for index in range(count):
        role = ChatRole.USER if index % 2 == 0 else ChatRole.ASSISTANT
        rows.append(
            ChatMessage(
                role=role,
                content=f"{index:04d}" + "가" * size,
                status=ChatMessageStatus.COMPLETE,
                created_at=now,
            )
        )
    return rows


def test_trimming_moves_the_start_in_steps_not_every_turn() -> None:
    settings = Settings(chat_context_tokens=6_000)
    starts = []
    for turns in range(2, 80, 2):
        messages, estimated = chat_service.build_context(_history(turns, 300), "새 질문", settings)
        assert messages[0]["role"] == "user"
        assert estimated <= settings.chat_context_tokens
        starts.append(messages[0]["content"][:4])

    changes = sum(1 for before, after in zip(starts, starts[1:]) if before != after)
    # A sliding window would move the start on nearly every one of these
    # 39 turns once full; in steps it moves only a handful of times.
    assert 0 < changes <= 10
    # And between moves the start — the cached prefix — is identical.
    assert len(starts) - changes > 25


def test_a_conversation_under_the_limit_is_sent_whole() -> None:
    messages, _ = chat_service.build_context(_history(6, 50), "새 질문", Settings())
    assert len(messages) == 7


# ------------------------------------------------------------------- admin


def test_admin_budget_shows_how_much_input_came_from_the_cache(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    _talk(client, 3)

    body = client.get(f"/api/admin/quarters/{budgeted.quarter_id}/budget").json()
    [claude] = body["providers"]
    events = db_session.query(UsageEvent).all()
    assert claude["cache_read_tokens"] == sum(e.cache_read_tokens for e in events) > 0
    assert claude["cache_write_tokens"] == sum(e.cache_write_tokens for e in events) > 0
    prompt = claude["input_tokens"] + claude["cache_write_tokens"] + claude["cache_read_tokens"]
    assert claude["cache_hit_rate"] == pytest.approx(claude["cache_read_tokens"] / prompt)


def test_admin_sets_a_models_cache_read_price_and_it_is_audited(
    client: TestClient, db_session: Session
) -> None:
    models = client.get("/api/admin/chat-models").json()
    haiku = next(m for m in models if m["model_id"] == "claude-haiku-4-5")
    assert Decimal(haiku["cache_read_usd_per_mtok"]) == Decimal("0.10")

    response = client.patch(
        f"/api/admin/chat-models/{haiku['id']}", json={"cache_read_usd_per_mtok": "0.08"}
    )

    assert response.status_code == 200, response.text
    assert Decimal(response.json()["cache_read_usd_per_mtok"]) == Decimal("0.08")
    from app.models import AuditLog

    logged = db_session.query(AuditLog).filter_by(action="chat_model.updated").one()
    assert "캐시 읽기 $0.08" in logged.summary


def test_admin_system_shows_the_cache_settings(client: TestClient) -> None:
    body = client.get("/api/admin/claude-pricing").json()
    assert body["prompt_cache"] is True
    assert body["cache_ttl"] == "5m"
