"""builder-static-runtime: 만들기 / 고치기, versions, and the apps origin.

Mock Claude and a fake transport only — nothing reaches Anthropic. The
apps folder is a temporary directory per test.
"""

import json
from pathlib import Path

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import builder as builder_route
from app.core.config import Settings, get_settings
from app.main import app
from app.models import BuilderProject, BuilderProjectFile, BuilderProjectVersion, UsageEvent
from app.services import app_runtime, builder_files, builder_versions
from app.services.claude_provider import (
    MOCK_ACCENT,
    MOCK_ACCENT_NEW,
    WRITE_FILE_TOOL,
    AnthropicClaudeProvider,
)
from tests.conftest import DEV_PASSWORD
from tests.test_beta_launch import SERVER_DATABASE

APPS_BASE = "http://apps.test"


@pytest.fixture
def apps_dir(tmp_path) -> Path:
    return tmp_path / "apps"


@pytest.fixture
def config(apps_dir, tmp_path):
    settings = Settings(
        app_env="development",
        chat_mock_delay_ms=0,
        apps_dir=str(apps_dir),
        apps_base_url=APPS_BASE,
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


def generate(client: TestClient, project: BuilderProject, request: str):
    return client.post(f"/api/builder/projects/{project.id}/generate", json={"request": request})


def files_of(db_session: Session, project: BuilderProject) -> dict[str, str]:
    db_session.expire_all()
    return builder_versions.current_files(db_session, project)


# ------------------------------------------------------------ 만들기 / 고치기


def test_making_then_changing_an_app_charges_each_time_and_saves_versions(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    made = generate(client, project, "할 일 목록 앱을 만들어 줘")
    assert made.status_code == 200, made.text
    body = made.json()
    assert {f["path"] for f in body["files"]} == {"index.html", "style.css", "app.js"}
    assert body["version"]["number"] == 1 and body["version"]["note"].startswith("만들기:")
    assert body["charged_krw"] > 0

    changed = generate(client, project, "버튼 색을 바꿔 줘")
    assert changed.status_code == 200, changed.text
    assert changed.json()["changed"] == ["style.css"]
    assert changed.json()["version"]["note"].startswith("고치기:")
    css = files_of(db_session, project)["style.css"]
    assert MOCK_ACCENT_NEW in css and MOCK_ACCENT not in css

    events = db_session.query(UsageEvent).order_by(UsageEvent.id).all()
    assert [(e.feature, e.builder_project_id) for e in events] == [("build", project.id)] * 2
    db_session.refresh(budgeted)
    assert budgeted.consumed_krw == sum(e.charged_krw for e in events)

    versions = client.get(f"/api/builder/projects/{project.id}/versions").json()
    assert [v["number"] for v in versions] == [2, 1]
    assert versions[0]["file_count"] == 3 and versions[0]["total_bytes"] > 0


def test_the_estimate_reserves_the_whole_output_budget(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    body = client.get(f"/api/builder/projects/{project.id}/generate-estimate").json()
    assert 0 < body["estimated_krw"] < body["worst_case_krw"]
    assert body["max_output_tokens"] == 16000
    assert db_session.query(UsageEvent).count() == 0


def test_a_project_made_before_versions_gets_its_old_state_kept_first(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    db_session.add(BuilderProjectFile(project_id=project.id, path="index.html", content="<p>옛날</p>"))
    db_session.commit()

    assert generate(client, project, "제목을 바꿔 줘").status_code == 200
    versions = client.get(f"/api/builder/projects/{project.id}/versions").json()
    assert [(v["number"], v["note"]) for v in versions][1] == (1, "처음 상태")


def test_server_code_is_refused_and_not_charged_but_the_club_cost_is_recorded(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    assert generate(client, project, "앱을 만들어 줘").status_code == 200
    before = files_of(db_session, project)

    refused = generate(client, project, "서버도 만들어 줘 [mock-server-code]")
    assert refused.status_code == 502
    assert "서버에서 실행" in refused.json()["detail"]
    assert files_of(db_session, project) == before
    absorbed = db_session.query(UsageEvent).order_by(UsageEvent.id.desc()).first()
    assert absorbed.charged_krw == 0 and absorbed.club_absorbed is True
    assert db_session.query(BuilderProjectVersion).count() == 1


def test_a_provider_failure_changes_nothing(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    assert generate(client, project, "앱 [mock-error:unavailable]").status_code == 503
    assert files_of(db_session, project) == {}
    assert db_session.query(UsageEvent).count() == 0


def test_someone_elses_project_is_not_found(
    other_client: TestClient, project, other_participating, config
) -> None:
    assert generate(other_client, project, "바꿔 줘").status_code == 404
    assert other_client.get(f"/api/builder/projects/{project.id}/versions").status_code == 404
    assert other_client.get(f"/api/builder/projects/{project.id}/versions/1/files").status_code == 404


# ------------------------------------------------------------ the file rules


@pytest.mark.parametrize(
    "path",
    ["../etc/passwd", "/abs.html", ".env", "a/.hidden.js", "a/b/c/d.js", "app.exe", "x.html.bak"],
)
def test_paths_outside_the_rules_are_refused(path: str) -> None:
    with pytest.raises(builder_files.FileRuleError):
        builder_files.clean_path(path)


@pytest.mark.parametrize("path", ["server.py", "api.php", "run.sh", "main.ts", "App.jsx"])
def test_server_or_build_code_is_refused_by_name(path: str) -> None:
    with pytest.raises(builder_files.FileRuleError, match="서버에서 실행"):
        builder_files.clean_path(path)


def test_the_size_and_count_limits() -> None:
    base = {"index.html": "<p>hi</p>"}
    with pytest.raises(builder_files.FileRuleError, match="200KB"):
        builder_files.apply_writes(base, [("big.js", "x" * 200_001)])
    with pytest.raises(builder_files.FileRuleError, match="너무 많습니다"):
        builder_files.apply_writes(base, [(f"f{i}.js", "x") for i in range(30)])
    with pytest.raises(builder_files.FileRuleError, match="2MB"):
        builder_files.apply_writes(base, [(f"f{i}.js", "x" * 199_000) for i in range(11)])
    with pytest.raises(builder_files.FileRuleError, match="index.html"):
        builder_files.apply_writes({}, [("app.js", "x")])
    updated, changed = builder_files.apply_writes(base, [("./js/app.js", "1"), ("index.html", "<p>hi</p>")])
    assert changed == ["js/app.js"] and set(updated) == {"index.html", "js/app.js"}


# ------------------------------------------------------------ versions


def test_restoring_a_version_is_free_and_is_itself_a_version(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "앱을 만들어 줘")
    first = files_of(db_session, project)
    generate(client, project, "버튼 색을 바꿔 줘")
    charged = db_session.query(UsageEvent).count()

    restored = client.post(f"/api/builder/projects/{project.id}/versions/1/restore", json={})
    assert restored.status_code == 200, restored.text
    assert restored.json()["version"]["number"] == 3
    assert restored.json()["version"]["note"] == "v1로 되돌리기"
    assert files_of(db_session, project) == first
    assert db_session.query(UsageEvent).count() == charged

    assert client.post(f"/api/builder/projects/{project.id}/versions/99/restore", json={}).status_code == 404


def test_a_versions_files_can_be_read_without_changing_anything(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    """이 버전 보기 (quality-tuning Q3): free, read-only, owner only."""
    generate(client, project, "앱을 만들어 줘")
    first = files_of(db_session, project)
    generate(client, project, "버튼 색을 바꿔 줘")
    charged = db_session.query(UsageEvent).count()

    response = client.get(f"/api/builder/projects/{project.id}/versions/1/files")
    assert response.status_code == 200, response.text
    assert {row["path"]: row["content"] for row in response.json()} == first
    assert files_of(db_session, project) != first
    assert db_session.query(UsageEvent).count() == charged
    assert client.get(f"/api/builder/projects/{project.id}/versions/99/files").status_code == 404


def test_only_the_last_thirty_versions_are_kept(db_session: Session, project) -> None:
    for i in range(35):
        builder_versions.snapshot(db_session, project, f"v{i}", {"index.html": str(i)})
    db_session.commit()
    numbers = [v.number for v in builder_versions.list_versions(db_session, project)]
    assert numbers == list(range(35, 5, -1))


def test_restore_removes_files_the_old_version_did_not_have(db_session: Session, project) -> None:
    builder_versions.replace_files(db_session, project, {"index.html": "a"})
    builder_versions.snapshot(db_session, project, "one")
    builder_versions.replace_files(db_session, project, {"index.html": "b", "extra.js": "x"})
    builder_versions.snapshot(db_session, project, "two")
    builder_versions.restore(db_session, project, 1)
    db_session.commit()
    assert files_of(db_session, project) == {"index.html": "a"}


# ------------------------------------------------------------ the runtime


def test_a_generation_writes_the_working_copy_to_its_own_random_folder(
    client: TestClient, db_session: Session, project, budgeted, config, apps_dir
) -> None:
    body = generate(client, project, "앱을 만들어 줘").json()
    slug = body["project"]["draft_slug"]
    assert slug and len(slug) == app_runtime.SLUG_LENGTH and str(project.id) not in slug
    assert body["project"]["app_runtime_at"]

    folder = apps_dir / slug
    assert sorted(p.name for p in folder.iterdir()) == ["app.js", "index.html", "style.css"]
    page = (folder / "index.html").read_text(encoding="utf-8")
    assert page.index(app_runtime.SDK_TAG) < page.index("<title>")
    assert (folder / "app.js").read_text(encoding="utf-8") == files_of(db_session, project)["app.js"]
    # Nothing left over from the swap.
    assert [p.name for p in apps_dir.iterdir()] == [slug]


def test_a_projects_folder_holds_only_that_project(
    client: TestClient, db_session: Session, dev_user, budgeted, config, apps_dir
) -> None:
    one = BuilderProject(owner_user_id=dev_user.id, name="하나")
    two = BuilderProject(owner_user_id=dev_user.id, name="둘")
    db_session.add_all([one, two])
    db_session.commit()
    generate(client, one, "앱을 만들어 줘")
    builder_versions.replace_files(db_session, two, {"index.html": "<p>둘</p>", "two.js": "2"})
    db_session.commit()
    assert client.post(f"/api/builder/projects/{two.id}/runtime", json={}).status_code == 200

    db_session.refresh(one)
    db_session.refresh(two)
    assert one.draft_slug != two.draft_slug
    assert sorted(p.name for p in (apps_dir / two.draft_slug).iterdir()) == ["index.html", "two.js"]
    assert not (apps_dir / one.draft_slug / "two.js").exists()
    # Nothing is public until 게시 (ctrlaiapps-publish).
    assert one.app_slug is None and two.app_slug is None


def test_guide_docs_stay_in_the_project_and_are_never_served(
    client: TestClient, db_session: Session, project, budgeted, config, apps_dir
) -> None:
    """quality-tuning Q3: README / CLAUDE / HANDOFF_PROMPT / HISTORY / SPEC
    belong to the project and its ZIP, not to the app on apps.ctrlai.my —
    neither the working copy nor the published version. A file of the
    same name inside a folder is the app's own and is served."""
    files = {"index.html": "<p>앱</p>", "notes/README.md": "앱 안의 글"}
    files.update({name: f"# {name}" for name in builder_files.GUIDE_DOCS})
    builder_versions.replace_files(db_session, project, files)
    db_session.commit()

    assert client.post(f"/api/builder/projects/{project.id}/runtime", json={}).status_code == 200
    db_session.refresh(project)
    draft = apps_dir / project.draft_slug
    assert sorted(p.name for p in draft.iterdir()) == ["index.html", "notes"]
    assert (draft / "notes" / "README.md").is_file()

    app_runtime.write_public(db_session, config, project, files)
    public = apps_dir / project.app_slug
    for name in builder_files.GUIDE_DOCS:
        assert not (public / name).exists()
    assert (public / "index.html").is_file()
    # The project itself keeps every guide.
    assert set(builder_files.GUIDE_DOCS) <= set(files_of(db_session, project))


def test_deleting_a_project_stops_serving_it(
    client: TestClient, db_session: Session, project, budgeted, config, apps_dir
) -> None:
    slug = generate(client, project, "앱을 만들어 줘").json()["project"]["draft_slug"]
    assert (apps_dir / slug).is_dir()

    assert client.delete(f"/api/builder/projects/{project.id}").status_code == 204
    assert not (apps_dir / slug).exists()
    db_session.refresh(project)
    assert project.app_runtime_at is None


def test_the_runtime_refuses_when_all_apps_would_pass_the_cap(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    builder_versions.replace_files(db_session, project, {"index.html": "x" * 600_000})
    db_session.commit()
    config.apps_max_total_mb = 0
    refused = client.post(f"/api/builder/projects/{project.id}/runtime", json={})
    assert refused.status_code == 507
    assert "가득" in refused.json()["detail"]


def test_with_the_runtime_off_nothing_is_written(
    client: TestClient, db_session: Session, project, budgeted, config, apps_dir
) -> None:
    config.apps_base_url = ""
    body = generate(client, project, "앱을 만들어 줘").json()
    assert body["project"]["app_runtime_at"] is None
    assert not apps_dir.exists()
    assert client.post(f"/api/builder/projects/{project.id}/runtime", json={}).status_code == 409


def test_the_sdk_goes_first() -> None:
    """app-platform P1: the SDK (and with it the shell-kept localStorage)
    loads before any of the app's own scripts."""
    assert app_runtime.with_shim("a.html", "<!doctype html><html><head><title>t</title>").startswith(
        "<!doctype html><html><head>" + app_runtime.SDK_TAG
    )
    assert app_runtime.with_shim("a.html", "<p>x</p>") == app_runtime.SDK_TAG + "<p>x</p>"
    assert app_runtime.with_shim("a.js", "let a") == "let a"


# ------------------------------------------------------------ the real adapter


class FakeToolTurns:
    """Answers `POST /v1/messages` locally: a write_file call, then text."""

    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.turns = [
            {
                "stop_reason": "tool_use",
                "content": [
                    {"type": "text", "text": "바꿀게요."},
                    {
                        "type": "tool_use", "id": "toolu_1", "name": "write_file",
                        "input": {"path": "index.html", "content": "<!doctype html><p>안녕</p>"},
                    },
                ],
                "usage": {"input_tokens": 1_000, "output_tokens": 300},
            },
            {
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "인사말을 넣었어요. 다음엔 색을 바꿔 보세요."}],
                "usage": {"input_tokens": 1_400, "output_tokens": 40},
            },
        ]

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        turn = self.turns[len(self.requests) - 1]
        return httpx.Response(
            200,
            json={
                "id": f"msg_{len(self.requests)}", "type": "message", "role": "assistant",
                "model": "claude-sonnet-5-5", "stop_sequence": None, **turn,
            },
        )


@pytest.fixture
def real_claude(monkeypatch, config):
    settings = config.model_copy(
        update={
            "claude_provider": "anthropic",
            "anthropic_api_key": "test-not-a-real-key",
            "anthropic_model": "claude-sonnet-5-5",
        }
    )
    app.dependency_overrides[get_settings] = lambda: settings
    fake = FakeToolTurns()
    monkeypatch.setattr(
        builder_route,
        "get_claude_provider",
        lambda _settings: AnthropicClaudeProvider(
            settings, http_client=httpx.Client(transport=httpx.MockTransport(fake.handler))
        ),
    )
    return fake


def test_the_real_adapter_uses_one_strict_tool_and_adds_up_every_round(
    client: TestClient, db_session: Session, project, budgeted, real_claude
) -> None:
    response = generate(client, project, "인사말을 넣어 줘")
    assert response.status_code == 200, response.text

    first, second = real_claude.requests
    assert first["tools"] == [WRITE_FILE_TOOL] and first["tools"][0]["strict"] is True
    assert first["tool_choice"] == {"type": "auto"}
    assert first["max_tokens"] == 16000
    assert "cache_control" not in first
    assert "write_file" in first["system"]
    # The second round acknowledges the call and has the rest of the budget.
    assert second["messages"][-1]["content"][0] == {
        "type": "tool_result", "tool_use_id": "toolu_1", "content": "저장했습니다.",
    }
    assert second["max_tokens"] == 16000 - 300

    assert response.json()["summary"].startswith("인사말을 넣었어요")
    event = db_session.query(UsageEvent).one()
    assert (event.input_tokens, event.output_tokens) == (2_400, 340)
    assert files_of(db_session, project) == {"index.html": "<!doctype html><p>안녕</p>"}


def test_a_cut_off_generation_is_not_stored_or_charged(
    client: TestClient, db_session: Session, project, budgeted, real_claude
) -> None:
    real_claude.turns[0]["stop_reason"] = "max_tokens"
    assert generate(client, project, "만들어 줘").status_code == 503
    assert files_of(db_session, project) == {}
    event = db_session.query(UsageEvent).one()
    assert event.charged_krw == 0 and event.club_absorbed is True


# ------------------------------------------------ the owner's three conditions


def test_the_session_cookie_has_no_domain(anon_client: TestClient, dev_user) -> None:
    login = anon_client.post(
        "/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}
    )
    assert login.status_code == 200
    assert "domain=" not in login.headers["set-cookie"].lower()


def test_a_deployed_server_refuses_a_cookie_domain_or_a_cors_entry_for_the_apps() -> None:
    cookie = Settings(
        app_env="beta", database_url=SERVER_DATABASE, session_cookie_domain="ctrlai.my"
    ).startup_problems()
    assert any("SESSION_COOKIE_DOMAIN" in problem for problem in cookie)

    cors = Settings(
        app_env="beta",
        database_url=SERVER_DATABASE,
        apps_base_url="https://apps.ctrlai.my",
        cors_allow_origins="https://ctrlai.my,https://apps.ctrlai.my",
    ).startup_problems()
    assert any("CORS_ALLOW_ORIGINS" in problem for problem in cors)

    fine = Settings(
        app_env="beta",
        database_url=SERVER_DATABASE,
        apps_base_url="https://apps.ctrlai.my",
        cors_allow_origins="https://ctrlai.my",
    ).startup_problems()
    assert fine == []


@pytest.mark.parametrize(
    "content_type", [None, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]
)
def test_a_post_a_page_could_send_without_a_preflight_is_refused(
    anon_client: TestClient, dev_user, content_type
) -> None:
    """Every state-changing route requires a JSON body (CLAUDE.md §2)."""
    with TestClient(app) as bare:
        login = bare.post(
            "/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}
        )
        assert login.status_code == 200
        headers = {"content-type": content_type} if content_type else {}
        refused = bare.post("/api/auth/logout", content=b"{}", headers=headers)
        assert refused.status_code == 415
        assert "JSON" in refused.json()["detail"]
        # Still signed in: the request never reached the route.
        assert bare.get("/api/auth/me").status_code == 200
        assert bare.post("/api/auth/logout", json={}).status_code in (200, 204)


@pytest.mark.parametrize("origin", ["https://apps.ctrlai.my", "http://apps.test"])
def test_the_api_answers_no_cors_to_the_apps_origin(anon_client: TestClient, origin: str) -> None:
    preflight = anon_client.options(
        "/api/auth/logout",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert "access-control-allow-origin" not in preflight.headers
    simple = anon_client.get("/api/health", headers={"Origin": origin})
    assert "access-control-allow-origin" not in simple.headers


