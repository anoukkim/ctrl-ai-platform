"""Deleting a project hides it; it never destroys it.

The rule being proven, from the `project-video-management` spec:

* the owner may delete, while participating — and nobody else may;
* the row survives, so an admin can restore it;
* usage already spent stays recorded **and stays attached** to the
  project it paid for;
* an admin may delete anyone's work, and that is written to the audit log.

The last point is why this file exists at all rather than a few more
assertions in `test_builder_projects.py`: the interesting behaviour spans
both products and the admin routes.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    AuditAction,
    AuditLog,
    BudgetCategory,
    BuilderProject,
    FundingSource,
    MembershipStatus,
    UsageEvent,
    User,
    VideoProject,
    VideoVersion,
)
from app.services.quarters import set_membership


@pytest.fixture
def my_project(db_session: Session, dev_user: User) -> BuilderProject:
    project = BuilderProject(owner_user_id=dev_user.id, name="가계부", description="지출 기록")
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    return project


@pytest.fixture
def my_video(db_session: Session, dev_user: User) -> VideoProject:
    project = VideoProject(owner_user_id=dev_user.id, name="밤의 서울", prompt="야경")
    db_session.add(project)
    db_session.flush()
    db_session.add(
        VideoVersion(
            project_id=project.id,
            provider="higgsfield",
            model_id="kling-3.0-pro",
            prompt_snapshot="야경",
        )
    )
    db_session.commit()
    db_session.refresh(project)
    return project


# ------------------------------------------------------- the owner deletes


def test_deleting_hides_the_project_but_keeps_the_row(
    client: TestClient, db_session: Session, my_project: BuilderProject, participating
) -> None:
    assert client.delete(f"/api/builder/projects/{my_project.id}").status_code == 204

    # Gone from the member's side, through every route.
    assert client.get("/api/builder/projects").json() == []
    assert client.get(f"/api/builder/projects/{my_project.id}").status_code == 404
    assert client.patch(
        f"/api/builder/projects/{my_project.id}", json={"name": "되살리기"}
    ).status_code == 404

    # Still in the database, marked.
    db_session.expire_all()
    row = db_session.get(BuilderProject, my_project.id)
    assert row is not None
    assert row.deleted_at is not None
    assert row.is_deleted


def test_deleting_a_video_keeps_its_versions(
    client: TestClient, db_session: Session, my_video: VideoProject, participating
) -> None:
    """Restoring has to bring back the attempts, so the cascade must not run."""
    assert client.delete(f"/api/video/projects/{my_video.id}").status_code == 204

    assert client.get("/api/video/projects").json() == []
    assert client.get(f"/api/video/projects/{my_video.id}").status_code == 404

    db_session.expire_all()
    row = db_session.get(VideoProject, my_video.id)
    assert row is not None
    assert row.deleted_at is not None
    assert len(row.versions) == 1


def test_usage_history_survives_and_stays_attached(
    client: TestClient, db_session: Session, dev_user: User, my_project: BuilderProject, participating
) -> None:
    """Money already spent stays recorded — and still names its project.

    A hard delete would have left the ledger row with a null
    `builder_project_id` (the FK is `ON DELETE SET NULL`), so the spending
    would survive but no longer say what it was for.
    """
    db_session.add(
        UsageEvent(
            user_id=dev_user.id,
            category=BudgetCategory.BUILD,
            funding_source=FundingSource.COMMUNITY_BUILD,
            provider="anthropic",
            charged_krw=1_200,
            builder_project_id=my_project.id,
        )
    )
    db_session.commit()

    client.delete(f"/api/builder/projects/{my_project.id}")

    db_session.expire_all()
    events = db_session.query(UsageEvent).all()
    assert len(events) == 1
    assert events[0].charged_krw == 1_200
    assert events[0].builder_project_id == my_project.id


def test_another_member_cannot_delete_my_project(
    other_client: TestClient, db_session: Session, my_project: BuilderProject, other_participating
) -> None:
    assert other_client.delete(f"/api/builder/projects/{my_project.id}").status_code == 404

    db_session.expire_all()
    assert db_session.get(BuilderProject, my_project.id).deleted_at is None


def test_an_inactive_owner_cannot_delete(
    client: TestClient, db_session: Session, dev_user: User, my_project: BuilderProject, participating
) -> None:
    """Deleting is a change, so it follows the participation rule.

    `tests/test_membership_access.py` sweeps every guarded route; this
    repeats one of them here because the soft delete is what makes "the
    row is untouched" checkable at all.
    """
    set_membership(db_session, dev_user.id, participating.id, MembershipStatus.INACTIVE)
    db_session.commit()

    assert client.delete(f"/api/builder/projects/{my_project.id}").status_code == 403

    db_session.expire_all()
    assert db_session.get(BuilderProject, my_project.id).deleted_at is None
    # And they can still read it.
    assert client.get(f"/api/builder/projects/{my_project.id}").status_code == 200


# --------------------------------------------------------------- admin side


def test_admin_sees_deleted_items_from_both_products(
    client: TestClient, my_project: BuilderProject, my_video: VideoProject, participating
) -> None:
    client.delete(f"/api/builder/projects/{my_project.id}")
    client.delete(f"/api/video/projects/{my_video.id}")

    items = client.get("/api/admin/deleted-items").json()

    assert {item["kind"] for item in items} == {"builder", "video"}
    assert {item["name"] for item in items} == {"가계부", "밤의 서울"}
    assert all(item["owner_username"] for item in items)


def test_live_items_are_not_in_the_deleted_list(
    client: TestClient, my_project: BuilderProject, participating
) -> None:
    assert client.get("/api/admin/deleted-items").json() == []


def test_admin_restores_a_deleted_project(
    client: TestClient, db_session: Session, my_project: BuilderProject, participating
) -> None:
    client.delete(f"/api/builder/projects/{my_project.id}")

    restored = client.post(f"/api/admin/work/builder/{my_project.id}/restore")

    assert restored.status_code == 204
    # The owner can see it again.
    assert [p["name"] for p in client.get("/api/builder/projects").json()] == ["가계부"]
    assert client.get("/api/admin/deleted-items").json() == []


def test_restoring_a_video_brings_its_versions_back(
    client: TestClient, my_video: VideoProject, participating
) -> None:
    client.delete(f"/api/video/projects/{my_video.id}")
    client.post(f"/api/admin/work/video/{my_video.id}/restore")

    body = client.get(f"/api/video/projects/{my_video.id}").json()

    assert len(body["versions"]) == 1


def test_restoring_something_that_is_not_deleted_is_refused(
    client: TestClient, my_project: BuilderProject
) -> None:
    """A stale list must not look like a successful restore."""
    response = client.post(f"/api/admin/work/builder/{my_project.id}/restore")

    assert response.status_code == 400
    assert "삭제된 항목이 아닙니다" in response.json()["detail"]


def test_admin_deletes_another_members_work_and_it_is_audited(
    client: TestClient, db_session: Session, other_user: User
) -> None:
    """The admin is not enrolled in any quarter here, on purpose.

    Moderating is not creating, so `require_active_member` must not apply
    — otherwise an admin could only moderate in quarters they joined.
    """
    theirs = BuilderProject(owner_user_id=other_user.id, name="남의 앱")
    db_session.add(theirs)
    db_session.commit()

    assert client.delete(f"/api/admin/work/builder/{theirs.id}").status_code == 204

    db_session.expire_all()
    assert db_session.get(BuilderProject, theirs.id).deleted_at is not None

    row = db_session.query(AuditLog).filter_by(action=AuditAction.WORK_DELETED).one()
    assert row.target_type == "builder"
    assert row.target_id == theirs.id
    assert row.target_label == other_user.username
    assert "남의 앱" in row.summary


def test_restoring_is_audited(
    client: TestClient, db_session: Session, my_project: BuilderProject, participating
) -> None:
    client.delete(f"/api/builder/projects/{my_project.id}")
    client.post(f"/api/admin/work/builder/{my_project.id}/restore")

    row = db_session.query(AuditLog).filter_by(action=AuditAction.WORK_RESTORED).one()
    assert "가계부" in row.summary
    assert row.detail["deleted_at"]


def test_a_members_own_delete_is_not_in_the_audit_log(
    client: TestClient, db_session: Session, my_project: BuilderProject, participating
) -> None:
    """The log is for admin changes. Members using the product is not one."""
    client.delete(f"/api/builder/projects/{my_project.id}")

    assert db_session.query(AuditLog).filter_by(action=AuditAction.WORK_DELETED).count() == 0


def test_a_member_cannot_reach_the_admin_work_routes(
    other_client: TestClient, db_session: Session, my_project: BuilderProject
) -> None:
    assert other_client.get("/api/admin/deleted-items").status_code == 403
    assert other_client.delete(f"/api/admin/work/builder/{my_project.id}").status_code == 403
    assert (
        other_client.post(f"/api/admin/work/builder/{my_project.id}/restore").status_code == 403
    )


def test_an_unknown_kind_is_not_found(client: TestClient) -> None:
    assert client.delete("/api/admin/work/apps/1").status_code == 404
    assert client.post("/api/admin/work/apps/1/restore").status_code == 404
