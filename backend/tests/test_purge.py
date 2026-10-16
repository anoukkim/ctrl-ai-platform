"""Removing deleted work for good (ui-improvements B, owner 2026-10-16).

* an admin's 완전히 삭제 needs a reason, works only on Deleted Items, and
  removes the row, its versions and files, the app's folders and a
  video's stored files;
* **money rows survive** — the usage event stays, loses its project id
  (SET NULL) and keeps the project's name, so Usage still says what the
  charge was for;
* 분기 마감 purges everything still in Deleted Items, with one audit row;
* live work is never touched.
"""

from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes.usage import _label_for
from app.core.config import Settings, get_settings
from app.main import app
from app.models import (
    AppConsent,
    AppDataCollection,
    AppDataItem,
    AppDataWrite,
    AppFavorite,
    AppReport,
    AppSession,
    AuditAction,
    AuditLog,
    BuilderGeneration,
    BuilderProject,
    BuilderProjectFile,
    BuilderProjectVersion,
    FundingSource,
    Quarter,
    QuarterAllocation,
    UsageEvent,
    User,
    VideoProject,
    VideoVersion,
)
from app.services import purge as purge_service
from app.services.storage import get_storage

NOW = datetime(2026, 10, 16, 3, 0, tzinfo=timezone.utc)


@pytest.fixture
def config(tmp_path: Path) -> Settings:
    """Apps and stored files under a throwaway folder."""
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
def deleted_project(db_session: Session, dev_user: User, config: Settings) -> BuilderProject:
    """A deleted project with a version, a file, an app folder, a charge and
    one row in every 기능 상자 table that points at a project."""
    project = BuilderProject(
        owner_user_id=dev_user.id, name="가계부", description="", deleted_at=NOW, draft_slug="abc123xy"
    )
    db_session.add(project)
    db_session.flush()
    version = BuilderProjectVersion(project_id=project.id, number=1, note="예시 앱", files=[["index.html", "<p>hi</p>"]])
    db_session.add(version)
    db_session.add(BuilderProjectFile(project_id=project.id, path="index.html", content="<p>hi</p>"))
    db_session.flush()
    collection = AppDataCollection(project_id=project.id, space="shared", name="posts", kind="list")
    db_session.add(collection)
    db_session.flush()
    item = AppDataItem(
        public_id="p0000001", collection_id=collection.id, project_id=project.id, space="shared",
        author_user_id=dev_user.id, data={"text": "hi"}, size_bytes=12,
    )
    db_session.add(item)
    db_session.flush()
    db_session.add_all(
        [
            AppDataWrite(user_id=dev_user.id, project_id=project.id, created_at=NOW),
            AppConsent(user_id=dev_user.id, project_id=project.id, scopes=["profile"], app_user_id="u" * 20),
            AppSession(token_hash="t" * 64, user_id=dev_user.id, project_id=project.id, expires_at=NOW),
            AppFavorite(user_id=dev_user.id, project_id=project.id),
            AppReport(project_id=project.id, reporter_id=dev_user.id, reason="이상해요", data_item_id=item.id),
            BuilderGeneration(
                project_id=project.id, user_id=dev_user.id, kind="edit", request="댓글", style="",
                summary="", plan=[], files_done=[], check_fixed=[], status="done", version_id=version.id,
            ),
        ]
    )
    db_session.add(
        UsageEvent(
            user_id=dev_user.id, funding_source=FundingSource.COMMUNITY, provider="anthropic",
            feature="build", charged_krw=1_200, builder_project_id=project.id,
        )
    )
    folder = Path(config.apps_dir) / "abc123xy"
    folder.mkdir(parents=True)
    (folder / "index.html").write_text("<p>hi</p>")
    db_session.commit()
    db_session.refresh(project)
    return project


@pytest.fixture
def deleted_video(db_session: Session, dev_user: User, config: Settings) -> VideoProject:
    video = VideoProject(owner_user_id=dev_user.id, name="밤의 서울", prompt="야경", deleted_at=NOW)
    db_session.add(video)
    db_session.flush()
    key = f"video/{video.id}/1.mp4"
    get_storage(config).save(key, b"not really a video")
    db_session.add(
        VideoVersion(
            project_id=video.id, provider="higgsfield", model_id="kling-3.0-pro",
            prompt_snapshot="야경", asset_storage_key=key,
        )
    )
    db_session.add(
        UsageEvent(
            user_id=dev_user.id, funding_source=FundingSource.COMMUNITY, provider="higgsfield",
            feature="video_generate", charged_krw=3_000, video_project_id=video.id,
        )
    )
    db_session.commit()
    db_session.refresh(video)
    return video


def purge(client: TestClient, kind: str, item_id: int, reason: str = "회원 요청"):
    return client.request("DELETE", f"/api/admin/work/{kind}/{item_id}/purge", json={"reason": reason})


# ------------------------------------------------------------ 완전히 삭제


def test_purging_a_project_removes_the_row_its_children_and_its_folder_but_not_the_money(
    client: TestClient, db_session: Session, deleted_project: BuilderProject, config: Settings
) -> None:
    project_id = deleted_project.id
    assert purge(client, "builder", project_id, "회원이 완전 삭제를 요청함").status_code == 204

    db_session.expire_all()
    assert db_session.get(BuilderProject, project_id) is None
    assert db_session.scalar(select(BuilderProjectVersion).where(BuilderProjectVersion.project_id == project_id)) is None
    assert db_session.scalar(select(BuilderProjectFile).where(BuilderProjectFile.project_id == project_id)) is None
    # SQLite does not cascade, so every child table is proven empty here.
    for child in (AppDataItem, AppDataCollection, AppDataWrite, AppConsent, AppSession, AppFavorite, AppReport, BuilderGeneration):
        assert db_session.scalar(select(child).where(child.project_id == project_id)) is None, child
    assert not (Path(config.apps_dir) / "abc123xy").exists()
    assert client.get("/api/admin/deleted-items").json() == []

    # The charge is still there, detached from the row but still named.
    event = db_session.query(UsageEvent).one()
    assert event.charged_krw == 1_200
    assert event.builder_project_id is None
    assert event.work_label == "가계부"
    assert _label_for(db_session, event) == "Project Builder — 가계부 (삭제됨)"

    row = db_session.query(AuditLog).filter_by(action=AuditAction.WORK_PURGED).one()
    assert row.actor_username == "dev" and row.target_label == "dev"
    assert "가계부" in row.summary and row.detail["reason"] == "회원이 완전 삭제를 요청함"
    assert row.detail["versions"] == 1 and row.detail["files"] == 1 and row.detail["usage_events"] == 1


def test_a_long_reason_fits_because_it_lives_in_the_detail(
    client: TestClient, db_session: Session, deleted_project: BuilderProject
) -> None:
    # The summary column holds 300 characters (PostgreSQL enforces it; the
    # PG test run proves this), the reason up to 500 — so the reason is
    # kept in `detail`, and the summary stays short whatever its length.
    reason = "가" * 500
    assert purge(client, "builder", deleted_project.id, reason).status_code == 204
    row = db_session.query(AuditLog).filter_by(action=AuditAction.WORK_PURGED).one()
    assert len(row.summary) <= 300 and row.detail["reason"] == reason


def test_a_blank_reason_is_refused(client: TestClient, db_session: Session, deleted_project: BuilderProject) -> None:
    assert purge(client, "builder", deleted_project.id, "   ").status_code == 422
    assert purge(client, "builder", deleted_project.id, " 회원 요청 ").status_code == 204
    row = db_session.query(AuditLog).filter_by(action=AuditAction.WORK_PURGED).one()
    assert row.detail["reason"] == "회원 요청"


def test_a_restore_in_between_wins_over_the_purge(
    db_session: Session, deleted_project: BuilderProject, dev_user: User, budgeted: QuarterAllocation
) -> None:
    """The purge locks the row and looks at `deleted_at` again: an admin who
    restored it after the list was drawn keeps it."""
    from sqlalchemy import update

    stale = deleted_project  # loaded while still deleted
    db_session.execute(update(BuilderProject).where(BuilderProject.id == stale.id).values(deleted_at=None))
    with pytest.raises(ValueError):
        purge_service.purge(db_session, stale)
    quarter = db_session.get(Quarter, budgeted.quarter_id)
    assert purge_service.purge_all_deleted(db_session, admin=dev_user, quarter=quarter) == []
    db_session.expire_all()
    assert db_session.get(BuilderProject, stale.id) is not None


def test_purging_a_video_removes_its_stored_file(
    client: TestClient, db_session: Session, deleted_video: VideoProject, config: Settings
) -> None:
    video_id = deleted_video.id
    storage = get_storage(config)
    assert storage.exists(f"video/{video_id}/1.mp4")

    assert purge(client, "video", video_id).status_code == 204

    db_session.expire_all()
    assert db_session.get(VideoProject, video_id) is None
    assert db_session.scalar(select(VideoVersion).where(VideoVersion.project_id == video_id)) is None
    assert not storage.exists(f"video/{video_id}/1.mp4")
    event = db_session.query(UsageEvent).one()
    assert event.video_project_id is None and event.work_label == "밤의 서울"
    assert _label_for(db_session, event) == "영상 생성 — 밤의 서울 (삭제됨)"


def test_an_app_charge_keeps_its_name_too(
    client: TestClient, db_session: Session, dev_user: User, deleted_project: BuilderProject
) -> None:
    db_session.add(
        UsageEvent(
            user_id=dev_user.id, funding_source=FundingSource.COMMUNITY, provider="anthropic",
            feature="app_ai", charged_krw=40, builder_project_id=deleted_project.id,
        )
    )
    db_session.commit()
    assert purge(client, "builder", deleted_project.id).status_code == 204
    db_session.expire_all()
    event = db_session.query(UsageEvent).filter_by(feature="app_ai").one()
    assert _label_for(db_session, event) == "앱 · 가계부 (삭제됨)"


def test_live_work_cannot_be_purged(client: TestClient, db_session: Session, dev_user: User) -> None:
    project = BuilderProject(owner_user_id=dev_user.id, name="살아 있음", description="")
    db_session.add(project)
    db_session.commit()

    response = purge(client, "builder", project.id)
    assert response.status_code == 400
    assert "먼저 삭제" in response.json()["detail"]
    db_session.expire_all()
    assert db_session.get(BuilderProject, project.id) is not None


def test_a_reason_is_required(client: TestClient, db_session: Session, deleted_project: BuilderProject) -> None:
    # Without a body the request never reaches the route (every
    # state-changing route takes a JSON body, CLAUDE.md §2); an empty
    # reason is refused by the schema. Either way nothing is removed.
    assert client.request("DELETE", f"/api/admin/work/builder/{deleted_project.id}/purge").status_code in (403, 422)
    assert purge(client, "builder", deleted_project.id, "").status_code == 422
    assert purge(client, "builder", 99_999).status_code == 404
    assert purge(client, "apps", deleted_project.id).status_code == 404
    db_session.expire_all()
    assert db_session.get(BuilderProject, deleted_project.id) is not None


def test_only_admins_may_purge(other_client: TestClient, db_session: Session, deleted_project: BuilderProject) -> None:
    assert purge(other_client, "builder", deleted_project.id).status_code == 403
    db_session.expire_all()
    assert db_session.get(BuilderProject, deleted_project.id) is not None


# ------------------------------------------------------------ 분기 마감


def test_closing_the_quarter_purges_everything_still_deleted(
    client: TestClient,
    db_session: Session,
    dev_user: User,
    budgeted: QuarterAllocation,
    deleted_project: BuilderProject,
    deleted_video: VideoProject,
    config: Settings,
) -> None:
    live = BuilderProject(owner_user_id=dev_user.id, name="살아 있음", description="")
    db_session.add(live)
    db_session.commit()
    quarter_id = budgeted.quarter_id

    preview = client.get(f"/api/admin/quarters/{quarter_id}/close-preview").json()
    assert preview["purge_count"] == 2

    closed = client.post(f"/api/admin/quarters/{quarter_id}/close", json={"carry_over_percent": 0})
    assert closed.status_code == 200, closed.text
    assert closed.json()["purge_count"] == 2

    db_session.expire_all()
    assert db_session.get(BuilderProject, deleted_project.id) is None
    assert db_session.get(VideoProject, deleted_video.id) is None
    assert db_session.get(BuilderProject, live.id) is not None
    assert not (Path(config.apps_dir) / "abc123xy").exists()
    assert client.get("/api/admin/deleted-items").json() == []

    # Money untouched: both charges kept, the wallet frozen as before.
    assert db_session.query(UsageEvent).count() == 2
    assert {e.work_label for e in db_session.query(UsageEvent)} == {"가계부", "밤의 서울"}
    db_session.refresh(budgeted)
    assert budgeted.frozen_at is not None

    row = db_session.query(AuditLog).filter_by(action=AuditAction.WORK_PURGED_AT_CLOSE).one()
    assert row.detail["count"] == 2 and {i["name"] for i in row.detail["items"]} == {"가계부", "밤의 서울"}
    assert db_session.query(AuditLog).filter_by(action=AuditAction.QUARTER_CLOSED).count() == 1

    # The closed quarter's preview reports what the close removed.
    after = client.get(f"/api/admin/quarters/{quarter_id}/close-preview").json()
    assert after["closed"] is True and after["purge_count"] == 2


def test_closing_keeps_work_deleted_after_the_quarters_last_day(
    client: TestClient, db_session: Session, dev_user: User, budgeted: QuarterAllocation, deleted_project: BuilderProject
) -> None:
    """A quarter closed late does not take this week's deletions with it;
    they wait for the quarter they were deleted in."""
    quarter = db_session.get(Quarter, budgeted.quarter_id)
    after_end = datetime(quarter.ends_at.year + 1, 1, 2, 3, 0, tzinfo=timezone.utc)
    late = BuilderProject(owner_user_id=dev_user.id, name="나중에 지움", description="", deleted_at=after_end)
    db_session.add(late)
    db_session.commit()
    quarter_id = budgeted.quarter_id

    assert client.get(f"/api/admin/quarters/{quarter_id}/close-preview").json()["purge_count"] == 1
    closed = client.post(f"/api/admin/quarters/{quarter_id}/close", json={"carry_over_percent": 0})
    assert closed.status_code == 200 and closed.json()["purge_count"] == 1

    db_session.expire_all()
    assert db_session.get(BuilderProject, deleted_project.id) is None
    assert db_session.get(BuilderProject, late.id) is not None
    assert [row["name"] for row in client.get("/api/admin/deleted-items").json()] == ["나중에 지움"]


def test_closing_with_nothing_deleted_writes_no_purge_row(
    client: TestClient, db_session: Session, budgeted: QuarterAllocation
) -> None:
    closed = client.post(f"/api/admin/quarters/{budgeted.quarter_id}/close", json={"carry_over_percent": 0})
    assert closed.status_code == 200 and closed.json()["purge_count"] == 0
    assert db_session.query(AuditLog).filter_by(action=AuditAction.WORK_PURGED_AT_CLOSE).count() == 0
