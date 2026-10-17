"""ctrlaiapps-reactions — reactions and comments on a published app.

CtrlAITube's rules for CtrlAIApps: three reactions toggled per member,
one level of replies, the author edits and deletes, 신고 to Admin ›
Content, admin hide / delete (audited), 반응을 얻었어요 for the maker, and
nothing of it visible once the app is unpublished or deleted.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import AppComment, AppCommentReport, AppReaction, AuditLog, BuilderProject, Notification
from tests.conftest import DEV_PASSWORD, MEMBER_PASSWORD
from tests.test_thumbnails import config, publish  # noqa: F401 — the fixture


@pytest.fixture
def app_slug(client: TestClient, db_session: Session, dev_user, budgeted, config) -> str:
    project = BuilderProject(owner_user_id=dev_user.id, name="동아리 게시판", description="")
    db_session.add(project)
    db_session.commit()
    publish(client, project)
    db_session.expire_all()
    return db_session.get(BuilderProject, project.id).app_slug


def as_member(client: TestClient, user) -> None:
    client.post("/api/auth/logout", json={})
    assert client.post("/api/auth/login", json={"username": user.username, "password": MEMBER_PASSWORD}).status_code == 200


def as_dev(client: TestClient, user) -> None:
    client.post("/api/auth/logout", json={})
    assert client.post("/api/auth/login", json={"username": user.username, "password": DEV_PASSWORD}).status_code == 200


def test_reactions_toggle_and_count_and_the_maker_hears(
    client: TestClient, db_session: Session, app_slug, other_user, other_participating, dev_user
) -> None:
    empty = client.get(f"/api/apps/{app_slug}/discussion").json()
    assert empty == {"reactions": {"like": 0, "useful": 0, "interesting": 0}, "my_reactions": [], "comment_count": 0, "comments": []}
    as_member(client, other_user)
    on = client.post(f"/api/apps/{app_slug}/reactions", json={"kind": "like"}).json()
    assert on["reactions"]["like"] == 1 and on["my_reactions"] == ["like"]
    off = client.post(f"/api/apps/{app_slug}/reactions", json={"kind": "like"}).json()
    assert off["reactions"]["like"] == 0 and off["my_reactions"] == []
    assert client.post(f"/api/apps/{app_slug}/reactions", json={"kind": "angry"}).status_code == 400
    client.post(f"/api/apps/{app_slug}/reactions", json={"kind": "useful"})
    db_session.expire_all()
    # One notification row for the maker that counts (on/off/on is one member).
    rows = db_session.query(Notification).filter_by(user_id=dev_user.id).all()
    assert any("동아리 게시판" in row.title for row in rows)


def test_comments_replies_edit_delete_and_only_the_author(
    client: TestClient, db_session: Session, app_slug, other_user, other_participating, dev_user
) -> None:
    created = client.post(f"/api/apps/{app_slug}/comments", json={"body": "멋진 앱이에요"})
    assert created.status_code == 201, created.text
    comment_id = created.json()["comments"][0]["id"]
    assert created.json()["comments"][0]["mine"] is True
    as_member(client, other_user)
    reply = client.post(f"/api/apps/{app_slug}/comments", json={"body": "저도요", "parent_id": comment_id}).json()
    assert reply["comment_count"] == 2
    assert [r["body"] for r in reply["comments"][0]["replies"]] == ["저도요"]
    # Another member's comment cannot be edited or deleted (404).
    assert client.patch(f"/api/apps/comments/{comment_id}", json={"body": "x"}).status_code == 404
    assert client.delete(f"/api/apps/comments/{comment_id}").status_code == 404
    reply_id = reply["comments"][0]["replies"][0]["id"]
    assert client.patch(f"/api/apps/comments/{reply_id}", json={"body": "저도 좋아요"}).status_code == 200
    assert client.delete(f"/api/apps/comments/{reply_id}").status_code == 204
    after = client.get(f"/api/apps/{app_slug}/discussion").json()
    assert after["comment_count"] == 1 and after["comments"][0]["replies"] == []
    # The JSON-body rule holds.
    assert client.post(
        f"/api/apps/{app_slug}/comments", content="body=x", headers={"Content-Type": "application/x-www-form-urlencoded"}
    ).status_code in (415, 422)


def test_report_hide_delete_and_resolve_are_audited(
    client: TestClient, db_session: Session, app_slug, other_user, other_participating, dev_user
) -> None:
    as_member(client, other_user)
    comment_id = client.post(f"/api/apps/{app_slug}/comments", json={"body": "광고 링크"}).json()["comments"][0]["id"]
    as_dev(client, dev_user)
    reported = client.post(f"/api/apps/comments/{comment_id}/report", json={"reason": "광고예요"})
    assert reported.status_code == 201
    assert client.post(f"/api/apps/comments/{comment_id}/report", json={"reason": "또"}).status_code == 409
    queue = client.get("/api/admin/tube/app-reports").json()
    assert queue[0]["app_slug"] == app_slug and queue[0]["excerpt"] == "광고 링크" and queue[0]["comment_live"]
    hidden = client.post(f"/api/admin/tube/app-comments/{comment_id}/hide", json={"reason": "광고"})
    assert hidden.json()["reports_closed"] == 1
    assert client.get(f"/api/apps/{app_slug}/discussion").json()["comment_count"] == 0
    assert client.get("/api/admin/tube/app-reports").json() == []
    db_session.expire_all()
    assert db_session.query(AuditLog).filter_by(action="app_comment.hidden").count() == 1
    # Delete for good, and a kept-comment resolve.
    as_member(client, other_user)
    second = client.post(f"/api/apps/{app_slug}/comments", json={"body": "괜찮아요"}).json()["comments"][0]["id"]
    as_dev(client, dev_user)
    report_id = client.post(f"/api/apps/comments/{second}/report", json={"reason": "확인"}).json() and (
        client.get("/api/admin/tube/app-reports").json()[0]["id"]
    )
    assert client.post(f"/api/admin/tube/app-reports/{report_id}/resolve", json={"note": "문제 없음"}).status_code == 200
    assert client.post(f"/api/admin/tube/app-comments/{second}/delete", json={"reason": "정리"}).status_code == 200
    db_session.expire_all()
    assert db_session.query(AppComment).filter_by(id=second).count() == 0
    assert db_session.query(AuditLog).filter(AuditLog.action.like("app_comment%")).count() == 3
    # Members cannot use the admin queue.
    as_member(client, other_user)
    assert client.get("/api/admin/tube/app-reports").status_code == 403


def test_nothing_shows_once_the_app_is_unpublished_or_deleted(
    client: TestClient, db_session: Session, app_slug, dev_user
) -> None:
    comment_id = client.post(f"/api/apps/{app_slug}/comments", json={"body": "안녕"}).json()["comments"][0]["id"]
    project = db_session.query(BuilderProject).filter_by(app_slug=app_slug).one()
    unpublished = client.post(f"/api/builder/projects/{project.id}/unpublish", json={})
    assert unpublished.status_code == 200, unpublished.text
    assert client.get(f"/api/apps/{app_slug}/discussion").status_code == 404
    assert client.post(f"/api/apps/{app_slug}/comments", json={"body": "x"}).status_code == 404
    assert client.patch(f"/api/apps/comments/{comment_id}", json={"body": "y"}).status_code == 404
    assert client.post(f"/api/apps/comments/{comment_id}/report", json={"reason": "z"}).status_code == 404


def test_a_member_not_participating_reads_but_cannot_write(
    client: TestClient, db_session: Session, app_slug, other_user
) -> None:
    as_member(client, other_user)  # other_user has no membership this quarter
    assert client.get(f"/api/apps/{app_slug}/discussion").status_code == 200
    assert client.post(f"/api/apps/{app_slug}/reactions", json={"kind": "like"}).status_code == 403
    assert client.post(f"/api/apps/{app_slug}/comments", json={"body": "x"}).status_code == 403


def test_purge_removes_the_discussion(client: TestClient, db_session: Session, app_slug, dev_user) -> None:
    from datetime import datetime, timezone

    from app.services import purge

    comment_id = client.post(f"/api/apps/{app_slug}/comments", json={"body": "안녕"}).json()["comments"][0]["id"]
    client.post(f"/api/apps/{app_slug}/comments", json={"body": "답", "parent_id": comment_id})
    client.post(f"/api/apps/{app_slug}/reactions", json={"kind": "like"})
    client.post(f"/api/apps/comments/{comment_id}/report", json={"reason": "확인"})
    project = db_session.query(BuilderProject).filter_by(app_slug=app_slug).one()
    project.deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    purge.purge(db_session, project)
    db_session.commit()
    assert db_session.query(AppComment).count() == 0
    assert db_session.query(AppReaction).count() == 0
    assert db_session.query(AppCommentReport).count() == 0
