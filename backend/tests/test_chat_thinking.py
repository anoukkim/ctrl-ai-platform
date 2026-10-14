"""chat-thinking-view — 생각 과정 보기, per conversation.

The request each model gets (the docs as checked on 2026-10-14), the
summary saved with the reply and never sent back, the ledger mark that
keeps calibration honest, and the toggle's price. Everything runs on the
mock or on the real adapter talking to a local fake transport — no request
leaves the machine.
"""

import json
import math
from decimal import Decimal

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import chat as chat_route
from app.core.config import get_settings
from app.main import app
from app.models import ChatMessage, ChatModel, ChatRole, MembershipStatus, UsageEvent
from app.services import calibration
from app.services.claude_provider import (
    HAIKU_THINKING_BUDGET,
    MOCK_THINKING,
    AnthropicClaudeProvider,
    thinking_params,
)
from app.services.quarters import set_membership
from tests.test_chat import (  # noqa: F401 — `config` is a fixture
    FakeAnthropic,
    config,
    events_of,
    new_conversation,
    reply_text,
    send,
    use_settings,
)

SUMMARY = ["질문을 정리했어요. ", "쉬운 예시를 골랐어요."]


def turn_on(client: TestClient, conversation: int, on: bool = True):
    return client.patch(f"/api/chat/conversations/{conversation}", json={"show_thinking": on})


def model_row(db: Session, model_id: str) -> ChatModel:
    return db.query(ChatModel).filter_by(model_id=model_id).one()


# ------------------------------------------------------------- the request, per model


def test_sonnet_shows_its_thinking_with_adaptive_summarized_at_the_same_effort() -> None:
    assert thinking_params("claude-sonnet-5-5", "off", "low", show=True, max_tokens=4096) == {
        "thinking": {"type": "adaptive", "display": "summarized"},
        "output_config": {"effort": "low"},
    }
    # Off stays exactly what it was: between_tools, nothing else in it.
    assert thinking_params("claude-sonnet-5-5", "off", "low", show=False, max_tokens=4096) == {
        "thinking": {"type": "between_tools"},
        "output_config": {"effort": "low"},
    }


def test_opus_only_gets_display_summarized() -> None:
    """Opus thinks anyway; showing it only changes `display`."""
    assert thinking_params("claude-opus-5-5", "off", "low", show=True, max_tokens=4096) == {
        "thinking": {"type": "adaptive", "display": "summarized"},
        "output_config": {"effort": "low"},
    }
    assert "thinking" not in thinking_params("claude-opus-5-5", "off", "low", max_tokens=4096)


def test_haiku_gets_a_budget_and_no_display_or_effort() -> None:
    assert thinking_params("claude-haiku-4-5", "off", "low", show=True, max_tokens=4096) == {
        "thinking": {"type": "enabled", "budget_tokens": HAIKU_THINKING_BUDGET}
    }
    assert HAIKU_THINKING_BUDGET >= 1024
    # A per-reply cap that leaves no room below max_tokens: no thinking
    # rather than a request the API refuses.
    assert thinking_params("claude-haiku-4-5", "off", "low", show=True, max_tokens=1500) == {}
    assert thinking_params("claude-haiku-4-5", "off", "low", show=False, max_tokens=4096) == {}


# ------------------------------------------------------------- the real adapter, offline


def _thinking_sse(summary: list[str], text: str, output_tokens: int) -> bytes:
    """A streamed reply with a summarized thinking block, as documented:
    thinking_delta pieces, then a signature_delta, then the text."""
    events = [
        ("message_start", {
            "type": "message_start",
            "message": {
                "id": "msg_think", "type": "message", "role": "assistant",
                "model": "claude-sonnet-5-5", "content": [], "stop_reason": None,
                "stop_sequence": None, "usage": {"input_tokens": 100, "output_tokens": 1},
            },
        }),
        ("content_block_start", {
            "type": "content_block_start", "index": 0,
            "content_block": {"type": "thinking", "thinking": "", "signature": ""},
        }),
        *[
            ("content_block_delta", {
                "type": "content_block_delta", "index": 0,
                "delta": {"type": "thinking_delta", "thinking": piece},
            })
            for piece in summary
        ],
        ("content_block_delta", {
            "type": "content_block_delta", "index": 0,
            "delta": {"type": "signature_delta", "signature": "c2lnbmF0dXJl"},
        }),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("content_block_start", {
            "type": "content_block_start", "index": 1,
            "content_block": {"type": "text", "text": ""},
        }),
        ("content_block_delta", {
            "type": "content_block_delta", "index": 1,
            "delta": {"type": "text_delta", "text": text},
        }),
        ("content_block_stop", {"type": "content_block_stop", "index": 1}),
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


class ThinkingFake(FakeAnthropic):
    """Answers with a thinking block when the request asked to see it."""

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body.get("thinking", {}).get("display") == "summarized" or (
            body.get("thinking", {}).get("type") == "enabled"
        ):
            self.requests.append(request)
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                content=_thinking_sse(SUMMARY, "답장입니다.", output_tokens=400),
            )
        return super().handler(request)


@pytest.fixture
def real(monkeypatch, config):  # noqa: F811 — the imported fixture
    settings = use_settings(
        claude_provider="anthropic",
        anthropic_api_key="test-not-a-real-key",
        anthropic_model="claude-sonnet-5-5",
    )
    fake = ThinkingFake()
    monkeypatch.setattr(
        chat_route,
        "get_claude_provider",
        lambda _s: AnthropicClaudeProvider(
            settings, async_http_client=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
        ),
    )
    return fake


def test_the_real_adapter_asks_for_the_summary_streams_it_and_never_sends_it_back(
    client: TestClient, db_session: Session, budgeted, real
) -> None:
    conversation = new_conversation(client)
    assert turn_on(client, conversation).json()["show_thinking"] is True

    events = events_of(send(client, conversation, "설명해 줘").text)

    body = json.loads(real.requests[0].content)
    assert body["thinking"] == {"type": "adaptive", "display": "summarized"}
    assert body["output_config"] == {"effort": "low"}
    # The summary streams as its own event, separate from the reply.
    assert "".join(data["text"] for name, data in events if name == "thinking") == "".join(SUMMARY)
    assert reply_text(events) == "답장입니다."
    done = dict(events)["done"]
    assert done["usage"]["thinking_shown"] is True
    assert done["message"]["thinking"] == "".join(SUMMARY).strip()

    # Saved with the reply, marked on the ledger row.
    reply = db_session.query(ChatMessage).filter_by(role=ChatRole.ASSISTANT).one()
    assert reply.thinking == "".join(SUMMARY).strip()
    assert reply.content == "답장입니다."
    event = db_session.query(UsageEvent).one()
    assert event.thinking_shown is True
    # Billed on the full output the API reported (thinking included).
    assert event.output_tokens == 400

    # The next request carries the history as text only — no thinking
    # block, no signature.
    send(client, conversation, "고마워")
    second = json.loads(real.requests[-1].content)
    sent = json.dumps(second["messages"], ensure_ascii=False)
    assert "thinking" not in sent and "c2lnbmF0dXJl" not in sent
    assistant = [m for m in second["messages"] if m["role"] == "assistant"]
    assert assistant and all(
        isinstance(m["content"], str)
        or all(block["type"] == "text" for block in m["content"])
        for m in assistant
    )

    # The conversation read gives the summary and the receipt's note back.
    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    first_reply = [m for m in detail["messages"] if m["role"] == "assistant"][0]
    assert first_reply["thinking"] == "".join(SUMMARY).strip()
    assert first_reply["receipt"]["thinking_shown"] is True


def test_off_keeps_between_tools_and_marks_nothing(
    client: TestClient, db_session: Session, budgeted, real
) -> None:
    conversation = new_conversation(client)
    send(client, conversation, "안녕하세요")
    body = json.loads(real.requests[0].content)
    assert body["thinking"] == {"type": "between_tools"}
    assert db_session.query(UsageEvent).one().thinking_shown is None
    assert db_session.query(ChatMessage).filter_by(role=ChatRole.ASSISTANT).one().thinking is None


@pytest.mark.parametrize(
    ("model_id", "expected"),
    [
        ("claude-opus-5-5", {"type": "adaptive", "display": "summarized"}),
        ("claude-haiku-4-5", {"type": "enabled", "budget_tokens": HAIKU_THINKING_BUDGET}),
    ],
)
def test_opus_and_haiku_requests(
    client: TestClient, db_session: Session, budgeted, real, model_id, expected
) -> None:
    row = model_row(db_session, model_id)
    conversation = client.post("/api/chat/conversations", json={"chat_model_id": row.id}).json()["id"]
    turn_on(client, conversation)
    send(client, conversation, "설명해 줘")
    body = json.loads(real.requests[0].content)
    assert body["model"] == model_id
    assert body["thinking"] == expected
    if model_id.startswith("claude-haiku"):
        assert "output_config" not in body
        assert body["thinking"]["budget_tokens"] < body["max_tokens"]
    assert db_session.query(UsageEvent).one().thinking_shown is True


# ------------------------------------------------------------- the mock


def test_the_mock_shows_numbered_steps_and_bills_them_as_output(
    client: TestClient, db_session: Session, budgeted, config  # noqa: F811
) -> None:
    plain = new_conversation(client)
    send(client, plain, "안녕하세요")
    shown = new_conversation(client)
    turn_on(client, shown)
    events = events_of(send(client, shown, "안녕하세요").text)

    steps = "".join(data["text"] for name, data in events if name == "thinking")
    assert [p for p in steps.split("\n\n") if p] == list(MOCK_THINKING)
    first, second = db_session.query(UsageEvent).order_by(UsageEvent.id).all()
    assert second.output_tokens == first.output_tokens + 300, "Sonnet: ~300 thinking tokens"
    # At the output price ($10 per million on Sonnet). The totals are not
    # compared: the second conversation reads the system prompt from cache.
    assert second.output_cost_usd - first.output_cost_usd == Decimal("0.003")


# ------------------------------------------------------------- the toggle


def test_the_toggle_is_per_conversation_and_refused_for_an_inactive_member(
    client: TestClient, db_session: Session, dev_user, budgeted, config  # noqa: F811
) -> None:
    one, two = new_conversation(client), new_conversation(client)
    turn_on(client, one)
    listed = {c["id"]: c["show_thinking"] for c in client.get("/api/chat/conversations").json()}
    assert listed == {one: True, two: False}
    assert turn_on(client, one, False).json()["show_thinking"] is False

    set_membership(db_session, dev_user.id, budgeted.quarter_id, MembershipStatus.INACTIVE)
    db_session.commit()
    assert turn_on(client, one).status_code == 403


def test_the_picker_shows_what_it_adds_before_it_is_turned_on(
    client: TestClient, db_session: Session, budgeted, config  # noqa: F811
) -> None:
    models = {m["model_id"]: m for m in client.get("/api/chat/info").json()["models"]}
    rate = Decimal("1400")

    def won(model_id: str, tokens: int) -> int:
        price = Decimal(model_row(db_session, model_id).output_usd_per_mtok)
        return math.ceil(Decimal(tokens) * price / 1_000_000 * rate)

    assert models["claude-sonnet-5-5"]["thinking_extra_krw"] == won("claude-sonnet-5-5", 300)
    assert models["claude-haiku-4-5"]["thinking_extra_krw"] == won("claude-haiku-4-5", 1024)
    # Opus thinks anyway: 추가 비용 없음.
    assert models["claude-opus-5-5"]["thinking_extra_krw"] == 0
    assert {m["thinking_basis"] for m in models.values()} == {"formula"}


def test_calibration_keeps_the_two_kinds_of_reply_apart(
    client: TestClient, db_session: Session, budgeted, config  # noqa: F811
) -> None:
    app.dependency_overrides[get_settings] = lambda: config.model_copy(
        update={"chat_rate_limit_per_minute": 100}
    )
    plain, shown = new_conversation(client), new_conversation(client)
    turn_on(client, shown)
    for _ in range(calibration.MIN_SAMPLES):
        send(client, plain, "안녕하세요")
        send(client, shown, "안녕하세요")

    ordinary = calibration.for_model(db_session, "claude-sonnet-5-5")
    assert ordinary.samples == calibration.MIN_SAMPLES, "thinking replies are not mixed in"
    extra = calibration.thinking_extra_krw(db_session, "claude-sonnet-5-5")
    assert extra is not None and extra > 0
    sonnet = {m["model_id"]: m for m in client.get("/api/chat/info").json()["models"]}[
        "claude-sonnet-5-5"
    ]
    assert sonnet["thinking_basis"] == "recent"
    assert sonnet["thinking_extra_krw"] == extra
