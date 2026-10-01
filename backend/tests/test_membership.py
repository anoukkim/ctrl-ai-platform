"""Per-quarter participation (Phase 1b).

The three statuses answer different questions, and the tests are grouped
that way:

* **active**   — may create; everything works
* **inactive** — may sign in and read, may not create
* **former**   — may not sign in at all, but keeps attribution on work
                 they already published
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    AccountStatus,
    MembershipStatus,
    Quarter,
    QuarterMembership,
    QuarterStatus,
)
from app.services.quarters import current_quarter, set_membership
from tests.conftest import DEV_PASSWORD, MEMBER_PASSWORD


@pytest.fixture
def quarter(db_session: Session) -> Quarter:
    """An active quarter, so `current_quarter` has something to return."""
    existing = current_quarter(db_session)
    if existing is not None:
        return existing

    row = Quarter(
        code="2026-Q4",
        display_name="2026 Q4",
        starts_at=date(2026, 10, 1),
        ends_at=date(2026, 12, 31),
        status=QuarterStatus.ACTIVE,
        subsidy_limit_krw=100_000,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def participate(db_session: Session, user_id: int, quarter_id: int, status: MembershipStatus):
    set_membership(db_session, user_id, quarter_id, status)
    db_session.commit()


# ------------------------------------------------------------------ active


def test_an_active_member_may_create(client: TestClient, dev_user, quarter, db_session) -> None:
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)

    response = client.post("/api/builder/projects", json={"name": "활동 중 프로젝트"})

    assert response.status_code == 201


# ---------------------------------------------------------------- inactive


def test_an_inactive_member_may_still_sign_in(
    anon_client: TestClient, dev_user, quarter, db_session
) -> None:
    """Not participating is not the same as being locked out."""
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)

    response = anon_client.post(
        "/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}
    )

    assert response.status_code == 200


def test_an_inactive_member_may_still_read_their_work(
    client: TestClient, dev_user, quarter, db_session
) -> None:
    # Create something while active, then stop participating.
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)
    created = client.post("/api/builder/projects", json={"name": "지난 분기 프로젝트"})
    assert created.status_code == 201

    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)

    listed = client.get("/api/builder/projects")
    assert listed.status_code == 200
    assert [p["name"] for p in listed.json()] == ["지난 분기 프로젝트"]

    detail = client.get(f"/api/builder/projects/{created.json()['id']}")
    assert detail.status_code == 200


def test_an_inactive_member_may_not_create(
    client: TestClient, dev_user, quarter, db_session
) -> None:
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)

    for method, path, payload in [
        ("post", "/api/builder/projects", {"name": "새 프로젝트"}),
        ("post", "/api/video/projects", {"name": "새 영상"}),
    ]:
        response = getattr(client, method)(path, json=payload)
        assert response.status_code == 403, f"{path} returned {response.status_code}"
        # The member is told what is wrong and what still works.
        assert "참여" in response.json()["detail"]


def test_a_member_with_no_membership_row_may_not_create(
    client: TestClient, quarter
) -> None:
    """A missing row means "not participating" — no inactive row needed."""
    response = client.post("/api/builder/projects", json={"name": "미참여"})

    assert response.status_code == 403


def test_generating_a_version_is_blocked_while_inactive(
    client: TestClient, dev_user, quarter, db_session, video_models
) -> None:
    """Generating spends budget, so it is the clearest thing to refuse."""
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)
    project = client.post("/api/video/projects", json={"name": "영상"}).json()

    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)

    response = client.post(f"/api/video/projects/{project['id']}/versions")

    assert response.status_code == 403


# ------------------------------------------------------------------ former


def test_a_former_member_cannot_log_in(
    anon_client: TestClient, dev_user, db_session: Session
) -> None:
    dev_user.account_status = AccountStatus.FORMER
    db_session.commit()

    response = anon_client.post(
        "/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}
    )

    assert response.status_code == 403


def test_a_former_members_session_stops_working_at_once(
    client: TestClient, dev_user, db_session: Session
) -> None:
    """Status is re-checked per request, not only at sign-in."""
    assert client.get("/api/auth/me").status_code == 200

    dev_user.account_status = AccountStatus.FORMER
    db_session.commit()

    assert client.get("/api/auth/me").status_code == 403


def test_a_former_members_work_and_attribution_survive(
    client: TestClient, dev_user, quarter, db_session: Session
) -> None:
    """Leaving the community must never erase who made something.

    The account is kept rather than deleted precisely so published work
    can still say who created it.
    """
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)
    created = client.post("/api/builder/projects", json={"name": "남아 있는 작품"})
    assert created.status_code == 201
    project_id = created.json()["id"]
    author_name = dev_user.display_name

    dev_user.account_status = AccountStatus.FORMER
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.FORMER)

    # The row, its owner, and the owner's name all still exist.
    from app.models import BuilderProject, User

    project = db_session.get(BuilderProject, project_id)
    assert project is not None
    assert project.owner_user_id == dev_user.id

    author = db_session.get(User, dev_user.id)
    assert author is not None
    assert author.display_name == author_name
    assert author.account_status is AccountStatus.FORMER


# ------------------------------------------------------------ admin control


def test_approving_an_application_makes_the_member_active(
    client: TestClient, other_user, db_session: Session
) -> None:
    """Budget without participation would be money a member cannot spend."""
    quarter_row = Quarter(
        code="2027-Q1",
        display_name="2027 Q1",
        starts_at=date(2027, 1, 1),
        ends_at=date(2027, 3, 31),
        application_opens_at=date(2026, 12, 1),
        application_closes_at=date(2026, 12, 31),
        status=QuarterStatus.APPLICATION_OPEN,
        subsidy_limit_krw=100_000,
    )
    db_session.add(quarter_row)
    db_session.commit()

    # The other member applies...
    client.post("/api/auth/logout")
    client.post(
        "/api/auth/login",
        json={"username": other_user.username, "password": MEMBER_PASSWORD},
    )
    application = client.post(
        f"/api/quarters/{quarter_row.id}/apply",
        json={"build_percentage": 50, "video_percentage": 50},
    )
    assert application.status_code == 201

    # ...and the admin approves it.
    client.post("/api/auth/logout")
    from app.db.init_db import DEV_USER_USERNAME

    client.post(
        "/api/auth/login", json={"username": DEV_USER_USERNAME, "password": DEV_PASSWORD}
    )
    review = client.post(
        f"/api/admin/applications/{application.json()['id']}/review", json={"approve": True}
    )
    assert review.status_code == 200

    membership = db_session.scalar(
        db_session.query(QuarterMembership)
        .filter_by(user_id=other_user.id, quarter_id=quarter_row.id)
        .statement
    )
    assert membership is not None
    assert membership.status is MembershipStatus.ACTIVE


def test_admin_can_set_a_members_participation(
    client: TestClient, other_user, quarter
) -> None:
    response = client.put(
        f"/api/admin/quarters/{quarter.id}/members/{other_user.id}",
        json={"status": "inactive"},
    )

    assert response.status_code == 200
    assert response.json()["membership_status"] == "inactive"
    assert response.json()["username"] == other_user.username


def test_marking_a_member_former_also_closes_the_account(
    client: TestClient, other_user, quarter, db_session: Session
) -> None:
    """The two statuses must not be allowed to disagree."""
    response = client.put(
        f"/api/admin/quarters/{quarter.id}/members/{other_user.id}",
        json={"status": "former"},
    )

    assert response.status_code == 200
    assert response.json()["account_status"] == "former"

    db_session.refresh(other_user)
    assert other_user.account_status is AccountStatus.FORMER


def test_membership_endpoints_reject_a_member(
    other_client: TestClient, quarter, dev_user
) -> None:
    """Admin-only, enforced in the backend."""
    assert other_client.get(f"/api/admin/quarters/{quarter.id}/members").status_code == 403
    assert (
        other_client.put(
            f"/api/admin/quarters/{quarter.id}/members/{dev_user.id}",
            json={"status": "active"},
        ).status_code
        == 403
    )


def test_membership_is_reported_to_the_frontend(
    client: TestClient, dev_user, quarter, db_session: Session
) -> None:
    """The UI needs to explain the state, so the API has to say what it is."""
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)

    body = client.get("/api/quarters/me").json()

    assert body["membership_status"] == "inactive"
    assert body["may_create"] is False

    participate(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)
    body = client.get("/api/quarters/me").json()

    assert body["membership_status"] == "active"
    assert body["may_create"] is True


def test_one_membership_row_per_member_per_quarter(
    db_session: Session, dev_user, quarter
) -> None:
    set_membership(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)
    db_session.commit()
    set_membership(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)
    db_session.commit()

    rows = (
        db_session.query(QuarterMembership)
        .filter_by(user_id=dev_user.id, quarter_id=quarter.id)
        .all()
    )
    assert len(rows) == 1
    assert rows[0].status is MembershipStatus.INACTIVE
