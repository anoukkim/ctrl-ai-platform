"""owner-polish 6 — the Video Generator locked for members behind the
관리자's switch (`feature_switches`, Admin › System).

Locked by default; the 관리자 is never locked out; reads stay open so a
member's existing videos never disappear; every flip is audited.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import AuditLog, FeatureSwitch
from app.services import feature_switches
from tests.conftest import DEV_PASSWORD, MEMBER_PASSWORD


def as_other(client: TestClient, other_user) -> None:
    client.post("/api/auth/logout")
    signed_in = client.post(
        "/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD}
    )
    assert signed_in.status_code == 200


def test_locked_by_default_for_members_but_not_for_the_admin(
    client: TestClient, db_session: Session, other_user, other_participating, budgeted, video_models
) -> None:
    assert feature_switches.is_open(db_session, feature_switches.VIDEO) is False
    assert client.get("/api/site").json()["video_open"] is False

    # The admin (participating) may still create — the wiring stays testable.
    made = client.post("/api/video/projects", json={"name": "관리자 영상"})
    assert made.status_code == 201, made.text

    as_other(client, other_user)
    refused = client.post("/api/video/projects", json={"name": "회원 영상"})
    assert refused.status_code == 403
    assert "다음 단계에서 열려요" in refused.json()["detail"]
    # Reading is not locked: the list and the catalogue still answer.
    assert client.get("/api/video/projects").status_code == 200
    assert client.get("/api/video/models").status_code == 200


def test_opening_the_switch_lets_members_in_and_is_audited(
    client: TestClient, db_session: Session, other_user, other_participating, dev_user
) -> None:
    assert client.get("/api/admin/features").json() == [
        {"key": "video", "label": "Video Generator", "open": False, "note": "", "set_by_username": "", "set_at": None},
        # image-generation: the second switch, locked by default too.
        {"key": "image", "label": "이미지 만들기 (Chat)", "open": False, "note": "", "set_by_username": "", "set_at": None},
    ]

    opened = client.post("/api/admin/features/video", json={"open": True, "note": "2027 Q1부터"})
    assert opened.status_code == 200, opened.text
    body = opened.json()
    assert (body["open"], body["note"], body["set_by_username"]) == (True, "2027 Q1부터", dev_user.username)
    assert body["set_at"] is not None
    assert client.get("/api/site").json()["video_open"] is True

    as_other(client, other_user)
    made = client.post("/api/video/projects", json={"name": "회원 영상"})
    assert made.status_code == 201, made.text

    entry = db_session.query(AuditLog).filter_by(action="feature.set").one()
    assert entry.detail == {"key": "video", "before": False, "after": True, "note": "2027 Q1부터"}
    assert "Video Generator 회원에게 열기" in entry.summary
    assert db_session.query(FeatureSwitch).count() == 1


def test_locking_again_keeps_the_history_and_refuses_at_once(
    client: TestClient, db_session: Session, other_user, other_participating, budgeted, video_models
) -> None:
    client.post("/api/admin/features/video", json={"open": True})
    client.post("/api/admin/features/video", json={"open": False, "note": "아직"})
    assert db_session.query(FeatureSwitch).count() == 2  # append-only; newest wins
    assert feature_switches.is_open(db_session, feature_switches.VIDEO) is False

    as_other(client, other_user)
    assert client.post("/api/video/projects", json={"name": "회원 영상"}).status_code == 403
    actions = [row.action for row in db_session.query(AuditLog).filter_by(action="feature.set").order_by(AuditLog.id)]
    assert actions == ["feature.set", "feature.set"]


def test_the_switch_routes_are_admin_only_and_the_key_is_checked(
    client: TestClient, other_user, dev_user
) -> None:
    as_other(client, other_user)
    assert client.get("/api/admin/features").status_code == 403
    assert client.post("/api/admin/features/video", json={"open": True}).status_code == 403
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}).status_code == 200
    assert client.post("/api/admin/features/nope", json={"open": True}).status_code == 404


def test_participation_is_still_checked_first_for_a_member(
    client: TestClient, db_session: Session, other_user, participating
) -> None:
    """Open or not, a member sitting out the quarter is refused with the
    participation sentence — the lock never hides that."""
    client.post("/api/admin/features/video", json={"open": True})
    as_other(client, other_user)
    refused = client.post("/api/video/projects", json={"name": "회원 영상"})
    assert refused.status_code == 403 and "참여" in refused.json()["detail"]
