"""quality-tuning Q2: 만들기 / 고치기 in stages — plan, one call per file,
self-check — with progress events and 이어서 만들기.

Mock Claude and fake transports only; nothing reaches Anthropic.
"""

import json
import time

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import builder as builder_route
from app.core.config import Settings, get_settings
from app.main import app
from app.models import BuilderGeneration, BuilderProject, BuilderProjectVersion, UsageEvent
from app.services import builder_stages, builder_versions
from app.services.claude_provider import (
    MOCK_ACCENT,
    MOCK_ACCENT_NEW,
    PLAN_SCHEMA,
    AnthropicClaudeProvider,
    MockClaudeProvider,
)
from tests.test_chat import events_of


@pytest.fixture
def config(tmp_path):
    settings = Settings(
        app_env="development",
        chat_mock_delay_ms=0,
        apps_dir=str(tmp_path / "apps"),
        apps_base_url="http://apps.test",
        storage_dir=str(tmp_path / "storage"),
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def project(db_session: Session, dev_user) -> BuilderProject:
    row = BuilderProject(owner_user_id=dev_user.id, name="할 일", description="")
    db_session.add(row)
    db_session.commit()
    return row


def plan(client: TestClient, project: BuilderProject, request: str, **extra):
    return client.post(f"/api/builder/projects/{project.id}/plan", json={"request": request, **extra})


def run(client: TestClient, project: BuilderProject, generation_id: int) -> list[tuple[str, dict]]:
    response = client.post(f"/api/builder/projects/{project.id}/generations/{generation_id}/run", json={})
    assert response.status_code == 200, response.text
    return events_of(response.text)


def files_of(db_session: Session, project: BuilderProject) -> dict[str, str]:
    db_session.expire_all()
    return builder_versions.current_files(db_session, project)


def charged(db_session: Session) -> list[int]:
    db_session.expire_all()
    return [event.charged_krw for event in db_session.query(UsageEvent).order_by(UsageEvent.id)]


# ------------------------------------------------------------ the flow


def test_a_new_app_is_planned_then_written_file_by_file_then_checked(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    planned = plan(client, project, "할 일 앱", who="나 혼자", features="추가, 완료, 삭제", mood="귀여운")
    assert planned.status_code == 201, planned.text
    body = planned.json()
    assert body["status"] == "planned" and body["kind"] == "create"
    assert [step["path"] for step in body["plan"]] == ["index.html", "style.css", "app.js"]
    assert all(step["purpose"] for step in body["plan"])
    # The guided form's answers travel with the request.
    assert "누가 쓰나요: 나 혼자" in body["request"] and "원하는 분위기: 귀여운" in body["request"]
    assert body["estimated_krw"] > 0 and body["max_call_krw"] >= body["estimated_krw"] // 4
    assert len(charged(db_session)) == 1  # the plan is charged on its own
    assert files_of(db_session, project) == {}  # nothing written yet

    events = run(client, project, body["id"])
    names = [name for name, _ in events]
    assert names == [
        "file_start", "file_done", "file_start", "file_done", "file_start", "file_done",
        "check_start", "check_done", "done",
    ]
    assert [data["path"] for name, data in events if name == "file_done"] == ["index.html", "style.css", "app.js"]
    assert set(files_of(db_session, project)) == {"index.html", "style.css", "app.js"}

    # Plan + three files + the self-check: five charges, all in the total.
    amounts = charged(db_session)
    assert len(amounts) == 5 and all(amount > 0 for amount in amounts)
    done = dict(events)["done"]
    assert done["charged_krw"] == sum(amounts)
    generation = db_session.get(BuilderGeneration, body["id"])
    assert generation.status == "done" and generation.version_id is not None
    version = db_session.get(BuilderProjectVersion, generation.version_id)
    assert version.note.startswith("만들기: 할 일 앱")
    assert client.get(f"/api/builder/projects/{project.id}/generation").json() is None


def test_a_change_writes_only_the_planned_file(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    first = plan(client, project, "할 일 앱").json()
    run(client, project, first["id"])
    changed = plan(client, project, "버튼 색을 바꿔 줘").json()
    assert changed["kind"] == "edit"
    assert [step["path"] for step in changed["plan"]] == ["style.css"]

    events = run(client, project, changed["id"])
    assert [data["path"] for name, data in events if name == "file_start"] == ["style.css"]
    css = files_of(db_session, project)["style.css"]
    assert MOCK_ACCENT_NEW in css and MOCK_ACCENT not in css


def test_versions_carry_the_request_summary_and_cost_that_made_them(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    """quality-tuning Q3: the Claude panel shows the edit history as a
    conversation — each version says what was asked, what Claude did,
    how many files changed and what it cost. A 되돌리기 has none of that."""
    first = plan(client, project, "할 일 앱").json()
    run(client, project, first["id"])
    edit = plan(client, project, "버튼 색을 바꿔 줘").json()
    done = dict(run(client, project, edit["id"]))["done"]

    versions = client.get(f"/api/builder/projects/{project.id}/versions").json()
    latest, made = versions[0], versions[1]
    assert latest["request"] == "버튼 색을 바꿔 줘"
    assert latest["summary"] == edit["summary"]
    assert latest["changed_count"] == 1
    assert latest["charged_krw"] == done["charged_krw"] > 0
    assert made["changed_count"] == 3

    restored = client.post(f"/api/builder/projects/{project.id}/versions/{made['number']}/restore", json={})
    assert restored.status_code == 200, restored.text
    newest = client.get(f"/api/builder/projects/{project.id}/versions").json()[0]
    assert newest["request"] == "" and newest["changed_count"] is None and newest["charged_krw"] is None


class FailsOnce(MockClaudeProvider):
    """`[mock-error-file:…]` fails only the first run (then 이어서 만들기 works)."""

    failed = False

    def write_project_file(self, name, files, request, plan, path, *args, **kwargs):
        if FailsOnce.failed:
            request = request.replace("[mock-error-file:app.js]", "")
        try:
            return super().write_project_file(name, files, request, plan, path, *args, **kwargs)
        except Exception:
            FailsOnce.failed = True
            raise


def test_a_timeout_keeps_the_finished_files_and_continue_writes_the_rest(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    FailsOnce.failed = False
    monkeypatch.setattr(builder_route, "get_claude_provider", lambda settings: FailsOnce())
    body = plan(client, project, "할 일 앱 [mock-error-file:app.js]").json()

    events = run(client, project, body["id"])
    error = dict(events)["error"]
    assert error["partial"] is True and error["files_done"] == ["index.html", "style.css"]
    assert "app.js" in error["detail"]
    assert set(files_of(db_session, project)) == {"index.html", "style.css"}
    opened = client.get(f"/api/builder/projects/{project.id}/generation").json()
    assert opened["status"] == "partial" and opened["error"]
    # Plan + two files; the failed call was free.
    assert len(charged(db_session)) == 3

    events = run(client, project, body["id"])  # 이어서 만들기
    assert [data["path"] for name, data in events if name == "file_start"] == ["app.js"]
    assert events[-1][0] == "done"
    assert set(files_of(db_session, project)) == {"index.html", "style.css", "app.js"}


def test_the_self_check_fixes_what_it_finds_and_is_charged(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    run(client, project, plan(client, project, "할 일 앱").json()["id"])
    body = plan(client, project, "안내 문구를 넣어 줘 MOCK_CHECK_FIX").json()
    events = run(client, project, body["id"])
    check = dict(events)["check_done"]
    assert check["fixed"] == ["index.html"] and check["charged_krw"] > 0
    page = files_of(db_session, project)["index.html"]
    assert "MOCK_CHECK_FIX" not in page and "fixed by check" in page


def test_a_plan_with_server_code_is_refused_and_free(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    run(client, project, plan(client, project, "할 일 앱").json()["id"])
    refused = plan(client, project, "[mock-server-code] 서버 만들어 줘")
    assert refused.status_code == 502
    assert "서버" in refused.json()["detail"]
    latest = db_session.query(UsageEvent).order_by(UsageEvent.id.desc()).first()
    assert latest.charged_krw == 0 and latest.club_absorbed is True


def test_a_new_plan_replaces_an_open_one_and_a_plan_can_be_cancelled(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    first = plan(client, project, "할 일 앱").json()
    second = plan(client, project, "메모 앱").json()
    db_session.expire_all()
    assert db_session.get(BuilderGeneration, first["id"]).status == "cancelled"
    assert client.post(
        f"/api/builder/projects/{project.id}/generations/{first['id']}/run", json={}
    ).status_code == 409
    cancelled = client.post(f"/api/builder/projects/{project.id}/generations/{second['id']}/cancel", json={})
    assert cancelled.json()["status"] == "cancelled"
    assert client.get(f"/api/builder/projects/{project.id}/generation").json() is None


def test_a_run_already_going_is_not_started_twice(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    body = plan(client, project, "할 일 앱").json()
    row = db_session.get(BuilderGeneration, body["id"])
    row.status = "running"
    db_session.commit()
    events = run(client, project, body["id"])
    assert events == [("error", {"detail": "이미 만들고 있어요. 잠시만 기다려 주세요.", "partial": False, "files_done": []})]


def test_someone_elses_generation_is_not_found(
    client: TestClient, db_session: Session, project, budgeted, config, other_user
) -> None:
    other = BuilderProject(owner_user_id=other_user.id, name="남의 앱", description="")
    db_session.add(other)
    db_session.commit()
    assert plan(client, other, "할 일 앱").status_code == 404
    body = plan(client, project, "할 일 앱").json()
    assert client.post(
        f"/api/builder/projects/{other.id}/generations/{body['id']}/run", json={}
    ).status_code == 404


def test_a_wallet_that_runs_out_stops_the_run_with_the_files_so_far(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    body = plan(client, project, "할 일 앱").json()
    calls = {"n": 0}
    real = builder_stages.usage_service.ensure_affordable

    def short_after_two(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] > 2:
            raise builder_stages.usage_service.InsufficientBudgetError("이번 분기 지원금이 부족합니다.")
        return real(*args, **kwargs)

    monkeypatch.setattr(builder_stages.usage_service, "ensure_affordable", short_after_two)
    events = run(client, project, body["id"])
    error = dict(events)["error"]
    assert error["files_done"] == ["index.html", "style.css"] and "지원금" in error["detail"]


class SlowFiles(MockClaudeProvider):
    def write_project_file(self, *args, **kwargs):
        time.sleep(0.3)
        return super().write_project_file(*args, **kwargs)


def test_a_slow_file_keeps_the_stream_alive(
    client: TestClient, project, budgeted, config, monkeypatch
) -> None:
    monkeypatch.setattr(builder_route, "get_claude_provider", lambda settings: SlowFiles())
    monkeypatch.setattr(builder_route, "GENERATION_KEEPALIVE_SECONDS", 0.05)
    body = plan(client, project, "할 일 앱").json()
    response = client.post(f"/api/builder/projects/{project.id}/generations/{body['id']}/run", json={})
    assert response.text.count(": keepalive") >= 3
    assert events_of(response.text)[-1][0] == "done"


def test_builder_calls_wait_up_to_five_minutes_each() -> None:
    assert Settings().builder_timeout_seconds == 300.0


# ------------------------------------------------------------ the real adapter


class FakePlan:
    def __init__(self) -> None:
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        plan_json = {
            "summary": "할 일 앱을 만들어요.",
            "files": [
                {"path": "app.js", "purpose": "동작"},
                {"path": "index.html", "purpose": "화면"},
            ],
        }
        return httpx.Response(
            200,
            json={
                "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
                "stop_reason": "end_turn", "stop_sequence": None,
                "content": [{"type": "text", "text": json.dumps(plan_json, ensure_ascii=False)}],
                "usage": {"input_tokens": 800, "output_tokens": 120},
            },
        )


def test_the_real_plan_asks_for_structured_json_at_the_projects_depth(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    settings = config.model_copy(
        update={"claude_provider": "anthropic", "anthropic_api_key": "test-not-a-real-key",
                "anthropic_model": "claude-sonnet-5-5"}
    )
    app.dependency_overrides[get_settings] = lambda: settings
    fake = FakePlan()
    monkeypatch.setattr(
        builder_route,
        "get_claude_provider",
        lambda _settings: AnthropicClaudeProvider(
            settings, http_client=httpx.Client(transport=httpx.MockTransport(fake.handler))
        ),
    )
    client.patch(f"/api/builder/projects/{project.id}", json={"depth": "high"})
    body = plan(client, project, "할 일 앱").json()

    [sent] = fake.requests
    assert sent["output_config"]["format"] == {"type": "json_schema", "schema": PLAN_SCHEMA}
    assert sent["output_config"]["effort"] == "high"
    assert sent["max_tokens"] == builder_stages.PLAN_MAX_TOKENS
    assert "Do not write code" in sent["system"]
    # index.html is written first, whatever order the plan came in.
    assert [step["path"] for step in body["plan"]] == ["index.html", "app.js"]
    event = db_session.query(UsageEvent).one()
    assert (event.input_tokens, event.output_tokens, event.depth) == (800, 120, "high")


# ------------------------------------------------------------ 빌더 점검


def test_the_owner_eval_runs_the_ideas_within_its_budget_and_reports(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    """The tool on the mock — the owner runs it for real on the server."""
    from app.tools import builder_eval

    report = builder_eval.evaluate(db_session, config, dev_user, ideas=2, max_krw=3000)
    assert (report.ideas, report.succeeded) == (2, 2)
    assert 0 < report.total_krw <= 3000
    assert "| 용돈 기록장 | 성공 |" in report.markdown and "단어 암기 카드" in report.markdown
    listed = client.get("/api/admin/claude-pricing/builder-eval").json()
    assert listed[0]["markdown"] == report.markdown and listed[0]["provider"] == "mock"


def test_the_eval_never_spends_past_its_limit(
    db_session: Session, dev_user, budgeted, config
) -> None:
    from app.tools import builder_eval

    report = builder_eval.evaluate(db_session, config, dev_user, ideas=3, max_krw=40)
    assert report.total_krw <= 40
    assert report.succeeded < 3
    assert "점검 예산" in report.markdown


def test_the_eval_refuses_a_member_account(db_session: Session, other_user, config, capsys) -> None:
    from app.tools import builder_eval

    assert builder_eval.main(["--ideas", "9"]) == 2
