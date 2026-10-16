"""CtrlAITube — the club's promo video with real reactions and comments
(promo-videos, 2026-10-16).

The official row appears by itself; reads need an account, reacting and
commenting need a participant; a comment is its author's (another's is a
404); 신고 reaches Admin › Content, whose hide/delete are audited; a hidden
or deleted comment is simply gone from every read.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.models import AuditLog, TubeComment, TubeReport, TubeVideo
from app.services import tube
from tests.conftest import JSON_HEADERS, MEMBER_PASSWORD

SLUG = tube.OFFICIAL_SLUG


@pytest.fixture
def member_client(other_user, other_participating):
    """A second, separate client (its own cookie jar) signed in as `other`."""
    with TestClient(app, headers=JSON_HEADERS) as second:
        response = second.post("/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD})
        assert response.status_code == 200, response.text
        yield second


def comment(c: TestClient, body: str, parent_id: int | None = None) -> dict:
    response = c.post(f"/api/tube/videos/{SLUG}/comments", json={"body": body, "parent_id": parent_id})
    assert response.status_code == 201, response.text
    return response.json()


def detail(c: TestClient) -> dict:
    response = c.get(f"/api/tube/videos/{SLUG}")
    assert response.status_code == 200, response.text
    return response.json()


# ------------------------------------------------------------------ the feed


def test_the_official_video_leads_the_feed_and_needs_an_account(client: TestClient, db_session: Session):
    with TestClient(app, headers=JSON_HEADERS) as signed_out:
        assert signed_out.get("/api/tube/videos").status_code == 401
        assert signed_out.get(f"/api/tube/videos/{SLUG}").status_code == 401

    rows = client.get("/api/tube/videos").json()
    assert [r["slug"] for r in rows] == [SLUG]
    official = rows[0]
    assert official["official"] is True and official["kind"] == "hosted" and official["creator"] is None
    assert official["hosted_desktop_src"].startswith("/promo/") and official["hosted_mobile_src"].startswith("/promo/")
    assert official["poster_desktop_src"].endswith(".jpg") and official["duration_seconds"] == 60
    assert official["reactions"] == {"like": 0, "useful": 0, "interesting": 0}
    assert official["my_reactions"] == [] and official["comment_count"] == 0

    # Made once, not once per read.
    client.get("/api/tube/videos")
    assert db_session.query(TubeVideo).count() == 1


def test_a_deleted_video_never_resurfaces(client: TestClient, db_session: Session):
    client.get("/api/tube/videos")
    from datetime import datetime, timezone

    row = db_session.query(TubeVideo).one()
    row.deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    assert client.get("/api/tube/videos").json() == []
    assert client.get(f"/api/tube/videos/{SLUG}").status_code == 404


# ----------------------------------------------------------------- reactions


def test_a_reaction_toggles_and_needs_a_participant(client: TestClient, db_session: Session, dev_user, participating):
    on = client.post(f"/api/tube/videos/{SLUG}/reactions", json={"kind": "useful"})
    assert on.status_code == 200 and on.json()["on"] is True and on.json()["reactions"]["useful"] == 1
    assert detail(client)["my_reactions"] == ["useful"]

    off = client.post(f"/api/tube/videos/{SLUG}/reactions", json={"kind": "useful"})
    assert off.json()["on"] is False and off.json()["reactions"]["useful"] == 0
    assert detail(client)["my_reactions"] == []

    assert client.post(f"/api/tube/videos/{SLUG}/reactions", json={"kind": "angry"}).status_code == 400


def test_a_member_sitting_out_the_quarter_may_read_but_not_react(other_client: TestClient):
    assert other_client.get(f"/api/tube/videos/{SLUG}").status_code == 200
    assert other_client.post(f"/api/tube/videos/{SLUG}/reactions", json={"kind": "like"}).status_code == 403
    assert other_client.post(f"/api/tube/videos/{SLUG}/comments", json={"body": "안녕"}).status_code == 403


# ------------------------------------------------------------------ comments


def test_comments_and_one_level_of_replies(client: TestClient, participating):
    first = comment(client, "  첫 댓글이에요  ")
    assert first["body"] == "첫 댓글이에요" and first["mine"] is True and first["author"]["membership"] == "active"
    reply = comment(client, "답글", parent_id=first["id"])
    nested = comment(client, "답글의 답글", parent_id=reply["id"])  # hangs under `first`, not under `reply`

    view = detail(client)
    assert view["comment_count"] == 3
    assert [c["id"] for c in view["comments"]] == [first["id"]]
    assert [r["id"] for r in view["comments"][0]["replies"]] == [reply["id"], nested["id"]]

    assert client.post(f"/api/tube/videos/{SLUG}/comments", json={"body": "   "}).status_code == 400
    assert client.post(f"/api/tube/videos/{SLUG}/comments", json={"body": "x", "parent_id": 999}).status_code == 404


def test_only_the_author_edits_or_deletes_and_others_see_a_404(
    client: TestClient, member_client: TestClient, participating
):
    mine = comment(client, "내 댓글")

    # The other member: the comment is readable but not theirs.
    seen = detail(member_client)["comments"][0]
    assert seen["id"] == mine["id"] and seen["mine"] is False
    assert member_client.patch(f"/api/tube/comments/{mine['id']}", json={"body": "바꿈"}).status_code == 404
    assert member_client.delete(f"/api/tube/comments/{mine['id']}").status_code == 404
    assert detail(client)["comments"][0]["body"] == "내 댓글"

    edited = client.patch(f"/api/tube/comments/{mine['id']}", json={"body": "고친 댓글"})
    assert edited.status_code == 200 and edited.json()["body"] == "고친 댓글"

    assert client.delete(f"/api/tube/comments/{mine['id']}").status_code == 204
    assert detail(client)["comments"] == [] and detail(client)["comment_count"] == 0
    assert client.patch(f"/api/tube/comments/{mine['id']}", json={"body": "다시"}).status_code == 404


def test_deleting_a_parent_keeps_its_replies_at_the_top(client: TestClient, member_client: TestClient, participating):
    parent = comment(client, "부모")
    reply = comment(member_client, "답글", parent_id=parent["id"])
    client.delete(f"/api/tube/comments/{parent['id']}")
    view = detail(client)
    assert [c["id"] for c in view["comments"]] == [reply["id"]]


# ------------------------------------------------------------------- reports


def test_a_report_reaches_the_admin_queue_and_hiding_closes_it(
    client: TestClient, member_client: TestClient, db_session: Session, participating
):
    bad = comment(member_client, "나쁜 댓글")

    # 신고: once per member per comment while open.
    reported = client.post(f"/api/tube/comments/{bad['id']}/report", json={"reason": "욕설"})
    assert reported.status_code == 201
    assert client.post(f"/api/tube/comments/{bad['id']}/report", json={"reason": "또"}).status_code == 409
    assert client.post("/api/tube/comments/999/report", json={"reason": "없음"}).status_code == 404

    # Only the admin sees the queue.
    assert member_client.get("/api/admin/tube/reports").status_code == 403
    queue = client.get("/api/admin/tube/reports").json()
    assert len(queue) == 1
    row = queue[0]
    assert row["comment_id"] == bad["id"] and row["excerpt"] == "나쁜 댓글" and row["comment_live"] is True
    assert row["video_slug"] == SLUG and row["author_username"] == "other" and row["reporter_username"] == "dev"

    # The reason is required; hiding closes the report and is audited.
    assert client.post(f"/api/admin/tube/comments/{bad['id']}/hide", json={"reason": ""}).status_code == 400
    hidden = client.post(f"/api/admin/tube/comments/{bad['id']}/hide", json={"reason": "욕설이 맞음"})
    assert hidden.status_code == 200 and hidden.json()["reports_closed"] == 1
    assert client.get("/api/admin/tube/reports").json() == []
    assert detail(member_client)["comments"] == [] and detail(member_client)["comment_count"] == 0
    # The author cannot edit a hidden comment either.
    assert member_client.patch(f"/api/tube/comments/{bad['id']}", json={"body": "x"}).status_code == 404

    audit = db_session.query(AuditLog).filter(AuditLog.action == "tube_comment.hidden").one()
    assert audit.target_id == bad["id"] and audit.detail["reason"] == "욕설이 맞음" and audit.detail["reports_closed"] == 1
    stored = db_session.get(TubeComment, bad["id"])
    assert stored.hidden_at is not None and stored.hidden_reason == "욕설이 맞음" and stored.deleted_at is None


def test_the_admin_deletes_a_comment_for_good_and_the_report_keeps_its_excerpt(
    client: TestClient, member_client: TestClient, db_session: Session, participating
):
    parent = comment(member_client, "지워질 댓글")
    comment(client, "그 답글", parent_id=parent["id"])
    client.post(f"/api/tube/comments/{parent['id']}/report", json={"reason": "광고"})

    gone = client.post(f"/api/admin/tube/comments/{parent['id']}/delete", json={"reason": "광고 댓글"})
    assert gone.status_code == 200 and gone.json()["reports_closed"] == 1
    assert db_session.query(TubeComment).count() == 0  # the reply went with it
    report = db_session.query(TubeReport).one()
    assert report.resolved_at is not None and report.excerpt == "지워질 댓글"
    assert db_session.query(AuditLog).filter(AuditLog.action == "tube_comment.deleted").count() == 1
    assert client.post(f"/api/admin/tube/comments/{parent['id']}/delete", json={"reason": "다시"}).status_code == 404


def test_the_admin_may_close_a_report_and_keep_the_comment(
    client: TestClient, member_client: TestClient, db_session: Session, participating
):
    fine = comment(member_client, "괜찮은 댓글")
    client.post(f"/api/tube/comments/{fine['id']}/report", json={"reason": "그냥"})
    report_id = client.get("/api/admin/tube/reports").json()[0]["id"]

    assert client.post(f"/api/admin/tube/reports/{report_id}/resolve", json={"note": "문제 없음"}).status_code == 200
    assert client.get("/api/admin/tube/reports").json() == []
    assert detail(client)["comments"][0]["body"] == "괜찮은 댓글"
    assert client.post(f"/api/admin/tube/reports/{report_id}/resolve", json={"note": ""}).status_code == 404
    audit = db_session.query(AuditLog).filter(AuditLog.action == "tube_report.resolved").one()
    assert audit.detail["comment_id"] == fine["id"]


def test_state_changing_routes_need_a_json_body(client: TestClient, participating):
    """CLAUDE.md §2: every state-changing route needs a JSON body."""
    bare = TestClient(app)
    bare.cookies = client.cookies
    assert bare.post(f"/api/tube/videos/{SLUG}/reactions", content="kind=like").status_code == 415
