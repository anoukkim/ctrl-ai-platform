"""ctrlaiapps-publish — 게시, 업데이트 게시, 게시 취소, 신고, and the
published version kept apart from the working copy (add-on F1).

Mock Claude; the apps folder is a temporary directory.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import AppReport, AuditLog, BuilderProject, BuilderProjectStatus
from app.services import builder_versions
from app.services.claude_provider import MOCK_ACCENT, MOCK_ACCENT_NEW, edit_request_text
from tests.conftest import DEV_PASSWORD, JSON_HEADERS

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


def generate(client: TestClient, project: BuilderProject, request: str, style: str = ""):
    response = client.post(
        f"/api/builder/projects/{project.id}/generate", json={"request": request, "style": style}
    )
    assert response.status_code == 200, response.text
    return response.json()


def publish(client: TestClient, project: BuilderProject, note: str = ""):
    return client.post(
        f"/api/builder/projects/{project.id}/publish",
        json={"description": "할 일을 적고 지우는 앱이에요.", "note": note},
    )


def public_css(apps_dir: Path, project: BuilderProject) -> str:
    return (apps_dir / project.app_slug / "style.css").read_text(encoding="utf-8")


# ------------------------------------------------------------ the version kept apart


def test_publish_v1_edit_to_v3_public_stays_v1_until_update(
    client: TestClient, db_session: Session, project, budgeted, config, apps_dir
) -> None:
    """The owner's F1 case: publish, keep editing — the public URL serves
    the published version until 업데이트 게시."""
    generate(client, project, "할 일 앱을 만들어 줘")  # v1
    first = publish(client, project, note="첫 버전")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["status"] == "published" and body["published_version_number"] == 1
    db_session.refresh(project)
    assert project.app_slug and project.app_slug != project.draft_slug
    assert MOCK_ACCENT in public_css(apps_dir, project)

    generate(client, project, "버튼 색을 바꿔 줘")  # v2
    generate(client, project, "제목 밑에 설명을 넣어 줘")  # v3
    # Working copy changed; the public folder did not.
    draft_css = (apps_dir / project.draft_slug / "style.css").read_text(encoding="utf-8")
    assert MOCK_ACCENT_NEW in draft_css
    assert MOCK_ACCENT in public_css(apps_dir, project)
    listing = client.get(f"/api/apps/{project.app_slug}").json()
    assert (listing["version_number"], listing["publish_note"]) == (1, "첫 버전")
    assert listing["app_url"] == f"{APPS_BASE}/{project.app_slug}/"

    update = publish(client, project, note="버튼 색을 바꿨어요")
    assert update.json()["published_version_number"] == 3
    assert MOCK_ACCENT_NEW in public_css(apps_dir, project)
    assert client.get(f"/api/apps/{project.app_slug}").json()["publish_note"] == "버튼 색을 바꿨어요"

    versions = client.get(f"/api/builder/projects/{project.id}/versions").json()
    assert [(v["number"], v["published"]) for v in versions] == [(3, True), (2, False), (1, False)]


def test_rolling_back_and_updating_serves_the_old_version_again(
    client: TestClient, db_session: Session, project, budgeted, config, apps_dir
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")  # v1
    generate(client, project, "버튼 색을 바꿔 줘")  # v2
    publish(client, project)
    db_session.refresh(project)
    assert MOCK_ACCENT_NEW in public_css(apps_dir, project)

    client.post(f"/api/builder/projects/{project.id}/versions/1/restore", json={})  # v3 = v1
    assert MOCK_ACCENT_NEW in public_css(apps_dir, project)  # not yet
    assert publish(client, project).json()["published_version_number"] == 3
    assert MOCK_ACCENT in public_css(apps_dir, project)


def test_unpublish_keeps_every_version_and_takes_the_address_down(
    client: TestClient, db_session: Session, project, budgeted, config, apps_dir
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    generate(client, project, "버튼 색을 바꿔 줘")
    publish(client, project)
    db_session.refresh(project)
    slug = project.app_slug

    down = client.post(f"/api/builder/projects/{project.id}/unpublish", json={})
    assert down.json()["status"] == "ready" and down.json()["published_version_number"] is None
    assert not (apps_dir / slug).exists()
    assert client.get("/api/apps").json() == []
    assert client.get(f"/api/apps/{slug}").status_code == 404
    assert len(client.get(f"/api/builder/projects/{project.id}/versions").json()) == 2
    # Publishing again keeps the same address.
    publish(client, project)
    db_session.refresh(project)
    assert project.app_slug == slug and (apps_dir / slug).is_dir()


def test_a_deleted_project_leaves_ctrlaiapps_and_stops_serving(
    client: TestClient, db_session: Session, project, budgeted, config, apps_dir
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    publish(client, project)
    db_session.refresh(project)
    slug = project.app_slug
    assert len(client.get("/api/apps").json()) == 1

    assert client.delete(f"/api/builder/projects/{project.id}").status_code == 204
    assert client.get("/api/apps").json() == []
    assert not (apps_dir / slug).exists() and not (apps_dir / project.draft_slug).exists()
    db_session.refresh(project)
    assert project.status is BuilderProjectStatus.READY and project.published_version_id is None


def test_the_listing_filters_deleted_at_even_if_status_says_published(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    """CLAUDE.md §10: every listing query filters the project's deleted_at."""
    generate(client, project, "할 일 앱을 만들어 줘")
    publish(client, project)
    from datetime import datetime, timezone

    db_session.refresh(project)
    project.deleted_at = datetime.now(timezone.utc)  # a delete that skipped the route
    db_session.commit()
    assert client.get("/api/apps").json() == []


def test_publishing_needs_an_app_and_a_description(
    client: TestClient, project, budgeted, config
) -> None:
    assert publish(client, project).status_code == 409
    generate(client, project, "할 일 앱을 만들어 줘")
    empty = client.post(
        f"/api/builder/projects/{project.id}/publish", json={"description": " "}
    )
    assert empty.status_code == 400


def test_the_listing_shows_name_author_version_and_note(
    client: TestClient, db_session: Session, project, budgeted, config, dev_user
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    client.post(
        f"/api/builder/projects/{project.id}/publish",
        json={"name": "오늘 할 일", "description": "할 일 앱이에요.", "note": "첫 게시"},
    )
    [row] = client.get("/api/apps").json()
    assert row["name"] == "오늘 할 일" and row["description"] == "할 일 앱이에요."
    assert row["author_name"] == dev_user.display_name
    assert (row["version_number"], row["publish_note"]) == (1, "첫 게시")


# ------------------------------------------------------------ versions: 버전 저장


def test_a_version_can_be_named_and_pinned_and_pinned_ones_are_kept(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    named = client.patch(
        f"/api/builder/projects/{project.id}/versions/1", json={"label": "메모 기능 추가", "pinned": True}
    )
    assert named.status_code == 200 and (named.json()["label"], named.json()["pinned"]) == ("메모 기능 추가", True)

    for i in range(35):
        builder_versions.snapshot(db_session, project, f"v{i}", {"index.html": str(i)})
    db_session.commit()
    numbers = [v.number for v in builder_versions.list_versions(db_session, project)]
    assert 1 in numbers and len(numbers) == 31


def test_the_published_version_survives_pruning(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    publish(client, project)
    for i in range(35):
        builder_versions.snapshot(db_session, project, f"v{i}", {"index.html": str(i)})
    db_session.commit()
    db_session.refresh(project)
    assert project.published_version_number == 1


# ------------------------------------------------------------ reports and the admin


def member_client(other_user) -> TestClient:
    from tests.conftest import MEMBER_PASSWORD

    client = TestClient(app, headers=JSON_HEADERS)
    assert client.post(
        "/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD}
    ).status_code == 200
    return client


def test_a_member_reports_and_the_admin_takes_the_app_down_audited(
    client: TestClient, db_session: Session, project, budgeted, config, other_user, apps_dir
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    publish(client, project)
    db_session.refresh(project)
    slug = project.app_slug

    with member_client(other_user) as member:
        report = member.post(f"/api/apps/{slug}/report", json={"reason": "개인정보를 묻는 화면이 있어요"})
        assert report.status_code == 201
        again = member.post(f"/api/apps/{slug}/report", json={"reason": "또"})
        assert again.status_code == 409
        # A member cannot reach the admin side.
        assert member.get("/api/admin/apps/reports").status_code == 403

    reports = client.get("/api/admin/apps/reports").json()
    assert [(r["app_name"], r["still_listed"]) for r in reports] == [("할 일", True)]
    assert client.get("/api/admin/apps").json()[0]["open_reports"] == 1

    down = client.post(f"/api/admin/apps/{project.id}/unpublish", json={"reason": "개인정보 수집"})
    assert down.status_code == 200 and down.json()["reports_closed"] == 1
    assert client.get("/api/apps").json() == []
    assert not (apps_dir / slug).exists()
    row = db_session.query(AuditLog).filter_by(action="app.unpublished").one()
    assert "개인정보 수집" in row.summary and row.detail["version"] == 1
    assert client.get("/api/admin/apps/reports").json() == []
    assert db_session.query(AppReport).one().resolved_at is not None


def test_the_admin_can_close_a_report_and_keep_the_app(
    client: TestClient, db_session: Session, project, budgeted, config, other_user
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    publish(client, project)
    db_session.refresh(project)
    with member_client(other_user) as member:
        member.post(f"/api/apps/{project.app_slug}/report", json={"reason": "이상해요"})
    report_id = client.get("/api/admin/apps/reports").json()[0]["id"]

    assert client.post(f"/api/admin/apps/reports/{report_id}/resolve", json={"note": "문제 없음"}).status_code == 200
    assert len(client.get("/api/apps").json()) == 1
    assert db_session.query(AuditLog).filter_by(action="app_report.resolved").count() == 1


# ------------------------------------------------------------ F2: style


def test_the_chosen_style_reaches_claude_and_the_mock_varies_by_style(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    assert "원하는 스타일:\n레트로" in edit_request_text("앱", [], "만들어 줘", "레트로")
    one = BuilderProject(owner_user_id=dev_user.id, name="하나")
    two = BuilderProject(owner_user_id=dev_user.id, name="둘")
    db_session.add_all([one, two])
    db_session.commit()
    a = generate(client, one, "할 일 앱", style="귀여운")
    b = generate(client, two, "할 일 앱", style="게임")
    css = lambda body: next(f["content"] for f in body["files"] if f["path"] == "style.css")  # noqa: E731
    assert css(a) != css(b)


def test_the_prompts_ask_for_a_fitting_look_and_honesty_about_shared_apps() -> None:
    from app.services.claude_provider import CHAT_SYSTEM_PROMPT, EDIT_SYSTEM, STARTER_SYSTEM

    for prompt in (EDIT_SYSTEM, STARTER_SYSTEM):
        assert "its own look" in prompt and "no web fonts" in prompt
        assert "never shared with others" in prompt
        assert "Never use alert(), confirm() or prompt()" in prompt
    assert "keep every element id" in EDIT_SYSTEM
    # app-platform P4: shared boards and logins are possible now, through the 기능 상자.
    assert "logins, shared boards and data across members are possible" in CHAT_SYSTEM_PROMPT
    assert "cannot be made yet" not in CHAT_SYSTEM_PROMPT


# ------------------------------------------------------------ withdrawal


def test_a_withdrawal_that_unpublishes_takes_the_address_down(
    client: TestClient, db_session: Session, dev_user, other_user, other_participating, config, apps_dir, monkeypatch
) -> None:
    import app.core.config as config_module

    monkeypatch.setattr(config_module, "get_settings", lambda: config)
    other = BuilderProject(owner_user_id=other_user.id, name="남의 앱")
    db_session.add(other)
    db_session.flush()
    builder_versions.replace_files(db_session, other, {"index.html": "<p>남의 앱</p>"})
    builder_versions.snapshot(db_session, other, "처음")
    db_session.commit()
    with member_client(other_user) as member:
        assert publish(member, other).status_code == 200
        db_session.refresh(other)
        slug = other.app_slug
        assert (apps_dir / slug).is_dir()
        from tests.conftest import MEMBER_PASSWORD

        response = member.post(
            "/api/account/withdrawal", json={"password": MEMBER_PASSWORD, "published_work": "unpublish"}
        )
        assert response.status_code in (200, 201), response.text
    assert not (apps_dir / slug).exists()
    assert client.get("/api/apps").json() == []
    assert DEV_PASSWORD  # the admin client stayed signed in
