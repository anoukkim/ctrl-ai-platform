"""Creating a quarter, and deciding an application from the list.

The 분기 설정 form is the first way to create a quarter that is not a
curl command, so the dates it accepts are now worth pinning down. The
rules are enforced in the schema rather than only in the screen: a
quarter whose end precedes its start produces figures nobody can read,
and the screen is not the only way in.

The review tests cover what the 신청 승인 rows do — approve and reject,
each leaving an audit row naming who decided and, for a rejection, why.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ApplicationStatus,
    AuditAction,
    AuditLog,
    MembershipStatus,
    Quarter,
    QuarterAllocation,
    QuarterApplication,
    QuarterStatus,
)
from app.services.quarters import membership_for

GOOD = {
    "code": "2027-Q2",
    "display_name": "2027 Q2",
    "starts_at": "2027-04-01",
    "ends_at": "2027-06-30",
    "application_opens_at": "2027-03-01",
    "application_closes_at": "2027-03-31",
    "subsidy_limit_krw": 120000,
}


# ------------------------------------------------- 분기 만들기


def test_creating_a_quarter_is_admin_only(other_client: TestClient) -> None:
    assert other_client.post("/api/admin/quarters", json=GOOD).status_code == 403


def test_a_valid_quarter_is_created(client: TestClient, db_session: Session) -> None:
    response = client.post("/api/admin/quarters", json=GOOD)
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["code"] == "2027-Q2"
    assert body["subsidy_limit_krw"] == 120_000
    # A new quarter starts as a draft whatever the caller asks for —
    # opening applications is a separate, deliberate act.
    assert body["status"] == QuarterStatus.DRAFT.value

    # A brand-new quarter has no applications.
    assert db_session.scalar(
        select(QuarterApplication).where(QuarterApplication.quarter_id == body["id"])
    ) is None


def test_creating_a_quarter_is_audited(client: TestClient, db_session: Session) -> None:
    assert client.post("/api/admin/quarters", json=GOOD).status_code == 201

    row = db_session.query(AuditLog).filter_by(action=AuditAction.QUARTER_CREATED).one()
    assert "2027 Q2" in row.summary
    assert row.actor_username == "dev"


@pytest.mark.parametrize(
    "field,value,because",
    [
        ("ends_at", "2027-04-01", "end equal to start"),
        ("ends_at", "2027-03-01", "end before start"),
        ("application_closes_at", "2027-02-01", "applications close before they open"),
        ("application_closes_at", "2027-07-15", "applications close after the quarter ends"),
    ],
)
def test_impossible_dates_are_refused(
    client: TestClient, field: str, value: str, because: str
) -> None:
    payload = {**GOOD, field: value}
    response = client.post("/api/admin/quarters", json=payload)
    assert response.status_code == 422, f"{because}: {response.status_code}"


def test_an_application_window_needs_both_ends(client: TestClient) -> None:
    """One date without the other is a half-written window, not a default."""
    payload = {**GOOD}
    payload.pop("application_closes_at")
    assert client.post("/api/admin/quarters", json=payload).status_code == 422


def test_the_application_window_may_be_omitted_entirely(client: TestClient) -> None:
    """A quarter can be created before its application dates are decided."""
    payload = {**GOOD}
    payload.pop("application_opens_at")
    payload.pop("application_closes_at")

    response = client.post("/api/admin/quarters", json=payload)
    assert response.status_code == 201, response.text
    assert response.json()["application_opens_at"] is None


def test_applications_may_open_before_the_quarter_starts(client: TestClient) -> None:
    """The normal case: members apply in the month before the quarter."""
    response = client.post("/api/admin/quarters", json=GOOD)
    assert response.status_code == 201
    body = response.json()
    assert body["application_opens_at"] < body["starts_at"]


@pytest.mark.parametrize("missing", ["code", "display_name", "starts_at", "ends_at"])
def test_required_fields_are_required(client: TestClient, missing: str) -> None:
    payload = {key: value for key, value in GOOD.items() if key != missing}
    assert client.post("/api/admin/quarters", json=payload).status_code == 422


def test_a_negative_limit_is_refused(client: TestClient) -> None:
    assert client.post(
        "/api/admin/quarters", json={**GOOD, "subsidy_limit_krw": -1}
    ).status_code == 422


# ------------------------------------------- 줄에서 승인하고 거절하기


@pytest.fixture
def pending(db_session: Session, other_user):
    """An open quarter with one application waiting."""
    quarter = Quarter(
        code="2026-Q1",
        display_name="2026 Q1",
        starts_at=date(2026, 1, 1),
        ends_at=date(2026, 3, 31),
        status=QuarterStatus.APPLICATION_OPEN,
        subsidy_limit_krw=100_000,
    )
    db_session.add(quarter)
    db_session.flush()

    application = QuarterApplication(
        user_id=other_user.id,
        quarter_id=quarter.id,
        build_percentage=70,
        video_percentage=30,
        requested_total_budget_krw=100_000,
        requested_build_budget_krw=70_000,
        requested_video_budget_krw=30_000,
        status=ApplicationStatus.SUBMITTED,
    )
    db_session.add(application)
    db_session.commit()
    db_session.refresh(application)
    return application


def test_approving_from_the_row_creates_the_budget_and_the_membership(
    client: TestClient, db_session: Session, pending, other_user
) -> None:
    response = client.post(f"/api/admin/applications/{pending.id}/review", json={"approve": True})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == ApplicationStatus.APPROVED.value

    allocation = db_session.scalar(
        select(QuarterAllocation).where(QuarterAllocation.user_id == other_user.id)
    )
    assert allocation is not None
    assert allocation.build_budget_krw == 70_000

    # Approving is also what makes them a participant — otherwise they
    # would hold a budget they are not allowed to spend.
    membership = membership_for(db_session, other_user.id, pending.quarter_id)
    assert membership is not None and membership.status is MembershipStatus.ACTIVE


def test_approving_is_audited_with_the_admin_who_did_it(
    client: TestClient, db_session: Session, pending
) -> None:
    client.post(f"/api/admin/applications/{pending.id}/review", json={"approve": True})

    row = db_session.query(AuditLog).filter_by(action=AuditAction.APPLICATION_APPROVED).one()
    assert row.actor_username == "dev"
    assert row.target_label == "other"


def test_rejecting_records_the_reason(
    client: TestClient, db_session: Session, pending
) -> None:
    """The 거절 dialog asks for a reason; it has to survive the round trip.

    Without it the member is told no with no explanation, and the admin
    who follows up months later cannot reconstruct why.
    """
    reason = "이번 분기 예산이 모두 배정되었습니다."
    response = client.post(
        f"/api/admin/applications/{pending.id}/review",
        json={"approve": False, "admin_note": reason},
    )
    assert response.status_code == 200, response.text
    assert response.json()["admin_note"] == reason

    db_session.expire_all()
    row = db_session.query(AuditLog).filter_by(action=AuditAction.APPLICATION_REJECTED).one()
    assert row.actor_username == "dev"


def test_rejecting_creates_no_budget_and_no_membership(
    client: TestClient, db_session: Session, pending, other_user
) -> None:
    client.post(
        f"/api/admin/applications/{pending.id}/review",
        json={"approve": False, "admin_note": "예산 부족"},
    )

    allocation = db_session.scalar(
        select(QuarterAllocation).where(QuarterAllocation.user_id == other_user.id)
    )
    assert allocation is None
    assert membership_for(db_session, other_user.id, pending.quarter_id) is None


def test_a_processed_row_reports_who_decided_it(
    client: TestClient, db_session: Session, pending
) -> None:
    """The 신청 승인 screen shows this on muted rows.

    Without it, "처리됨" is all a second admin sees, and the first
    question about someone else's decision — who made it — needs the
    audit log.
    """
    client.post(f"/api/admin/applications/{pending.id}/review", json={"approve": True})

    rows = client.get(f"/api/admin/quarters/{pending.quarter_id}/applications").json()
    row = next(item for item in rows if item["id"] == pending.id)

    assert row["reviewed_by_username"] == "dev"
    assert row["reviewed_by_display_name"]
    assert row["reviewed_at"] is not None


def test_a_pending_row_has_no_reviewer(
    client: TestClient, pending
) -> None:
    rows = client.get(f"/api/admin/quarters/{pending.quarter_id}/applications").json()
    row = next(item for item in rows if item["id"] == pending.id)

    assert row["reviewed_by_username"] == ""
    assert row["reviewed_at"] is None


def test_the_applicant_handle_is_the_real_username(
    client: TestClient, db_session: Session, pending
) -> None:
    """Not a guess from the email address.

    It used to be `email.split("@")[0]`, so the same member appeared as
    "@test" on this screen and "@testmember2" on the member list.

    The applicant here has a username that differs from the local part of
    their address on purpose — with `other@ctrl.ai` / `other` the two
    coincide and the old bug would pass this test.
    """
    from app.core.security import hash_password
    from app.models import AccountStatus, User, UserRole

    member = User(
        username="testmember2",
        email="test@ctrlai.com",
        password_hash=hash_password("x" * 12),
        display_name="테스트2",
        role=UserRole.MEMBER,
        account_status=AccountStatus.ACTIVE,
    )
    db_session.add(member)
    db_session.flush()

    application = QuarterApplication(
        user_id=member.id,
        quarter_id=pending.quarter_id,
        build_percentage=50,
        video_percentage=50,
        requested_total_budget_krw=100_000,
        requested_build_budget_krw=50_000,
        requested_video_budget_krw=50_000,
        status=ApplicationStatus.SUBMITTED,
    )
    db_session.add(application)
    db_session.commit()
    db_session.refresh(application)

    rows = client.get(f"/api/admin/quarters/{pending.quarter_id}/applications").json()
    row = next(item for item in rows if item["id"] == application.id)

    assert row["username"] == "testmember2"
    assert row["username"] != member.email.split("@")[0]
