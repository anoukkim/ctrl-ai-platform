"""builder-file-continue: a file cut off at the output limit is continued,
not started again.

A file is written in `write_file_part` parts. When a call is cut, the parts
that arrived whole are saved (`partial_file`) and charged, and the next
call carries on after them — in the same run, or with 이어서 만들기. A call
cut before one whole part is free and stops with a sentence saying why.

Mock Claude and a fake transport only; nothing reaches Anthropic.
"""

import json

import httpx2 as httpx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import builder as builder_route
from app.core.config import get_settings
from app.main import app
from app.models import BuilderGeneration, UsageEvent
from app.services import builder_stages
from app.services.claude_provider import MOCK_LONG_CONTENT, AnthropicClaudeProvider
from tests.test_builder_stages import charged, config, files_of, plan, project, run  # noqa: F401


def test_a_long_file_is_continued_in_the_same_run(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    body = plan(client, project, "할 일 앱 [mock-long-file:app.js]").json()
    events = run(client, project, body["id"])
    names = [name for name, _ in events]
    assert "file_progress" in names and names[-1] == "done"
    progress = dict(events)["file_progress"]
    assert progress["path"] == "app.js" and 0 < progress["chars"] < len(MOCK_LONG_CONTENT)
    # The file is whole — the second call wrote on from where the first was cut.
    assert files_of(db_session, project)["app.js"] == MOCK_LONG_CONTENT
    generation = db_session.get(BuilderGeneration, body["id"])
    assert generation.status == "done" and generation.partial_file is None
    # Plan, index.html, style.css, app.js in two calls, the check: all paid,
    # and the run's total counts the cut call too.
    amounts = charged(db_session)
    assert len(amounts) == 6 and all(amount > 0 for amount in amounts)
    assert dict(events)["done"]["charged_krw"] == sum(amounts)


def test_continue_carries_on_from_the_saved_part(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    monkeypatch.setattr(builder_stages, "MAX_CALLS_PER_FILE", 1)
    body = plan(client, project, "할 일 앱 [mock-long-file:app.js]").json()
    events = run(client, project, body["id"])
    error = dict(events)["error"]
    assert "이어서 만들기" in error["detail"] and error["partial"] is True
    db_session.expire_all()
    generation = db_session.get(BuilderGeneration, body["id"])
    saved = generation.partial_file
    assert generation.status == "partial" and saved["path"] == "app.js"
    assert MOCK_LONG_CONTENT.startswith(saved["content"]) and saved["content"]
    # The half file is not put in the app: the preview keeps working.
    assert "app.js" not in files_of(db_session, project) or files_of(db_session, project)["app.js"] != saved["content"]

    again = run(client, project, body["id"])  # 이어서 만들기
    assert [name for name, _ in again][-1] == "done"
    assert files_of(db_session, project)["app.js"] == MOCK_LONG_CONTENT
    db_session.expire_all()
    assert db_session.get(BuilderGeneration, body["id"]).partial_file is None


def test_a_call_cut_before_any_part_is_free_and_says_why(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    body = plan(client, project, "할 일 앱 [mock-stuck-file:app.js]").json()
    events = run(client, project, body["id"])
    detail = dict(events)["error"]["detail"]
    assert "생각 깊이를 높이거나" in detail and "1회 한도" in detail
    latest = db_session.query(UsageEvent).order_by(UsageEvent.id.desc()).first()
    assert latest.charged_krw == 0 and latest.club_absorbed is True


# ------------------------------------------------------------ the real adapter


def reply(content: list[dict], stop_reason: str, output_tokens: int = 300) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
            "stop_reason": stop_reason, "stop_sequence": None, "content": content,
            "usage": {"input_tokens": 900, "output_tokens": output_tokens},
        },
    )


def part(block_id: str, content: str, done: bool, path: str = "index.html") -> dict:
    return {"type": "tool_use", "id": block_id, "name": "write_file_part",
            "input": {"path": path, "content": content, "done": done}}


class FakeParts:
    """First file call: one whole part, then a part the limit cut (dropped).
    Second file call: the rest, done. The self-check finds nothing."""

    def __init__(self) -> None:
        self.file_requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        sent = json.loads(request.content)
        system = sent["system"] if isinstance(sent["system"], str) else json.dumps(sent["system"])
        if "write_file_part" not in system:
            return reply([{"type": "text", "text": "점검했어요 — 고칠 곳이 없어요."}], "end_turn")
        self.file_requests.append(sent)
        if len(self.file_requests) == 1:
            return reply([part("t1", "<p>앞</p>\n", False), part("t2", "<p>잘린", False)], "max_tokens")
        return reply([part("t3", "<p>뒤</p>\n", True), {"type": "text", "text": "다 썼어요."}], "end_turn")


def test_the_real_writer_keeps_whole_parts_and_continues_after_them(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    settings = config.model_copy(
        update={"claude_provider": "anthropic", "anthropic_api_key": "test-not-a-real-key",
                "anthropic_model": "claude-sonnet-5-5"}
    )
    app.dependency_overrides[get_settings] = lambda: settings
    fake = FakeParts()
    monkeypatch.setattr(
        builder_route,
        "get_claude_provider",
        lambda _settings: AnthropicClaudeProvider(
            settings, http_client=httpx.Client(transport=httpx.MockTransport(fake.handler))
        ),
    )
    generation = BuilderGeneration(
        project_id=project.id, user_id=project.owner_user_id, kind="create", request="소개 페이지",
        style="", summary="", plan=[["index.html", "화면"]], files_done=[], status="planned",
        check_fixed=[], charged_krw=0,
    )
    db_session.add(generation)
    db_session.commit()

    events = run(client, project, generation.id)
    assert [name for name, _ in events][-1] == "done", events
    # The cut part is gone; the whole one and the continuation are joined.
    assert files_of(db_session, project)["index.html"] == "<p>앞</p>\n<p>뒤</p>\n"
    first, second = fake.file_requests
    assert [tool["name"] for tool in first["tools"]] == ["write_file_part"]
    told = json.dumps(second["messages"][0]["content"], ensure_ascii=False)
    assert "<written path=\\\"index.html\\\">" in told and "<p>앞</p>" in told and "잘린" not in told


class Scripted:
    """File calls answered in order from `replies`; the self-check is quiet."""

    def __init__(self, replies: list[httpx.Response]) -> None:
        self.replies = replies
        self.file_requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        sent = json.loads(request.content)
        system = sent["system"] if isinstance(sent["system"], str) else json.dumps(sent["system"])
        if "write_file_part" not in system:
            return reply([{"type": "text", "text": "점검했어요 — 고칠 곳이 없어요."}], "end_turn")
        self.file_requests.append(sent)
        return self.replies[len(self.file_requests) - 1]


def real_run(client, db_session, project, config, monkeypatch, replies, plan_steps=(("index.html", "화면"),)):
    settings = config.model_copy(
        update={"claude_provider": "anthropic", "anthropic_api_key": "test-not-a-real-key",
                "anthropic_model": "claude-sonnet-5-5"}
    )
    app.dependency_overrides[get_settings] = lambda: settings
    fake = Scripted(replies)
    monkeypatch.setattr(
        builder_route,
        "get_claude_provider",
        lambda _settings: AnthropicClaudeProvider(
            settings, http_client=httpx.Client(transport=httpx.MockTransport(fake.handler))
        ),
    )
    generation = BuilderGeneration(
        project_id=project.id, user_id=project.owner_user_id, kind="create", request="소개 페이지",
        style="", summary="", plan=[list(step) for step in plan_steps], files_done=[], status="planned",
        check_fixed=[], charged_krw=0,
    )
    db_session.add(generation)
    db_session.commit()
    return fake, run(client, project, generation.id)


def test_a_file_already_whole_at_the_cut_is_finished_not_stuck(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    # The cut fell exactly at the end; the next reply has nothing left to add.
    fake, events = real_run(client, db_session, project, config, monkeypatch, [
        reply([part("t1", "<p>전부</p>\n", False), part("t2", "", True)], "max_tokens"),
        reply([{"type": "text", "text": "이미 다 썼어요."}], "end_turn"),
    ])
    assert [name for name, _ in events][-1] == "done", events
    assert files_of(db_session, project)["index.html"] == "<p>전부</p>\n"


def test_part_paths_are_normalised(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    fake, events = real_run(client, db_session, project, config, monkeypatch, [
        reply([part("t1", "<p>a</p>\n", False, "./index.html"), part("t2", "<p>b</p>\n", True, "/index.html")],
              "tool_use"),
    ])
    assert [name for name, _ in events][-1] == "done", events
    assert files_of(db_session, project)["index.html"] == "<p>a</p>\n<p>b</p>\n"


def test_a_whole_ctrlai_json_beside_a_cut_file_is_kept(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    manifest = '{"db": [{"name": "posts", "shared": true}]}\n'
    fake, events = real_run(client, db_session, project, config, monkeypatch, [
        reply([part("m", manifest, True, "ctrlai.json"), part("t1", "<p>앞</p>\n", False),
               part("t2", "<p>잘", False)], "max_tokens"),
        reply([part("t3", "<p>뒤</p>\n", True)], "end_turn"),
    ])
    assert [name for name, _ in events][-1] == "done", events
    saved = files_of(db_session, project)
    assert saved["ctrlai.json"] == manifest and saved["index.html"] == "<p>앞</p>\n<p>뒤</p>\n"


def test_each_file_call_is_one_request(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    """The wallet is checked per call: a call never runs a second round."""
    fake, events = real_run(client, db_session, project, config, monkeypatch, [
        reply([part("t1", "<p>1</p>\n", False)], "tool_use"),
        reply([part("t2", "<p>2</p>\n", True)], "tool_use"),
    ])
    assert len(fake.file_requests) == 2
    assert all(len(sent["messages"]) == 1 for sent in fake.file_requests)
    assert files_of(db_session, project)["index.html"] == "<p>1</p>\n<p>2</p>\n"
