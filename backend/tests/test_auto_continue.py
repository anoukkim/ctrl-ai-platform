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
from app.models import AuditLog, ChatLimits, ChatMessage, ChatMessageStatus, Conversation, ProviderStatus, UsageEvent
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
    # enough for one and a little (a continuation reads the cached prompt,
    # so it costs less than the first call).
    limits(db_session, total_cap_krw=0)
    first = new_conversation(client)
    one_call = done_of(events_of(send(client, first, "[mock-long:3000]").text))["charged_krw"]
    assert one_call > 0
    limits(db_session)  # continuation back on
    wallet = allocation(db_session)
    wallet.budget_krw = wallet.consumed_krw + int(one_call * 1.2)
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
    """A fake Messages API that answers each request from a script; a step
    whose stop_reason is "error" answers with a 500 instead."""

    def __init__(self, script: list[tuple[str, str]]) -> None:
        self.script = list(script)
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        # The SDK retries a 5xx once: an exhausted script repeats its last step.
        text, stop_reason = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if stop_reason == "error":
            return httpx.Response(500, json={"type": "error", "error": {"type": "api_error", "message": "boom"}})
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=_sse_body(text, stop_reason=stop_reason)
        )


def scripted(monkeypatch, config, script):
    settings = use_settings(claude_provider="anthropic", anthropic_api_key=SECRET, anthropic_model="claude-sonnet-5-5")
    fake = ScriptedAnthropic(script)
    monkeypatch.setattr(
        chat_route,
        "get_claude_provider",
        lambda _settings: AnthropicClaudeProvider(
            settings, async_http_client=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
        ),
    )
    return fake


@pytest.fixture
def scripted_claude(monkeypatch, config):
    return scripted(monkeypatch, config, [("<p>앞부분", "max_tokens"), (" 뒷부분</p>", "end_turn")])


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


def test_a_failed_continuation_keeps_the_paid_part_and_tells_the_status_board(
    client: TestClient, db_session: Session, budgeted, monkeypatch, config
) -> None:
    """The second call fails at the provider: the first call's text and
    charge stay, the reply is cut with the reason (kept on reload), the
    failed call is not charged, and Admin › System hears of the failure."""
    scripted(monkeypatch, config, [("<p>앞부분", "max_tokens"), ("", "error")])
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "길게 설명해 줘").text)

    done = done_of(events)
    assert reply_text(events) == "<p>앞부분"
    assert done["message"]["content"] == "<p>앞부분"
    assert done["message"]["status"] == "truncated" and done["message"]["capped_krw"] is None
    assert "오류" in done["stop_note"] and "청구되지 않았어요" in done["stop_note"]
    assert done["segments"] == 2 and db_session.query(UsageEvent).count() == 1
    assert done["charged_krw"] == db_session.query(UsageEvent).one().charged_krw
    status = db_session.get(ProviderStatus, "claude")
    assert status is not None and status.last_error_at is not None
    # The reason survives a reload.
    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    reply = [m for m in detail["messages"] if m["role"] == "assistant"][0]
    assert reply["stop_note"] == done["stop_note"] and reply["segments"] == 2  # the failed call counts too


def test_nothing_to_continue_from_and_the_call_cap_stop_with_their_own_figures(
    db_session: Session, dev_user, budgeted, config
) -> None:
    from tests.test_chat import _prepared

    settings = Settings(app_env="development")
    turn = _prepared(db_session, settings, dev_user)
    assert turn.total_cap_krw == 1500 and turn.level_cap_krw == 200
    # An empty partial (the budget went to thinking): no continuation, a plain reason.
    plan = chat_service.plan_continuation(db_session, settings, turn, "", 0)
    assert isinstance(plan, chat_service.ContinuationStop) and plan.reason == "empty"
    # The partial alone fills the call cap: the stop names the call cap, and
    # the saved reply carries that figure — not the whole-reply ceiling.
    huge = "가" * 200_000
    plan = chat_service.plan_continuation(db_session, settings, turn, huge, 50)
    assert isinstance(plan, chat_service.ContinuationStop) and plan.reason == "call_cap"
    assert "1회 비용 한도(200원)" in plan.note
    segment = chat_service.settle_segment(
        db_session, settings, turn,
        chat_service.TurnState(raw_text="앞부분", input_tokens=100, output_tokens=50, stop_reason="max_tokens"),
    )
    result = chat_service.save_reply(db_session, settings, turn, [segment], stop=plan)
    assert result.message.status is ChatMessageStatus.TRUNCATED
    assert result.message.capped_krw == 200 and result.message.stop_note == plan.note


def test_a_reply_that_never_ends_stops_after_the_call_limit(
    client: TestClient, db_session: Session, budgeted, monkeypatch, config
) -> None:
    """A model that keeps stopping at max_tokens with a little text each
    time would be called until the won ceiling — hundreds of cheap calls.
    The call limit stops it first (found by the pause_turn test)."""
    scripted(monkeypatch, config, [("조금 ", "max_tokens")])  # the script repeats its last step forever
    conversation = new_conversation(client)
    events = events_of(send(client, conversation, "길게 설명해 줘").text)

    done = done_of(events)
    assert done["segments"] == chat_service.AUTO_CONTINUE_MAX_CALLS
    assert db_session.query(UsageEvent).count() == chat_service.AUTO_CONTINUE_MAX_CALLS
    assert done["message"]["status"] == "truncated"
    assert "번에 나눠 썼는데도" in done["stop_note"]
    assert reply_text(events) == "조금 " * chat_service.AUTO_CONTINUE_MAX_CALLS


# ---------------------------------------------------------- 0c review fixes


def test_the_third_call_counts_only_the_piece_the_second_wrote(
    db_session: Session, dev_user, budgeted, config
) -> None:
    """From the third call on, the call before already sent the earlier
    pieces and the request: its measured input plus the piece it wrote is
    the next call's input — never the whole partial again (0c review 1)."""
    from app.services.pricing import estimate_tokens
    from tests.test_chat import _prepared

    settings = Settings(app_env="development")
    turn = _prepared(db_session, settings, dev_user)
    first, second = "앞부분 " * 50, "가운데 " * 50
    measured = 700  # what the second call reported: history + first + the request

    # The second call plans from the first call's measure plus the whole partial and the request.
    plan2 = chat_service.plan_continuation(
        db_session, settings, turn, first, 10, measured_input_tokens=400, calls_so_far=1, raw_last_call=first
    )
    assert isinstance(plan2, chat_service.Continuation)
    assert plan2.estimate_base_krw == turn.price.worst_case_krw(
        400 + estimate_tokens(first) + estimate_tokens(chat_service.CONTINUE_PROMPT), 0
    )
    # The third: the second's measure plus only the second piece.
    plan3 = chat_service.plan_continuation(
        db_session, settings, turn, first + second, 20,
        measured_input_tokens=measured, calls_so_far=2, raw_last_call=second,
    )
    assert isinstance(plan3, chat_service.Continuation)
    assert plan3.estimate_base_krw == turn.price.worst_case_krw(measured + estimate_tokens(second), 0)
    assert plan3.estimate_base_krw < turn.price.worst_case_krw(
        measured + estimate_tokens(first + second) + estimate_tokens(chat_service.CONTINUE_PROMPT), 0
    )
    # The request itself still carries the whole partial.
    assert plan3.request.messages[-2] == {"role": "assistant", "content": first + second}


def test_a_charge_the_wallet_only_part_covered_counts_in_full_against_the_ceiling(
    db_session: Session, dev_user, budgeted, config
) -> None:
    """A call whose charge was capped to what the wallet had left (a
    concurrent charge won the race) still cost the full figure — and it is
    the cost, not the capped charge, that the whole reply's ceiling is
    held against (0c review 9)."""
    from tests.test_chat import _prepared

    settings = Settings(app_env="development")
    turn = _prepared(db_session, settings, dev_user)
    wallet = allocation(db_session)
    wallet.consumed_krw = wallet.budget_krw - 3  # 3원 left
    db_session.commit()
    segment = chat_service.settle_segment(
        db_session, settings, turn,
        chat_service.TurnState(raw_text="앞부분", input_tokens=200_000, output_tokens=100_000, stop_reason="max_tokens"),
    )
    assert segment.charged_krw == 3
    assert segment.cost_krw > segment.charged_krw
    assert segment.cost_krw == turn.price.krw(200_000, 100_000, 0, 0)
    # The ceiling sees the cost: over it, no next call — whatever the wallet took.
    plan = chat_service.plan_continuation(db_session, settings, turn, "앞부분", segment.cost_krw)
    assert isinstance(plan, chat_service.ContinuationStop) and plan.reason == "total_cap"
    # The route sums the same way.
    import inspect

    from app.api.routes import chat as route

    source = inspect.getsource(route.send_message)
    assert "cost_so_far = sum(part.cost_krw for part in segments)" in source
    assert "raw_so_far, cost_so_far," in source


def test_a_still_paused_tool_turn_names_no_cost_ceiling(
    db_session: Session, dev_user, budgeted, config
) -> None:
    """"pause_turn" is a cut, but not one money made: the saved reply carries
    no capped figure, so the screen shows the plain 잘림 note (0c review 4).
    A plain max_tokens cut with continuation off still names the call cap."""
    from tests.test_chat import _prepared

    settings = Settings(app_env="development")
    turn = _prepared(db_session, settings, dev_user)
    turn.reply_cap_krw = 200
    turn.total_cap_krw = 0
    paused = chat_service.settle_segment(
        db_session, settings, turn,
        chat_service.TurnState(raw_text="검색 중이었어요", input_tokens=100, output_tokens=20, stop_reason="pause_turn"),
    )
    result = chat_service.save_reply(db_session, settings, turn, [paused])
    assert result.message.status is ChatMessageStatus.TRUNCATED
    assert result.message.capped_krw is None and result.message.stop_note is None

    cut = chat_service.settle_segment(
        db_session, settings, turn,
        chat_service.TurnState(raw_text="앞부분", input_tokens=100, output_tokens=20, stop_reason="max_tokens"),
    )
    result = chat_service.save_reply(
        db_session, settings, turn, [cut], stop=chat_service.ContinuationStop("total_cap", "")
    )
    assert result.message.status is ChatMessageStatus.TRUNCATED
    assert result.message.capped_krw == 200


def test_a_reply_with_nothing_to_continue_from_keeps_its_reason_after_a_reload(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    """The budget went to thinking and no text came: the reply is saved
    empty with its note, so a reload still says why (0c review 5), and the
    empty message never reaches the next call's context."""
    from tests.test_chat import _prepared

    settings = Settings(app_env="development")
    turn = _prepared(db_session, settings, dev_user)
    segment = chat_service.settle_segment(
        db_session, settings, turn,
        chat_service.TurnState(raw_text="", thinking="생각만…", input_tokens=100, output_tokens=1024, stop_reason="max_tokens"),
    )
    stop = chat_service.plan_continuation(db_session, settings, turn, "", segment.cost_krw)
    assert isinstance(stop, chat_service.ContinuationStop) and stop.reason == "empty"
    result = chat_service.save_reply(db_session, settings, turn, [segment], stop=stop)
    assert result.message is not None
    assert result.message.content == "" and result.message.status is ChatMessageStatus.TRUNCATED
    assert result.message.stop_note == stop.note

    detail = client.get(f"/api/chat/conversations/{turn.conversation_id}").json()
    reply = [m for m in detail["messages"] if m["role"] == "assistant"][0]
    assert reply["content"] == "" and reply["stop_note"] == stop.note
    assert reply["receipt"] is not None and reply["receipt"]["output_tokens"] == 1024
    history = chat_service.messages_of(db_session, db_session.get(Conversation, turn.conversation_id))
    messages, _ = chat_service.build_context(history, "다시", settings)
    assert all(m["content"] != "" for m in messages)
    assert [m["role"] for m in messages][-1] == "user"


def test_reading_a_conversation_adds_the_calls_up_in_one_query(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    """Three replies of three calls each: the receipts come from one
    usage_events query, not one per reply (0c review 2)."""
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    limits(db_session)
    conversation = new_conversation(client)
    for _ in range(3):
        assert done_of(events_of(send(client, conversation, "[mock-long:3000]").text))["segments"] == 3

    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        statements.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    try:
        detail = client.get(f"/api/chat/conversations/{conversation}").json()
    finally:
        event.remove(Engine, "before_cursor_execute", record)
    replies = [m for m in detail["messages"] if m["role"] == "assistant"]
    assert len(replies) == 3 and all(m["segments"] == 3 and m["receipt"]["charged_krw"] > 0 for m in replies)
    # (The composer's calibration reads recent events too — a different query.)
    usage_reads = [s for s in statements if "FROM usage_events" in s and "usage_events.id IN" in s]
    assert len(usage_reads) == 1, usage_reads
