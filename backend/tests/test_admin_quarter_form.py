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
        requested_budget_krw=100_000,
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
    assert allocation.budget_krw == 100_000

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
        requested_budget_krw=100_000,
        status=ApplicationStatus.SUBMITTED,
    )
    db_session.add(application)
    db_session.commit()
    db_session.refresh(application)

    rows = client.get(f"/api/admin/quarters/{pending.quarter_id}/applications").json()
    row = next(item for item in rows if item["id"] == application.id)

    assert row["username"] == "testmember2"
    assert row["username"] != member.email.split("@")[0]


# ------------------------------------- fix-quarter-form-autofill (2026-10-14)


def _detail(response) -> str:
    """The Korean sentence, whether the schema (422) or the route refused."""
    detail = response.json()["detail"]
    return detail if isinstance(detail, str) else " ".join(item["msg"] for item in detail)


@pytest.mark.parametrize("code", ["2027Q2", "27-Q2", "2027-Q5", "2027-Q0", "2027-H1", "Q2-2027", ""])
def test_a_code_that_is_not_yyyy_qn_is_refused_in_korean(client: TestClient, code: str) -> None:
    response = client.post("/api/admin/quarters", json={**GOOD, "code": code})
    assert response.status_code == 422
    if code:
        assert "2026-Q4 꼴로 입력해 주세요" in _detail(response)


def test_a_lower_case_code_is_normalised(client: TestClient) -> None:
    response = client.post("/api/admin/quarters", json={**GOOD, "code": " 2027-q2 "})
    assert response.status_code == 201, response.text
    assert response.json()["code"] == "2027-Q2"


def test_a_duplicate_code_is_refused_in_korean(client: TestClient) -> None:
    assert client.post("/api/admin/quarters", json=GOOD).status_code == 201
    again = client.post(
        "/api/admin/quarters",
        json={**GOOD, "starts_at": "2030-04-01", "ends_at": "2030-06-30",
              "application_opens_at": None, "application_closes_at": None},
    )
    assert again.status_code == 409
    assert "2027-Q2 분기가 이미 있습니다" in again.json()["detail"]


def test_an_overlapping_range_is_refused_in_korean(client: TestClient, db_session: Session) -> None:
    assert client.post("/api/admin/quarters", json=GOOD).status_code == 201
    overlap = client.post(
        "/api/admin/quarters",
        json={**GOOD, "code": "2027-Q3", "starts_at": "2027-06-15", "ends_at": "2027-09-30",
              "application_opens_at": None, "application_closes_at": None},
    )
    assert overlap.status_code == 409
    assert "겹칩니다" in overlap.json()["detail"] and "2027 Q2" in overlap.json()["detail"]
    # Touching end to start is not an overlap.
    nxt = client.post(
        "/api/admin/quarters",
        json={**GOOD, "code": "2027-Q3", "display_name": "2027 Q3", "starts_at": "2027-07-01",
              "ends_at": "2027-09-30", "application_opens_at": None, "application_closes_at": None},
    )
    assert nxt.status_code == 201, nxt.text


def test_editing_a_quarter_obeys_the_same_rules(client: TestClient) -> None:
    first = client.post("/api/admin/quarters", json=GOOD).json()
    second = client.post(
        "/api/admin/quarters",
        json={**GOOD, "code": "2027-Q3", "display_name": "2027 Q3", "starts_at": "2027-07-01",
              "ends_at": "2027-09-30", "application_opens_at": None, "application_closes_at": None},
    ).json()

    backwards = client.patch(f"/api/admin/quarters/{first['id']}", json={"ends_at": "2027-03-01"})
    assert backwards.status_code == 400 and "종료일은 시작일보다 뒤" in backwards.json()["detail"]

    late_close = client.patch(
        f"/api/admin/quarters/{first['id']}", json={"application_closes_at": "2027-07-15"}
    )
    assert late_close.status_code == 400 and "분기 종료일보다 뒤일 수 없습니다" in late_close.json()["detail"]

    into_next = client.patch(f"/api/admin/quarters/{second['id']}", json={"starts_at": "2027-06-01"})
    assert into_next.status_code == 409 and "겹칩니다" in into_next.json()["detail"]

    # Its own dates do not count as an overlap.
    assert client.patch(
        f"/api/admin/quarters/{first['id']}", json={"display_name": "2027 2분기"}
    ).status_code == 200


# ------------------------------------------- 신청 기한 연장 (ui-improvements B)


@pytest.fixture
def open_quarter(db_session: Session) -> Quarter:
    """A quarter taking applications now, with a deadline a week out."""
    from datetime import timedelta

    today = date.today()
    quarter = Quarter(
        code="2031-Q1",
        display_name="2031 Q1",
        starts_at=today - timedelta(days=10),
        ends_at=today + timedelta(days=80),
        application_opens_at=today - timedelta(days=20),
        application_closes_at=today + timedelta(days=7),
        status=QuarterStatus.APPLICATION_OPEN,
        subsidy_limit_krw=80_000,
    )
    db_session.add(quarter)
    db_session.commit()
    db_session.refresh(quarter)
    return quarter


def test_the_deadline_can_be_pushed_later_and_is_named_in_the_audit_log(
    client: TestClient, db_session: Session, open_quarter: Quarter
) -> None:
    later = (open_quarter.application_closes_at.toordinal() + 14)
    later = date.fromordinal(later).isoformat()
    response = client.patch(
        f"/api/admin/quarters/{open_quarter.id}", json={"application_closes_at": later}
    )
    assert response.status_code == 200, response.text
    assert response.json()["application_closes_at"] == later
    assert response.json()["status"] == "application_open"

    row = db_session.query(AuditLog).filter_by(action=AuditAction.QUARTER_UPDATED).one()
    assert "신청 마감일" in row.summary and later in row.summary
    assert row.detail["after"]["application_closes_at"] == later


def test_the_deadline_cannot_be_moved_into_the_past_once_open(
    client: TestClient, open_quarter: Quarter
) -> None:
    yesterday = date.fromordinal(date.today().toordinal() - 1).isoformat()
    response = client.patch(
        f"/api/admin/quarters/{open_quarter.id}", json={"application_closes_at": yesterday}
    )
    assert response.status_code == 400
    assert "오늘이거나 그 뒤" in response.json()["detail"]


def test_the_deadline_stays_inside_the_quarter(client: TestClient, open_quarter: Quarter) -> None:
    after_end = date.fromordinal(open_quarter.ends_at.toordinal() + 1).isoformat()
    response = client.patch(
        f"/api/admin/quarters/{open_quarter.id}", json={"application_closes_at": after_end}
    )
    assert response.status_code == 400
    assert "분기 종료일보다 뒤일 수 없습니다" in response.json()["detail"]


def test_a_running_quarter_reopens_applications_with_a_new_deadline(
    client: TestClient, db_session: Session, open_quarter: Quarter
) -> None:
    """신청 마감 (active) is reversible; the wallets are untouched by it."""
    assert client.patch(
        f"/api/admin/quarters/{open_quarter.id}", json={"status": "active"}
    ).status_code == 200

    later = date.fromordinal(date.today().toordinal() + 21).isoformat()
    response = client.patch(
        f"/api/admin/quarters/{open_quarter.id}",
        json={"status": "application_open", "application_closes_at": later},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "application_open"
    assert response.json()["application_closes_at"] == later

    rows = db_session.query(AuditLog).filter_by(action=AuditAction.QUARTER_UPDATED).all()
    assert any("다시 열고" in row.summary and later in row.summary for row in rows)


def test_reopening_with_a_past_deadline_is_refused(
    client: TestClient, db_session: Session, open_quarter: Quarter
) -> None:
    open_quarter.status = QuarterStatus.ACTIVE
    open_quarter.application_closes_at = date.fromordinal(date.today().toordinal() - 3)
    db_session.commit()

    response = client.patch(
        f"/api/admin/quarters/{open_quarter.id}", json={"status": "application_open"}
    )
    assert response.status_code == 400
    assert "마감일을 함께 늦춰" in response.json()["detail"]


def test_a_closed_quarter_does_not_reopen_even_with_a_new_deadline(
    client: TestClient, db_session: Session, open_quarter: Quarter
) -> None:
    """분기 마감 freezes wallets and records 회수; it is not the same as 신청 마감."""
    assert client.post(
        f"/api/admin/quarters/{open_quarter.id}/close", json={"carry_over_percent": 0}
    ).status_code == 200

    later = date.fromordinal(date.today().toordinal() + 21).isoformat()
    response = client.patch(
        f"/api/admin/quarters/{open_quarter.id}",
        json={"status": "application_open", "application_closes_at": later},
    )
    assert response.status_code == 409
    assert "다시 열 수 없습니다" in response.json()["detail"]
