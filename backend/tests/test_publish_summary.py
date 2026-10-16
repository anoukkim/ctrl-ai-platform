"""publish-summary — the 게시 dialog's pre-filled text (owner, 2026-10-16).

Mock Claude only. The member's wallet never moves (an absorbed row at
0원); the text is kept per version and written once; an update's note
reads the runs since the published version; nothing here can block 게시.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import BuilderGeneration, BuilderProject, BuilderProjectVersion, UsageEvent
from app.services import app_publish, builder_versions
from app.services.claude_provider import ClaudeError, ProviderErrorKind


@pytest.fixture
def config(tmp_path):
    settings = Settings(app_env="development", chat_mock_delay_ms=0, apps_dir=str(tmp_path / "apps"), apps_base_url="http://apps.test")
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def make(db: Session, owner, name: str, note: str = "만들기: 메모장 앱") -> BuilderProject:
    project = BuilderProject(owner_user_id=owner.id, name=name, description="")
    db.add(project)
    db.flush()
    files = {"index.html": "<!doctype html><h1>메모</h1><script src='app.js'></script>", "app.js": "// 메모를 적어요"}
    builder_versions.replace_files(db, project, files)
    builder_versions.snapshot(db, project, note, files)
    db.commit()
    return project


def summary(client: TestClient, project: BuilderProject) -> dict:
    response = client.post(f"/api/builder/projects/{project.id}/publish-summary", json={})
    assert response.status_code == 200, response.text
    return response.json()


def test_the_description_is_written_once_free_to_the_member(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    project = make(db_session, dev_user, "메모장")
    wallet_before = client.get("/api/usage/me").json()["wallet"]["consumed_krw"]

    first = summary(client, project)
    assert "메모장" in first["description"] and first["note"] == "" and first["cached"] is False
    assert first["model"] and first["model"] != "fast"  # the catalogue model id, not the picker name
    rows = db_session.query(UsageEvent).all()
    assert len(rows) == 1
    assert rows[0].feature == "publish_summary" and rows[0].club_absorbed is True and rows[0].charged_krw == 0
    assert rows[0].builder_project_id == project.id and rows[0].input_tokens > 0
    assert client.get("/api/usage/me").json()["wallet"]["consumed_krw"] == wallet_before

    # Kept on the version: the second open sends nothing.
    second = summary(client, project)
    assert second["description"] == first["description"] and second["cached"] is True
    assert db_session.query(UsageEvent).count() == 1
    version = db_session.query(BuilderProjectVersion).filter_by(project_id=project.id).one()
    assert version.summary_description == first["description"] and version.summary_base_version is None


def test_an_update_gets_a_note_from_the_versions_since_the_published_one(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    project = make(db_session, dev_user, "메모장")
    app_publish.publish(db_session, config, project, description="메모장이에요", note="")
    db_session.commit()
    # Two more versions, one made by Claude (a generation), one by hand.
    files = {"index.html": "<!doctype html><h1>메모 v2</h1>", "app.js": "// 댓글"}
    builder_versions.replace_files(db_session, project, files)
    builder_versions.snapshot(db_session, project, "버전 저장", files)
    # The run after the 게시 (dated in the future: the test's transaction has one clock).
    db_session.add(
        BuilderGeneration(
            project_id=project.id, user_id=dev_user.id, kind="edit", request="댓글 기능 넣어 줘", style="",
            summary="댓글을 달 수 있게 했어요.", plan=[], files_done=[], check_fixed=[], status="done",
            created_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
    )
    builder_versions.snapshot(db_session, project, "v1로 되돌리기", files)
    db_session.commit()

    result = summary(client, project)
    assert result["description"] and result["note"] == "최근 요청대로 기능과 모양을 다듬었어요"
    latest = builder_versions.latest(db_session, project)
    db_session.refresh(latest)
    assert latest.summary_base_version == 1 and latest.summary_note == result["note"]

    # Published again (v3 is now the base): the same working version needs no new note.
    app_publish.publish(db_session, config, project, description="메모장이에요", note="")
    project.published_at = datetime.now(timezone.utc) + timedelta(minutes=90)
    files = {"index.html": "<!doctype html><h1>메모 v4</h1>", "app.js": "// 색"}
    builder_versions.replace_files(db_session, project, files)
    builder_versions.snapshot(db_session, project, "버전 저장", files)
    db_session.add(
        BuilderGeneration(
            project_id=project.id, user_id=dev_user.id, kind="edit", request="색 바꿔 줘", style="",
            summary="색을 바꿨어요.", plan=[], files_done=[], check_fixed=[], status="done",
            created_at=datetime.now(timezone.utc) + timedelta(hours=2),
        )
    )
    db_session.commit()
    again = summary(client, project)
    assert again["cached"] is False and again["note"] != ""
    assert db_session.query(UsageEvent).count() == 2


def test_a_failure_leaves_the_fields_empty_and_publishing_works(
    client: TestClient, db_session: Session, dev_user, budgeted, config, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services import publish_summary as service

    project = make(db_session, dev_user, "메모장")

    async def broken(provider, prepared):
        raise ClaudeError(ProviderErrorKind.TIMEOUT, "mock")
        yield  # pragma: no cover — makes this an async generator

    monkeypatch.setattr(service.app_ai, "run", broken)
    result = summary(client, project)
    assert result == {"description": "", "note": "", "cached": False, "model": "", "uses_ai": False, "ai_access": "demo"}
    assert db_session.query(UsageEvent).count() == 0
    # Nothing was kept, so the next open tries again.
    monkeypatch.undo()
    assert summary(client, project)["description"] != ""

    published = client.post(f"/api/builder/projects/{project.id}/publish", json={"description": "내가 쓴 설명"})
    assert published.status_code == 200


def test_no_index_html_means_no_summary(client: TestClient, db_session: Session, dev_user, budgeted, config) -> None:
    project = BuilderProject(owner_user_id=dev_user.id, name="빈 프로젝트", description="")
    db_session.add(project)
    db_session.commit()
    assert summary(client, project) == {"description": "", "note": "", "cached": False, "model": "", "uses_ai": False, "ai_access": "demo"}
    assert db_session.query(UsageEvent).count() == 0


def test_only_the_owner(client: TestClient, db_session: Session, dev_user, other_user, budgeted, config) -> None:
    mine = make(db_session, dev_user, "메모장")
    theirs = make(db_session, other_user, "남의 앱")
    assert client.post(f"/api/builder/projects/{theirs.id}/publish-summary", json={}).status_code == 404
    assert client.post(f"/api/builder/projects/{mine.id}/publish-summary", json={}).status_code == 200
    # A state-changing route: a JSON body is required (CLAUDE.md §2), and GET does nothing.
    assert client.post(f"/api/builder/projects/{mine.id}/publish-summary", content=b"{}", headers={"content-type": "text/plain"}).status_code == 415
    assert client.get(f"/api/builder/projects/{mine.id}/publish-summary").status_code == 405


def test_only_while_participating(other_client: TestClient, db_session: Session, other_user, config) -> None:
    # `client` and `other_client` share one cookie jar (conftest), so this stays its own test.
    theirs = make(db_session, other_user, "남의 앱")
    assert other_client.post(f"/api/builder/projects/{theirs.id}/publish-summary", json={}).status_code == 403


def test_a_moved_base_without_new_versions_costs_nothing_and_a_new_version_costs_only_a_note(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    """Publishing does not throw the description away: the base moves, the
    note is recomputed — without a call when nothing changed."""
    project = make(db_session, dev_user, "메모장")
    first = summary(client, project)
    app_publish.publish(db_session, config, project, description=first["description"], note="")
    db_session.commit()
    again = summary(client, project)
    assert again["description"] == first["description"] and again["note"] == "" and again["cached"] is False
    assert db_session.query(UsageEvent).count() == 1  # no second call
    assert summary(client, project)["cached"] is True


def test_a_paid_but_unusable_reply_is_kept_so_reopening_does_not_pay_again(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    # The mock answers prose, not JSON, when the files carry this marker.
    project = BuilderProject(owner_user_id=dev_user.id, name="메모장", description="")
    db_session.add(project)
    db_session.flush()
    files = {"index.html": "<!doctype html><h1>메모</h1>", "app.js": "// MOCK_ALWAYS_BAD_JSON"}
    builder_versions.replace_files(db_session, project, files)
    builder_versions.snapshot(db_session, project, "만들기", files)
    db_session.commit()
    first = summary(client, project)
    assert first["description"] == "" and first["note"] == "" and first["cached"] is False and first["model"]
    assert db_session.query(UsageEvent).count() == 1  # the club paid once
    second = summary(client, project)
    assert second["description"] == "" and second["cached"] is True
    assert db_session.query(UsageEvent).count() == 1
