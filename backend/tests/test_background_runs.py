"""background-runs (owner, 2026-10-17) — a reply outlives the page.

"채팅하다 중간에 나가면 계속 돌아가?" → it does now: leaving the page (the
connection closes) no longer stops a reply; only 중지 does, from any tab.
What these tests prove, on the mock provider:

* a reply whose page went away finishes, is saved whole and is charged
  exactly what a reply watched to the end is charged — one ledger row;
* 중지 from another page (another request, no shared connection) stops it,
  and the charge is that of the text produced;
* coming back re-attaches: the live stream starts from the text so far
  and ends on the saved message, and watching never charges again;
* one running reply per member; the running dots come from the server;
* a reply or a build a restart left "running" is ended (중지, uncharged).
"""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import (
    BuilderGeneration,
    BuilderProject,
    ChatMessage,
    ChatMessageStatus,
    ChatRole,
    ChatRun,
    Conversation,
    UsageEvent,
)
from app.services import chat_runs

LONG = "[mock-long:3000] 길게 써 줘"


@pytest.fixture
def slow_config():
    """The mock streams a piece every 15 ms — long enough to leave mid-reply."""
    settings = Settings(app_env="development", chat_mock_delay_ms=15)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def new_conversation(client: TestClient) -> int:
    response = client.post("/api/chat/conversations", json={})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def read_events(lines, until: set[str]) -> list[tuple[str, dict]]:
    """Read SSE lines until one of `until` arrives (inclusive)."""
    events: list[tuple[str, dict]] = []
    name = ""
    for line in lines:
        if line.startswith("event: "):
            name = line[len("event: ") :]
        elif line.startswith("data: ") and name:
            events.append((name, json.loads(line[len("data: ") :])))
            if name in until:
                return events
            name = ""
    return events


class Leaver:
    """A page that sends, reads up to the first piece of the reply and then
    goes away — a real disconnect (`http.disconnect`), which the test
    client cannot make: closing its stream waits for the response to end.

    It drives the app on an event loop of its own, in a thread, and keeps
    that loop alive until the reply's task is done — the loop stands in for
    the server process the reply goes on in. Requests from the test client
    meanwhile arrive on another loop, as from another page."""

    def __init__(self, client: TestClient, conversation: int, text: str = LONG) -> None:
        self.cookie = "; ".join(f"{name}={value}" for name, value in client.cookies.items())
        self.conversation = conversation
        self.text = text
        self.left = threading.Event()
        self.status: int | None = None
        self.error: BaseException | None = None
        self.thread = threading.Thread(target=self._run, daemon=True)

    def __enter__(self) -> "Leaver":
        self.thread.start()
        assert self.left.wait(15), f"never reached the first piece (status {self.status}, {self.error})"
        return self

    def __exit__(self, *exc) -> None:
        self.thread.join(60)

    def _run(self) -> None:
        import asyncio

        try:
            asyncio.run(self._main())
        except BaseException as error:  # noqa: BLE001 — reported by __enter__
            self.error = error
            self.left.set()

    async def _main(self) -> None:
        import asyncio

        from app.api.routes import chat as chat_route

        path = f"/api/chat/conversations/{self.conversation}/messages"
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [
                (b"host", b"testserver"),
                (b"content-type", b"application/json"),
                (b"cookie", self.cookie.encode()),
            ],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        body = json.dumps({"content": self.text}).encode()
        sent = False
        piece = asyncio.Event()

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            await piece.wait()
            return {"type": "http.disconnect"}

        async def send(message) -> None:
            if message["type"] == "http.response.start":
                self.status = message["status"]
            elif message["type"] == "http.response.body" and b"event: delta" in message.get("body", b""):
                piece.set()
                self.left.set()

        await app(scope, receive, send)
        # The page is gone; the reply's task goes on in this "process".
        loop = asyncio.get_running_loop()
        while True:
            mine = [task for task in list(chat_route._RUNNING) if task.get_loop() is loop and not task.done()]
            if not mine:
                return
            await asyncio.wait(mine, timeout=30)


def wait_for_run(db: Session, conversation: int, timeout: float = 30.0) -> ChatRun:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        db.expire_all()
        run = db.query(ChatRun).filter(ChatRun.conversation_id == conversation).order_by(ChatRun.id.desc()).first()
        if run is not None and run.status != "running":
            return run
        time.sleep(0.05)
    raise AssertionError("the run did not finish")


def replies(db: Session, conversation: int) -> list[ChatMessage]:
    db.expire_all()
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation, ChatMessage.role == ChatRole.ASSISTANT)
        .all()
    )


def test_leaving_the_page_does_not_stop_the_reply_and_the_charge_is_the_same(
    client: TestClient, db_session: Session, budgeted, slow_config
) -> None:
    # Watched to the end: the reference reply and its charge.
    watched = new_conversation(client)
    whole = client.post(f"/api/chat/conversations/{watched}/messages", json={"content": LONG})
    assert whole.status_code == 200
    reference = replies(db_session, watched)[0]
    reference_row = db_session.query(UsageEvent).one()

    # Left after the first piece: it goes on, finishes and is saved whole.
    left = new_conversation(client)
    with Leaver(client, left) as page:
        assert page.status == 200
        # Still running after the page went away.
        db_session.expire_all()
        assert db_session.query(ChatRun).filter(ChatRun.conversation_id == left).one().status == "running"
    run = wait_for_run(db_session, left)
    assert run.status == "done"
    [saved] = replies(db_session, left)
    assert saved.status is ChatMessageStatus.COMPLETE
    assert saved.content == reference.content
    assert run.message_id == saved.id
    # One ledger row for it, the same amount as the watched reply.
    rows = db_session.query(UsageEvent).filter(UsageEvent.conversation_id == left).all()
    assert len(rows) == 1
    # The same reply is billed for the same tokens: every output token and
    # the same input (the mock's prompt cache only moves input between its
    # cached and uncached prices, so the won differ by that alone).
    def total_input(row: UsageEvent) -> int:
        return (row.input_tokens or 0) + (row.cache_write_tokens or 0) + (row.cache_read_tokens or 0)

    assert rows[0].output_tokens == reference_row.output_tokens > 0
    assert total_input(rows[0]) == total_input(reference_row)
    assert rows[0].charged_krw > 0


def test_stop_from_another_page_stops_it_and_charges_what_was_produced(
    client: TestClient, db_session: Session, budgeted, slow_config
) -> None:
    conversation = new_conversation(client)
    done: list[tuple[str, dict]] = []

    def watch() -> None:
        with client.stream(
            "POST", f"/api/chat/conversations/{conversation}/messages", json={"content": LONG}
        ) as response:
            done.extend(read_events(response.iter_lines(), {"done", "error"}))

    reader = threading.Thread(target=watch)
    reader.start()
    # Wait until the reply is being written, then press 중지 from "another tab".
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        db_session.expire_all()
        run = db_session.query(ChatRun).filter(ChatRun.conversation_id == conversation).first()
        if run is not None and run.text:
            break
        time.sleep(0.05)
    stopped = client.post(f"/api/chat/conversations/{conversation}/stop", json={})
    assert stopped.status_code == 200 and stopped.json() == {"stopping": True}
    reader.join(timeout=30)
    assert not reader.is_alive()

    # The first page received the end: 중지됨, saved, charged once.
    name, data = done[-1]
    assert name == "done"
    [saved] = replies(db_session, conversation)
    assert saved.status is ChatMessageStatus.STOPPED
    assert data["message"]["id"] == saved.id
    rows = db_session.query(UsageEvent).filter(UsageEvent.conversation_id == conversation).all()
    assert len(rows) == 1
    assert data["charged_krw"] == rows[0].charged_krw > 0
    # Charged for what was produced: the text, never the whole reply.
    assert rows[0].output_tokens <= len(saved.content) + 10
    run = wait_for_run(db_session, conversation)
    assert run.status == "stopped" and run.stop_requested
    # Nothing left to stop.
    assert client.post(f"/api/chat/conversations/{conversation}/stop", json={}).json() == {"stopping": False}


def test_coming_back_re_attaches_and_watching_never_charges_again(
    client: TestClient, db_session: Session, budgeted, slow_config
) -> None:
    conversation = new_conversation(client)
    page = Leaver(client, conversation).__enter__()

    # The page comes back: the conversation says a reply is running, with the text so far.
    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    assert detail["running"] is not None
    assert client.get("/api/chat/running").json()["conversations"] == [conversation]

    with client.stream("GET", f"/api/chat/conversations/{conversation}/live") as live:
        assert live.status_code == 200
        events = read_events(live.iter_lines(), {"done", "error"})
    names = [name for name, _ in events]
    assert names[0] == "snapshot" and names[-1] == "done"
    shown = events[0][1]["text"] + "".join(data["text"] for name, data in events if name == "delta")
    [saved] = replies(db_session, conversation)
    assert events[-1][1]["message_id"] == saved.id
    assert shown == saved.content
    # A second watcher after the end: nothing running, nothing charged.
    page.__exit__(None, None, None)
    assert client.get(f"/api/chat/conversations/{conversation}/live").status_code == 204
    assert db_session.query(UsageEvent).filter(UsageEvent.conversation_id == conversation).count() == 1
    assert client.get("/api/chat/running").json()["conversations"] == []


def test_one_running_reply_per_member(client: TestClient, db_session: Session, budgeted, slow_config) -> None:
    first = new_conversation(client)
    second = new_conversation(client)
    with Leaver(client, first):
        refused = client.post(f"/api/chat/conversations/{second}/messages", json={"content": "안녕"})
        assert refused.status_code == 409
        assert "다른 대화에서 답장을 쓰고 있어요" in refused.json()["detail"]
        # The refusal saved nothing and charged nothing.
        assert db_session.query(ChatMessage).filter(ChatMessage.conversation_id == second).count() == 0
    wait_for_run(db_session, first)
    assert client.post(f"/api/chat/conversations/{second}/messages", json={"content": "안녕"}).status_code == 200


def test_a_refused_turn_leaves_no_running_reply(
    client: TestClient, db_session: Session, budgeted, slow_config
) -> None:
    conversation = new_conversation(client)
    too_long = client.post(f"/api/chat/conversations/{conversation}/messages", json={"content": ""})
    assert too_long.status_code in (400, 422)
    assert client.get("/api/chat/running").json()["conversations"] == []
    assert client.post(f"/api/chat/conversations/{conversation}/messages", json={"content": "안녕"}).status_code == 200


def test_a_reply_a_restart_left_running_ends_as_stopped_uncharged(
    client: TestClient, db_session: Session, budgeted, dev_user, slow_config
) -> None:
    conversation = Conversation(user_id=dev_user.id, title="재시작")
    db_session.add(conversation)
    db_session.commit()
    old = datetime.now(timezone.utc) - timedelta(minutes=5)
    db_session.add(
        ChatRun(user_id=dev_user.id, conversation_id=conversation.id, status="running", text="여기까지 썼어요", heartbeat_at=old)
    )
    db_session.commit()
    # Nothing marks it running any more, and the conversation shows what was written.
    assert client.get("/api/chat/running").json()["conversations"] == []
    detail = client.get(f"/api/chat/conversations/{conversation.id}").json()
    assert detail["running"] is None
    [reply] = [m for m in detail["messages"] if m["role"] == "assistant"]
    assert reply["content"] == "여기까지 썼어요" and reply["status"] == "stopped"
    assert reply["stop_note"] == chat_runs.RESTARTED_NOTE
    assert db_session.query(UsageEvent).count() == 0
    # And the member may send again.
    assert client.post(f"/api/chat/conversations/{conversation.id}/messages", json={"content": "안녕"}).status_code == 200


def test_a_build_a_restart_left_running_becomes_continue(
    client: TestClient, db_session: Session, dev_user, participating
) -> None:
    project = BuilderProject(owner_user_id=dev_user.id, name="재시작", description="")
    db_session.add(project)
    db_session.commit()
    live = BuilderGeneration(
        project_id=project.id, user_id=dev_user.id, kind="create", request="앱", plan=[["index.html", "화면"]],
        files_done=[], status="running", check_fixed=[], heartbeat_at=datetime.now(timezone.utc),
    )
    db_session.add(live)
    db_session.commit()
    assert client.get("/api/chat/running").json()["projects"] == [project.id]

    live.heartbeat_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db_session.commit()
    assert client.get("/api/chat/running").json()["projects"] == []
    opened = client.get(f"/api/builder/projects/{project.id}/generation").json()
    assert opened["status"] == "failed"
    assert opened["error"] == chat_runs.BUILD_RESTARTED


def test_another_member_can_neither_stop_nor_watch(
    client: TestClient, db_session: Session, budgeted, other_user, slow_config
) -> None:
    from tests.conftest import MEMBER_PASSWORD

    conversation = new_conversation(client)
    page = Leaver(client, conversation).__enter__()
    other = TestClient(app, headers={"Content-Type": "application/json"})
    with other:
        assert other.post("/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD}).status_code == 200
        assert other.post(f"/api/chat/conversations/{conversation}/stop", json={}).status_code == 404
        assert other.get(f"/api/chat/conversations/{conversation}/live").status_code == 404
        assert other.get("/api/chat/running").json()["conversations"] == []
    page.__exit__(None, None, None)
    run = wait_for_run(db_session, conversation)
    assert run.status == "done" and not run.stop_requested


def test_stop_reaches_a_reply_running_in_another_process(
    client: TestClient, db_session: Session, budgeted, slow_config
) -> None:
    """The page that started it is gone and the reply runs in "another
    process" (its loop; its in-memory stop is hidden): 중지 is carried by
    the run row and read within half a second."""
    from app.api.routes import chat as chat_route

    conversation = new_conversation(client)
    with Leaver(client, conversation):
        db_session.expire_all()
        run = db_session.query(ChatRun).filter(ChatRun.conversation_id == conversation).one()
        chat_route._STOPS.pop(run.id, None)
        assert client.post(f"/api/chat/conversations/{conversation}/stop", json={}).json() == {"stopping": True}
        finished = wait_for_run(db_session, conversation, timeout=5)
    assert finished.status == "stopped"
    [saved] = replies(db_session, conversation)
    assert saved.status is ChatMessageStatus.STOPPED
    assert db_session.query(UsageEvent).filter(UsageEvent.conversation_id == conversation).count() == 1
