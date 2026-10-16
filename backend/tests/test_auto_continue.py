"""feat-auto-continue (owner-polish 11, 2026-10-16): a reply that stops at
the call cap is continued by the server, in the same bubble, until it ends
— each call charged on its own, the wallet checked before each, the whole
reply held under the admin's 전체 한도; 중지 still stops at once.

Mock Claude and a fake Anthropic transport only — no real API call.
"""

import json

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import chat as chat_route
from app.core.config import Settings
from app.models import AuditLog, ChatLimits, ChatMessage, ChatMessageStatus, UsageEvent
from app.services import chat as chat_service
from app.services import depth as depth_service
from app.services.claude_provider import AnthropicClaudeProvider, mock_long_reply
from tests.test_chat import (  # noqa: F401
    SECRET,
    _sse_body,
    allocation,
    config,
    events_of,
    new_conversation,
    reply_text,
    send,
    use_settings,
)


def limits(db: Session, **medium) -> None:
    """A 보통 chat level with the smallest room, so a 3,000-character mock
    reply (one character = one token) stops at max_tokens three times."""
    row = {"max_tokens": 1024, "cap_krw": 200, "total_cap_krw": 1500, **medium}
    db.add(
        ChatLimits(
            reply_cap_krw=200, long_history_tokens=8000, daily_cap_krw=0,
            depth_levels={"chat": {"medium": row}},
        )
    )
    db.commit()


def done_of(events):
    return [data for name, data in events if name == "done"][0]


def test_a_cut_reply_is_continued_into_one_message_with_one_charge_per_call(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    limits(db_session)
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "[mock-long:3000]").text)

    # Two continuations in the same stream, each announcing the running charge.
    continues = [data for name, data in events if name == "continue"]
    assert [c["segment"] for c in continues] == [2, 3]
    assert continues[0]["charged_so_far_krw"] > 0
    assert continues[1]["charged_so_far_krw"] > continues[0]["charged_so_far_krw"]
    assert continues[0]["estimate"]["won_per_1k_output"] > 0

    # The pieces joined are the whole page — the code block closes.
    text = reply_text(events)
    assert text == mock_long_reply(3000)
    assert text.rstrip().endswith("```")

    done = done_of(events)
    assert done["segments"] == 3 and done["stop_note"] is None
    assert done["message"]["status"] == "complete" and done["message"]["segments"] == 3
    assert done["message"]["capped_krw"] is None
    rows = db_session.query(UsageEvent).order_by(UsageEvent.id).all()
    assert len(rows) == 3, "one usage.charge() per call"
    assert done["charged_krw"] == sum(row.charged_krw for row in rows) > 0
    assert done["usage"]["output_tokens"] == sum(row.output_tokens for row in rows)
    assert allocation(db_session).consumed_krw == done["charged_krw"]

    # One message, its receipt the calls added up — after a reload too.
    saved = db_session.query(ChatMessage).filter(ChatMessage.role == "assistant").one()
    assert saved.segment_event_ids == [row.id for row in rows]
    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    reply = [m for m in detail["messages"] if m["role"] == "assistant"][0]
    assert reply["segments"] == 3 and reply["content"] == text
    assert reply["receipt"]["charged_krw"] == done["charged_krw"]
    assert reply["receipt"]["output_tokens"] == done["usage"]["output_tokens"]


def test_the_whole_reply_stops_at_the_total_cap_and_says_so(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    # 전체 한도 = the call cap (30원 — enough for the input and a few hundred
    # output tokens): the first call's worst case fills the ceiling, so a
    # second call can never fit under it.
    limits(db_session, cap_krw=30, total_cap_krw=30)
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "[mock-long:3000]").text)

    assert [name for name, _ in events if name == "continue"] == []
    done = done_of(events)
    assert done["segments"] == 1
    assert done["message"]["status"] == "truncated"
    assert done["message"]["capped_krw"] == 30
    assert "전체 비용 한도" in done["stop_note"]
    assert db_session.query(UsageEvent).count() == 1
    assert 0 < len(reply_text(events)) < 3000


def test_with_continuation_off_a_cut_reply_stops_after_one_call(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    limits(db_session, total_cap_krw=0)
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "[mock-long:3000]").text)
    done = done_of(events)
    assert done["segments"] == 1 and done["stop_note"] is None
    assert done["message"]["status"] == "truncated" and done["message"]["capped_krw"] is None
    assert db_session.query(UsageEvent).count() == 1


def test_the_wallet_is_checked_before_every_call_and_a_short_wallet_stops_it(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    # Measure one cut call first (continuation off), then give the member
    # enough for about one and a half of them.
    limits(db_session, total_cap_krw=0)
    first = new_conversation(client)
    one_call = done_of(events_of(send(client, first, "[mock-long:3000]").text))["charged_krw"]
    assert one_call > 0
    limits(db_session)  # continuation back on
    wallet = allocation(db_session)
    wallet.budget_krw = wallet.consumed_krw + int(one_call * 1.6)
    db_session.commit()

    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "[mock-long:3000]").text)
    done = done_of(events)
    assert done["segments"] == 1
    assert done["message"]["status"] == "truncated" and done["message"]["capped_krw"] is None
    assert "여기까지 저장했어요" in done["stop_note"]
    assert db_session.query(UsageEvent).count() == 2
    assert allocation(db_session).consumed_krw <= allocation(db_session).budget_krw


def test_a_stop_during_a_continuation_keeps_both_calls_charged(
    db_session: Session, dev_user, budgeted, config
) -> None:
    """중지 in the second call: both calls are settled, the reply is 중지됨."""
    from tests.test_chat import _prepared

    settings = Settings(app_env="development")
    turn = _prepared(db_session, settings, dev_user)
    first = chat_service.settle_segment(
        db_session, settings, turn,
        chat_service.TurnState(raw_text="앞부분 ", input_tokens=100, output_tokens=50, stop_reason="max_tokens"),
    )
    second = chat_service.settle_segment(
        db_session, settings, turn,
        chat_service.TurnState(raw_text="뒷부분", input_tokens=160, stopped=True),
        estimated_input_tokens=160,
    )
    result = chat_service.save_reply(db_session, settings, turn, [first, second])
    assert result.message.status is ChatMessageStatus.STOPPED
    assert result.message.content == "앞부분 뒷부분"
    assert result.segments == 2
    assert db_session.query(UsageEvent).count() == 2
    assert result.charged_krw == first.charged_krw + second.charged_krw > 0


class ScriptedAnthropic:
    """A fake Messages API that answers each request from a script."""

    def __init__(self, script: list[tuple[str, str]]) -> None:
        self.script = list(script)
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        text, stop_reason = self.script.pop(0)
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=_sse_body(text, stop_reason=stop_reason)
        )


@pytest.fixture
def scripted_claude(monkeypatch, config):
    settings = use_settings(claude_provider="anthropic", anthropic_api_key=SECRET, anthropic_model="claude-sonnet-5-5")
    fake = ScriptedAnthropic([("<p>앞부분", "max_tokens"), (" 뒷부분</p>", "end_turn")])
    monkeypatch.setattr(
        chat_route,
        "get_claude_provider",
        lambda _settings: AnthropicClaudeProvider(
            settings, async_http_client=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
        ),
    )
    return fake


def test_the_real_adapter_is_asked_to_go_on_from_the_cut(
    client: TestClient, db_session: Session, budgeted, scripted_claude
) -> None:
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "길게 설명해 줘").text)

    assert reply_text(events) == "<p>앞부분 뒷부분</p>"
    assert done_of(events)["segments"] == 2
    assert len(scripted_claude.requests) == 2
    first = json.loads(scripted_claude.requests[0].content)
    second = json.loads(scripted_claude.requests[1].content)
    # The system prompt tells Claude how to continue; the second call sends
    # the partial as the assistant's turn and asks to go on from there.
    assert "[이어서]" in first["system"][0]["text"] if isinstance(first["system"], list) else "[이어서]" in first["system"]
    assert second["messages"][-2] == {"role": "assistant", "content": "<p>앞부분"}
    assert second["messages"][-1]["role"] == "user"
    assert second["messages"][-1]["content"] == chat_service.CONTINUE_PROMPT
    assert second["max_tokens"] <= first["max_tokens"]
    assert db_session.query(UsageEvent).count() == 2
    assert SECRET not in "".join(json.dumps(data) for _, data in events)


def test_the_admin_sets_the_total_cap_and_it_is_checked_and_audited(
    client: TestClient, db_session: Session, config
) -> None:
    table = depth_service.full_table(None)
    assert table["chat"]["medium"]["total_cap_krw"] == 1500 and table["builder"]["medium"]["total_cap_krw"] == 0
    with pytest.raises(ValueError, match="전체 한도"):
        depth_service.checked_table({"chat": {"high": {"cap_krw": 400, "total_cap_krw": 300}}})
    assert "전체 600/1,500/3,000/6,000원" in depth_service.summary(depth_service.checked_table({}))

    current = client.get("/api/admin/claude-pricing").json()["chat_limits"]
    payload = {
        key: current[key]
        for key in (
            "reply_cap_krw", "long_history_tokens", "daily_cap_krw", "provider_concurrency",
            "web_fetch_max_uses", "web_fetch_max_content_tokens", "web_search_max_uses",
            "app_ai_daily_cap_krw", "context_tokens", "timeout_seconds",
        )
    }
    levels = current["depth_levels"]
    levels["chat"]["medium"]["total_cap_krw"] = 2500
    response = client.post("/api/admin/claude-pricing/chat-limits", json={**payload, "depth_levels": levels})
    assert response.status_code == 200, response.text
    assert response.json()["chat_limits"]["depth_levels"]["chat"]["medium"]["total_cap_krw"] == 2500
    audit = db_session.query(AuditLog).filter(AuditLog.action == "chat_limits.set").order_by(AuditLog.id.desc()).first()
    assert "전체 600/2,500/3,000/6,000원" in audit.summary and len(audit.summary) <= 300
    # The picker learns the ceiling.
    info = client.get("/api/chat/info").json()
    sonnet = [m for m in info["models"] if m["model_id"].startswith("claude-sonnet")][0]
    assert [step["total_krw"] for step in sonnet["levels"] if step["level"] == "medium"] == [2500]
