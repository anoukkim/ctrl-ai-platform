"""Phase 2 — Chat.

Every test runs on the mock Claude provider, or on the real adapter
talking to a local fake transport. **No request leaves the machine**, and
no test needs a key.
"""

import json
import math
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import chat as chat_route
from app.core.config import Settings, get_settings
from app.main import app
from app.models import (
    AuditLog,
    BudgetCategory,
    ChatMessage,
    ChatMessageStatus,
    ChatRole,
    Conversation,
    MembershipStatus,
    ProviderStatus,
    QuarterAllocation,
    UsageEvent,
)
from app.services import chat as chat_service
from app.services import usage as usage_service
from app.services.claude_provider import (
    AnthropicClaudeProvider,
    ChatRequest,
    ClaudeError,
    MockClaudeProvider,
    thinking_params,
)
from app.services.pricing import price_for
from app.services.quarters import set_membership
from tests.conftest import MEMBER_PASSWORD

SECRET = "sk-ant-test-THIS-MUST-NEVER-LEAK-0123456789"


@pytest.fixture
def config():
    settings = Settings(app_env="development", chat_mock_delay_ms=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def use_settings(**changes) -> Settings:
    changed = app.dependency_overrides[get_settings]().model_copy(update=changes)
    app.dependency_overrides[get_settings] = lambda: changed
    return changed


def events_of(body: str) -> list[tuple[str, dict]]:
    """Parse a Server-Sent Events body into (event, data) pairs."""
    parsed = []
    for block in body.strip().split("\n\n"):
        name, data = "", ""
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[len("event: ") :]
            elif line.startswith("data: "):
                data = line[len("data: ") :]
        if name:
            parsed.append((name, json.loads(data)))
    return parsed


def reply_text(events: list[tuple[str, dict]]) -> str:
    return "".join(data["text"] for name, data in events if name == "delta")


def new_conversation(client: TestClient) -> int:
    response = client.post("/api/chat/conversations", json={})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def send(client: TestClient, conversation_id: int, content: str):
    return client.post(
        f"/api/chat/conversations/{conversation_id}/messages", json={"content": content}
    )


def allocation(db: Session) -> QuarterAllocation:
    row = db.query(QuarterAllocation).one()
    db.refresh(row)
    return row


class CountingProvider:
    """The mock, counting how often Claude would have been called."""

    def __init__(self) -> None:
        self.inner = MockClaudeProvider()
        self.model_id = self.inner.model_id
        self.calls = 0

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator:
        self.calls += 1
        async for event in self.inner.stream_chat(request):
            yield event

    def rewrite_video_prompt(self, prompt: str, request: str):
        self.calls += 1
        return self.inner.rewrite_video_prompt(prompt, request)


@pytest.fixture
def counting(monkeypatch) -> CountingProvider:
    provider = CountingProvider()
    monkeypatch.setattr(chat_route, "get_claude_provider", lambda settings: provider)
    return provider


# ------------------------------------------------------------- conversations


def test_conversations_can_be_created_listed_renamed_and_deleted(
    client: TestClient, budgeted, config
) -> None:
    first = new_conversation(client)
    second = new_conversation(client)

    listed = client.get("/api/chat/conversations").json()
    assert {row["id"] for row in listed} == {first, second}

    renamed = client.patch(f"/api/chat/conversations/{first}", json={"title": "가계부 아이디어"})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "가계부 아이디어"

    assert client.patch(f"/api/chat/conversations/{first}", json={"title": "  "}).status_code == 400

    assert client.delete(f"/api/chat/conversations/{second}").status_code == 204
    assert [row["id"] for row in client.get("/api/chat/conversations").json()] == [first]


def test_the_first_message_names_the_conversation_and_moves_it_to_the_top(
    client: TestClient, budgeted, config
) -> None:
    older = new_conversation(client)
    newer = new_conversation(client)
    send(client, older, "가계부 앱을 만들고 싶어요\n둘째 줄은 이름에 들어가지 않습니다")

    listed = client.get("/api/chat/conversations").json()
    assert [row["id"] for row in listed] == [older, newer]
    assert listed[0]["title"] == "가계부 앱을 만들고 싶어요"


def test_another_member_cannot_see_or_touch_a_conversation(
    client: TestClient, anon_client: TestClient, other_user, other_participating, budgeted, config
) -> None:
    mine = new_conversation(client)
    send(client, mine, "안녕하세요")
    client.post("/api/auth/logout")

    anon_client.post(
        "/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD}
    )
    assert anon_client.get("/api/chat/conversations").json() == []
    # 404, not 403: the conversation's existence is not revealed.
    assert anon_client.get(f"/api/chat/conversations/{mine}").status_code == 404
    assert anon_client.patch(f"/api/chat/conversations/{mine}", json={"title": "x"}).status_code == 404
    assert anon_client.delete(f"/api/chat/conversations/{mine}").status_code == 404
    assert send(anon_client, mine, "끼어들기").status_code == 404


def test_deleting_a_conversation_keeps_its_usage_events(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    send(client, conversation, "안녕하세요")
    assert db_session.query(UsageEvent).count() == 1

    client.delete(f"/api/chat/conversations/{conversation}")

    assert db_session.query(Conversation).count() == 0
    assert db_session.query(ChatMessage).count() == 0
    event = db_session.query(UsageEvent).one()
    db_session.refresh(event)
    assert event.conversation_id is None
    assert event.charged_krw > 0


# ------------------------------------------------------------- access


def test_a_member_not_participating_can_read_but_not_send(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    conversation = new_conversation(client)
    send(client, conversation, "안녕하세요")

    set_membership(db_session, dev_user.id, budgeted.quarter_id, MembershipStatus.INACTIVE)
    db_session.commit()

    assert client.get("/api/chat/conversations").status_code == 200
    detail = client.get(f"/api/chat/conversations/{conversation}")
    assert detail.status_code == 200
    assert len(detail.json()["messages"]) == 2

    assert send(client, conversation, "또 질문").status_code == 403
    assert client.post("/api/chat/conversations", json={}).status_code == 403
    assert client.patch(
        f"/api/chat/conversations/{conversation}", json={"title": "x"}
    ).status_code == 403
    assert client.delete(f"/api/chat/conversations/{conversation}").status_code == 403


def test_signed_out_visitors_are_refused(anon_client: TestClient) -> None:
    assert anon_client.get("/api/chat/conversations").status_code == 401
    assert anon_client.post("/api/chat/conversations/1/messages", json={"content": "x"}).status_code == 401


# ------------------------------------------------------------- sending


def test_a_reply_streams_and_is_saved(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    response = send(client, conversation, "안녕하세요")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = events_of(response.text)
    names = [name for name, _ in events]
    assert names[0] == "start" and names[-1] == "done"
    assert names.count("delta") > 1, "the reply arrives in pieces"

    done = events[-1][1]
    assert done["message"]["role"] == "assistant"
    assert done["message"]["content"] == reply_text(events).strip()
    assert done["charged_krw"] > 0

    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]


def test_a_build_idea_offers_the_builder_button_without_showing_the_marker(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "가계부 앱을 만들고 싶어요").text)

    assert "[[" not in reply_text(events)
    message = events[-1][1]["message"]
    assert message["action"] == "builder"
    assert message["action_title"] == "가계부 앱을 만들고 싶어요"
    assert "[[" not in message["content"]

    video = events_of(send(client, conversation, "도쿄 야경 쇼츠 영상").text)
    assert video[-1][1]["message"]["action"] == "video"


def test_a_plain_question_offers_no_button(client: TestClient, budgeted, config) -> None:
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "안녕하세요").text)
    assert events[-1][1]["message"]["action"] is None


def test_each_reply_records_model_tokens_dollars_rate_and_won(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    done = events_of(send(client, conversation, "안녕하세요").text)[-1][1]

    event = db_session.query(UsageEvent).one()
    assert event.provider == "claude"
    assert event.feature == "chat"
    assert event.model_id == "mock"
    assert event.category.value == "build"
    assert event.funding_source.value == "community_build"
    assert event.conversation_id == conversation
    assert event.input_tokens > 0 and event.output_tokens > 0
    assert event.provider_units == event.input_tokens + event.output_tokens
    assert event.provider_unit == "tokens"
    assert event.provider_currency == "USD"
    assert event.exchange_rate_krw == 1400

    # The mock is priced as Sonnet 5.5: $2 in, $10 out per million.
    usd = (Decimal(event.input_tokens) * 2 + Decimal(event.output_tokens) * 10) / 1_000_000
    assert event.provider_cost == usd.quantize(Decimal("0.000001"))
    assert event.charged_krw == math.ceil(usd * 1400) == done["charged_krw"]
    assert allocation(db_session).build_consumed_krw == event.charged_krw

    message = db_session.query(ChatMessage).filter_by(role=ChatRole.ASSISTANT).one()
    assert message.usage_event_id == event.id


def test_the_priced_model_follows_anthropic_model(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    use_settings(anthropic_model="claude-opus-5-5")
    conversation = new_conversation(client)
    send(client, conversation, "안녕하세요")

    event = db_session.query(UsageEvent).one()
    usd = (Decimal(event.input_tokens) * 4 + Decimal(event.output_tokens) * 20) / 1_000_000
    assert event.charged_krw == math.ceil(usd * 1400)


def test_an_unaffordable_message_is_refused_before_claude_is_called(
    client: TestClient, db_session: Session, budgeted, counting, config
) -> None:
    conversation = new_conversation(client)
    budgeted.build_budget_krw = 5  # less than the worst case of one reply
    db_session.commit()

    response = send(client, conversation, "안녕하세요")

    assert response.status_code == 402
    assert "지원금이 부족" in response.json()["detail"]
    assert counting.calls == 0
    assert db_session.query(UsageEvent).count() == 0
    assert db_session.query(ChatMessage).count() == 0, "a refused message is not saved"


def test_the_budget_check_uses_the_worst_case(
    client: TestClient, db_session: Session, budgeted, counting, config
) -> None:
    """Enough for a short reply is not enough: the check assumes the longest."""
    use_settings(chat_max_output_tokens=4096)
    conversation = new_conversation(client)
    worst = price_for(db_session, "mock", config).krw(0, 4096)
    budgeted.build_budget_krw = worst - 1
    db_session.commit()

    assert send(client, conversation, "안녕").status_code == 402
    assert counting.calls == 0


@pytest.mark.parametrize(
    "kind, words",
    [
        ("auth", "AI 연결 설정"),
        ("credit", "크레딧이 바닥"),
        ("rate_limited", "요청이 많이"),
        ("timeout", "제시간에"),
        ("unavailable", "연결할 수 없습니다"),
    ],
)
def test_a_failed_call_shows_korean_and_is_never_charged(
    client: TestClient, db_session: Session, budgeted, config, kind: str, words: str
) -> None:
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, f"안녕하세요 [mock-error:{kind}]").text)

    name, data = events[-1]
    assert name == "error"
    assert data["kind"] == kind
    assert words in data["detail"]
    assert db_session.query(UsageEvent).count() == 0
    assert allocation(db_session).build_consumed_krw == 0

    # The member's message stays, unanswered; no reply is saved.
    roles = [m.role for m in db_session.query(ChatMessage).all()]
    assert roles == [ChatRole.USER]
    status_row = db_session.get(ProviderStatus, "claude")
    db_session.refresh(status_row)
    assert status_row.last_error_kind == kind


def test_after_a_failure_the_next_message_still_alternates(
    client: TestClient, db_session: Session, budgeted, counting, config
) -> None:
    conversation = new_conversation(client)
    send(client, conversation, "첫 질문 [mock-error:timeout]")

    seen: list[ChatRequest] = []
    original = counting.inner.stream_chat

    async def spy(request: ChatRequest):
        seen.append(request)
        async for event in original(request):
            yield event

    counting.inner.stream_chat = spy
    send(client, conversation, "다시 묻습니다")

    roles = [m["role"] for m in seen[0].messages]
    assert roles == ["user"], "the unanswered message is joined to the new one"
    assert "첫 질문" in seen[0].messages[0]["content"]


def test_a_refusal_is_saved_and_charged_but_offers_nothing(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    done = events_of(send(client, conversation, "[mock-refusal]").text)[-1][1]

    assert done["message"]["status"] == "refused"
    assert done["message"]["action"] is None
    assert db_session.query(UsageEvent).one().charged_krw == done["charged_krw"] > 0


def test_the_rate_limit_refuses_without_calling_claude(
    client: TestClient, db_session: Session, budgeted, counting, config
) -> None:
    use_settings(chat_rate_limit_per_minute=3)
    conversation = new_conversation(client)
    for _ in range(3):
        assert send(client, conversation, "안녕").status_code == 200

    response = send(client, conversation, "안녕")

    assert response.status_code == 429
    assert "1분에 3개" in response.json()["detail"]
    assert counting.calls == 3


def test_the_rate_limit_counts_only_the_last_minute(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    use_settings(chat_rate_limit_per_minute=1)
    conversation = new_conversation(client)
    send(client, conversation, "안녕")
    for message in db_session.query(ChatMessage).all():
        message.created_at = datetime.now(timezone.utc) - timedelta(minutes=2)
    db_session.commit()

    assert send(client, conversation, "또 안녕").status_code == 200


def test_a_missing_price_refuses_before_calling_claude(
    client: TestClient, db_session: Session, budgeted, counting, config
) -> None:
    use_settings(anthropic_model="claude-unpriced-9")
    conversation = new_conversation(client)

    response = send(client, conversation, "안녕")

    assert response.status_code == 503
    assert "가격이 등록되지 않아" in response.json()["detail"]
    assert counting.calls == 0


def test_an_overlong_message_is_refused(client: TestClient, budgeted, config) -> None:
    use_settings(chat_context_tokens=2000)
    conversation = new_conversation(client)
    response = send(client, conversation, "가" * 3000)
    assert response.status_code == 400
    assert "너무 깁니다" in response.json()["detail"]


# ------------------------------------------------------------- the turn, directly


def _prepared(db_session, settings, user, text="안녕하세요"):
    conversation = Conversation(user_id=user.id, title="")
    db_session.add(conversation)
    db_session.commit()
    return chat_service.prepare_turn(
        db_session, settings, user=user, conversation=conversation, text=text, model_id="mock"
    )


def test_a_stopped_reply_keeps_its_text_and_charges_what_was_used(
    db_session: Session, dev_user, budgeted
) -> None:
    settings = Settings(app_env="development")
    turn = _prepared(db_session, settings, dev_user)
    state = chat_service.TurnState(raw_text="여기까지 썼어요", input_tokens=900, stopped=True)

    result = chat_service.finish_turn(db_session, settings, turn, state)

    assert result.message.status is ChatMessageStatus.STOPPED
    assert result.message.content == "여기까지 썼어요"
    event = db_session.query(UsageEvent).one()
    # No output count arrived; the text received stands in for it.
    assert (event.input_tokens, event.output_tokens) == (900, len("여기까지 썼어요"))
    assert result.charged_krw == event.charged_krw > 0


def test_a_reply_stopped_before_anything_arrived_is_charged_the_estimate(
    db_session: Session, dev_user, budgeted
) -> None:
    settings = Settings(app_env="development")
    turn = _prepared(db_session, settings, dev_user)

    result = chat_service.finish_turn(
        db_session, settings, turn, chat_service.TurnState(stopped=True)
    )

    assert result.message is None, "an empty reply is not saved"
    event = db_session.query(UsageEvent).one()
    assert event.input_tokens == turn.estimated_input_tokens


def test_a_charge_that_loses_a_race_takes_what_is_left_and_records_the_full_cost(
    db_session: Session, dev_user, budgeted
) -> None:
    settings = Settings(app_env="development")
    turn = _prepared(db_session, settings, dev_user)
    # Another charge spent the money while the reply was streaming.
    budgeted.build_consumed_krw = budgeted.build_budget_krw - 3
    db_session.commit()

    state = chat_service.TurnState(
        raw_text="답", input_tokens=50_000, output_tokens=4_000, stop_reason="end_turn"
    )
    result = chat_service.finish_turn(db_session, settings, turn, state)

    event = db_session.query(UsageEvent).one()
    assert event.charged_krw == 3 == result.charged_krw
    assert event.provider_cost == Decimal("0.140000"), "the full dollar cost is still recorded"
    assert allocation(db_session).build_remaining_krw == 0


def test_a_truncated_reply_is_marked(db_session: Session, dev_user, budgeted) -> None:
    settings = Settings(app_env="development")
    turn = _prepared(db_session, settings, dev_user)
    state = chat_service.TurnState(
        raw_text="긴 답", input_tokens=10, output_tokens=4096, stop_reason="max_tokens"
    )
    result = chat_service.finish_turn(db_session, settings, turn, state)
    assert result.message.status is ChatMessageStatus.TRUNCATED


def test_charge_without_cap_still_refuses(db_session: Session, dev_user, budgeted) -> None:
    budgeted.build_consumed_krw = budgeted.build_budget_krw
    db_session.commit()
    with pytest.raises(usage_service.InsufficientBudgetError):
        usage_service.charge(
            db_session,
            user=dev_user,
            category=BudgetCategory.BUILD,
            amount_krw=1,
            provider="claude",
        )


# ------------------------------------------------------------- context


def _history(*pairs: tuple[str, str]) -> list[ChatMessage]:
    return [
        ChatMessage(
            role=ChatRole(role), content=text, status=ChatMessageStatus.COMPLETE, user_id=1,
            conversation_id=1,
        )
        for role, text in pairs
    ]


def test_the_oldest_messages_are_dropped_first_and_the_first_kept_is_the_member() -> None:
    settings = Settings(chat_context_tokens=3000)
    history = _history(
        ("user", "가" * 600),
        ("assistant", "나" * 600),
        ("user", "다" * 600),
        ("assistant", "라" * 600),
    )

    messages, estimate = chat_service.build_context(history, "마지막 질문", settings)

    assert messages[0]["role"] == "user"
    assert messages[-1] == {"role": "user", "content": "마지막 질문"}
    assert "가" * 600 not in [m["content"] for m in messages]
    assert estimate <= 3000


def test_refusals_and_empty_replies_are_left_out_of_the_context() -> None:
    history = _history(("user", "질문"), ("assistant", ""))
    history.append(
        ChatMessage(
            role=ChatRole.ASSISTANT, content="거절", status=ChatMessageStatus.REFUSED,
            user_id=1, conversation_id=1,
        )
    )
    messages, _ = chat_service.build_context(history, "다음", Settings())
    assert messages == [{"role": "user", "content": "질문\n\n다음"}]


def test_the_marker_filter_never_shows_the_marker() -> None:
    marker = chat_service.MarkerFilter()
    shown = ""
    for piece in ["좋아요! ", "시작해요.\n[", "[action:bui", "lder|가계부]]"]:
        shown += marker.feed(piece)
    shown += marker.finish()
    assert shown.strip() == "좋아요! 시작해요."
    assert chat_service.action_of(marker.raw)[0].value == "builder"


def test_text_that_only_looks_like_a_marker_is_shown_in_the_end() -> None:
    marker = chat_service.MarkerFilter()
    shown = marker.feed("목록은 [[1, 2]] 입니다")
    shown += marker.finish()
    assert shown == "목록은 [[1, 2]] 입니다"


# ------------------------------------------------------------- the real adapter, offline


def test_thinking_is_off_on_sonnet_low_effort_on_opus_and_absent_on_haiku() -> None:
    assert thinking_params("claude-sonnet-5-5", "off", "low") == {
        "thinking": {"type": "between_tools"},
        "output_config": {"effort": "low"},
    }
    assert thinking_params("claude-sonnet-5-5", "on", "low")["thinking"] == {"type": "adaptive"}
    # Opus 5.5 cannot turn thinking off: no `thinking` field, low effort.
    assert thinking_params("claude-opus-5-5", "off", "low") == {"output_config": {"effort": "low"}}
    assert thinking_params("claude-haiku-4-5", "off", "low") == {}
    # between_tools refuses xhigh/max; anything unknown falls back to low.
    assert thinking_params("claude-sonnet-5-5", "off", "max")["output_config"] == {"effort": "low"}


def _sse_body(text: str, input_tokens: int = 120, output_tokens: int = 15) -> bytes:
    events = [
        ("message_start", {
            "type": "message_start",
            "message": {
                "id": "msg_test", "type": "message", "role": "assistant",
                "model": "claude-sonnet-5-5", "content": [], "stop_reason": None,
                "stop_sequence": None,
                "usage": {"input_tokens": input_tokens, "output_tokens": 1},
            },
        }),
        ("content_block_start", {
            "type": "content_block_start", "index": 0,
            "content_block": {"type": "text", "text": ""},
        }),
        ("content_block_delta", {
            "type": "content_block_delta", "index": 0,
            "delta": {"type": "text_delta", "text": text},
        }),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn", "stop_sequence": None},
            "usage": {"output_tokens": output_tokens},
        }),
        ("message_stop", {"type": "message_stop"}),
    ]
    return "".join(
        f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n" for name, data in events
    ).encode()


class FakeAnthropic:
    """Answers the Messages API locally and remembers what it was sent."""

    def __init__(self, status: int = 200, error_message: str = "", text: str = "안녕하세요!") -> None:
        self.status = status
        self.error_message = error_message
        self.text = text
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(
                self.status,
                json={
                    "type": "error",
                    "error": {"type": "error", "message": self.error_message or "nope"},
                },
            )
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=_sse_body(self.text)
        )


@pytest.fixture
def real_claude(monkeypatch, config):
    """CLAUDE_PROVIDER=anthropic with a fake key, answered by `FakeAnthropic`."""
    settings = use_settings(
        claude_provider="anthropic",
        anthropic_api_key=SECRET,
        anthropic_model="claude-sonnet-5-5",
    )
    fake = FakeAnthropic()

    def make(_settings):
        return AnthropicClaudeProvider(
            settings, async_http_client=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
        )

    monkeypatch.setattr(chat_route, "get_claude_provider", make)
    return fake


def test_the_real_adapter_streams_and_charges_the_reported_tokens(
    client: TestClient, db_session: Session, budgeted, real_claude
) -> None:
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "안녕하세요").text)

    assert reply_text(events) == "안녕하세요!"
    body = json.loads(real_claude.requests[0].content)
    assert body["model"] == "claude-sonnet-5-5"
    assert body["thinking"] == {"type": "between_tools"}
    assert body["output_config"] == {"effort": "low"}
    assert body["max_tokens"] == 4096
    assert body["stream"] is True
    assert body["messages"] == [{"role": "user", "content": "안녕하세요"}]
    assert "Korean" in body["system"]

    event = db_session.query(UsageEvent).one()
    assert (event.model_id, event.input_tokens, event.output_tokens) == ("claude-sonnet-5-5", 120, 15)
    assert event.charged_krw == math.ceil(Decimal(120 * 2 + 15 * 10) / 1_000_000 * 1400)


@pytest.mark.parametrize(
    "status, message, kind",
    [
        (401, "invalid x-api-key", "auth"),
        (400, "Your credit balance is too low to access the Anthropic API.", "credit"),
        (429, "rate limited", "rate_limited"),
        (529, "Overloaded", "unavailable"),
    ],
)
def test_real_errors_become_korean_and_cost_nothing(
    client: TestClient, db_session: Session, budgeted, real_claude, status, message, kind
) -> None:
    real_claude.status = status
    real_claude.error_message = message
    conversation = new_conversation(client)

    response = send(client, conversation, "안녕하세요")

    name, data = events_of(response.text)[-1]
    assert (name, data["kind"]) == ("error", kind)
    assert SECRET not in response.text
    assert message not in response.text, "the provider's English stays out of the member's screen"
    assert db_session.query(UsageEvent).count() == 0


def test_the_key_never_appears_in_any_response(
    client: TestClient, db_session: Session, budgeted, real_claude
) -> None:
    conversation = new_conversation(client)
    bodies = [
        send(client, conversation, "안녕하세요").text,
        client.get("/api/chat/info").text,
        client.get("/api/chat/conversations").text,
        client.get(f"/api/chat/conversations/{conversation}").text,
        client.get("/api/admin/claude-pricing").text,
        client.get("/api/admin/providers").text,
        client.get("/api/usage/me").text,
    ]
    real_claude.status = 401
    bodies.append(send(client, conversation, "또").text)

    for body in bodies:
        assert SECRET not in body
    status_row = db_session.get(ProviderStatus, "claude")
    db_session.refresh(status_row)
    assert SECRET not in status_row.last_error_detail


def test_the_classifier_never_copies_the_provider_message() -> None:
    from app.services.claude_provider import classify

    class Fake(Exception):
        status_code = 401
        message = f"key {SECRET} is wrong"

    error = classify(Fake())
    assert isinstance(error, ClaudeError)
    assert SECRET not in str(error) and SECRET not in error.detail


# ------------------------------------------------------------- info, startup


def test_chat_info_says_test_mode_on_mock(client: TestClient, config) -> None:
    info = client.get("/api/chat/info").json()
    assert info["is_mock"] is True
    assert info["rate_limit_per_minute"] == 10


def test_a_real_provider_without_its_key_or_model_is_reported_missing() -> None:
    assert Settings(claude_provider="mock").missing_provider_settings() == []
    missing = Settings(
        claude_provider="anthropic", anthropic_api_key="", anthropic_model=""
    ).missing_provider_settings()
    assert missing == ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"]
    assert Settings(
        claude_provider="anthropic", anthropic_api_key="k", anthropic_model="claude-sonnet-5-5"
    ).missing_provider_settings() == []


# ------------------------------------------------------------- admin pricing


def test_admin_can_change_a_price_and_it_is_audited(
    client: TestClient, db_session: Session, config
) -> None:
    response = client.put(
        "/api/admin/claude-pricing/models/claude-sonnet-5-5",
        json={"input_usd_per_mtok": "3", "output_usd_per_mtok": "15"},
    )
    assert response.status_code == 200
    sonnet = next(p for p in response.json()["prices"] if p["model_id"] == "claude-sonnet-5-5")
    assert Decimal(sonnet["input_usd_per_mtok"]) == 3

    entry = db_session.query(AuditLog).filter_by(action="claude_price.updated").one()
    assert entry.detail["before"]["input_usd_per_mtok"].startswith("2")
    assert entry.detail["after"]["input_usd_per_mtok"] == "3"


def test_admin_can_add_a_model(client: TestClient, config) -> None:
    response = client.put(
        "/api/admin/claude-pricing/models/claude-new-6",
        json={"display_name": "New 6", "input_usd_per_mtok": "1.5", "output_usd_per_mtok": "7.5"},
    )
    assert response.status_code == 200
    assert "claude-new-6" in {p["model_id"] for p in response.json()["prices"]}

    bad = client.put(
        "/api/admin/claude-pricing/models/Bad Model",
        json={"input_usd_per_mtok": "1", "output_usd_per_mtok": "1"},
    )
    assert bad.status_code in (400, 404)


def test_a_new_rate_applies_to_later_charges_and_not_earlier_ones(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    send(client, conversation, "안녕")

    response = client.post("/api/admin/claude-pricing/exchange-rate", json={"krw_per_usd": "1500"})
    assert response.status_code == 200
    body = response.json()
    assert Decimal(body["exchange_rate"]["krw_per_usd"]) == 1500
    assert [Decimal(r["krw_per_usd"]) for r in body["rate_history"]] == [1500, 1400]

    send(client, conversation, "또 안녕")

    first, second = db_session.query(UsageEvent).order_by(UsageEvent.id).all()
    assert (first.exchange_rate_krw, second.exchange_rate_krw) == (1400, 1500)
    assert db_session.query(AuditLog).filter_by(action="exchange_rate.set").count() == 1


def test_pricing_admin_is_admin_only(
    anon_client: TestClient, other_user, config
) -> None:
    anon_client.post(
        "/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD}
    )
    assert anon_client.get("/api/admin/claude-pricing").status_code == 403
    assert anon_client.post(
        "/api/admin/claude-pricing/exchange-rate", json={"krw_per_usd": "1"}
    ).status_code == 403


def test_an_implausible_rate_is_refused(client: TestClient, config) -> None:
    assert client.post(
        "/api/admin/claude-pricing/exchange-rate", json={"krw_per_usd": "1.4"}
    ).status_code == 422


def test_usage_names_a_chat_charge_by_its_conversation(
    client: TestClient, budgeted, config
) -> None:
    conversation = new_conversation(client)
    send(client, conversation, "가계부 앱 질문")
    labels = [event["label"] for event in client.get("/api/usage/me").json()["events"]]
    assert labels == ["Chat — 가계부 앱 질문"]

    client.delete(f"/api/chat/conversations/{conversation}")
    labels = [event["label"] for event in client.get("/api/usage/me").json()["events"]]
    assert labels == ["Chat"]
