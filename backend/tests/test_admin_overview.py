"""The Admin dashboard and member detail reads.

Both endpoints only gather figures, so the tests are about two things:

* **the numbers match the database** — a card that quietly shows a stale
  or wrong count is worse than a card that is missing, because an admin
  acts on it;
* **a member cannot reach them.** Hiding a card in the frontend is not
  authorization, so the refusal is checked on the route.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    AccountStatus,
    ApplicationStatus,
    MembershipStatus,
    PersonalTopUp,
    Quarter,
    QuarterApplication,
    QuarterStatus,
    TopUpStatus,
    UserRole,
)
from app.services.quarters import set_membership


@pytest.fixture
def quarter(db_session: Session) -> Quarter:
    row = Quarter(
        code="2026-Q1",
        display_name="2026 Q1",
        starts_at=date(2026, 1, 1),
        ends_at=date(2026, 3, 31),
        application_opens_at=date(2025, 12, 1),
        application_closes_at=date(2025, 12, 31),
        status=QuarterStatus.APPLICATION_OPEN,
        subsidy_limit_krw=100_000,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


# ------------------------------------------------------------- 대시보드


def test_the_dashboard_is_admin_only(other_client: TestClient) -> None:
    """A signed-in member is refused — the role is what opens Admin."""
    response = other_client.get("/api/admin/dashboard")
    assert response.status_code == 403, response.text


def test_the_dashboard_needs_a_session(anon_client: TestClient) -> None:
    assert anon_client.get("/api/admin/dashboard").status_code == 401


def test_dashboard_counts_match_the_database(
    client: TestClient, db_session: Session, dev_user, other_user, quarter, video_models
) -> None:
    """Every figure on the dashboard is checked against the rows behind it."""
    # One member participates; the admin does not, so "none" is not zero.
    set_membership(db_session, other_user.id, quarter.id, MembershipStatus.ACTIVE)

    # One application waiting, and one already approved, so the pending
    # count cannot accidentally be "all applications".
    db_session.add_all(
        [
            QuarterApplication(
                user_id=other_user.id,
                quarter_id=quarter.id,
                build_percentage=70,
                video_percentage=30,
                requested_total_budget_krw=100_000,
                requested_build_budget_krw=70_000,
                requested_video_budget_krw=30_000,
                status=ApplicationStatus.SUBMITTED,
            ),
            QuarterApplication(
                user_id=dev_user.id,
                quarter_id=quarter.id,
                build_percentage=100,
                video_percentage=0,
                requested_total_budget_krw=100_000,
                requested_build_budget_krw=100_000,
                requested_video_budget_krw=0,
                status=ApplicationStatus.APPROVED,
            ),
            PersonalTopUp(
                user_id=other_user.id, amount_krw=30_000, status=TopUpStatus.REQUESTED
            ),
            PersonalTopUp(
                user_id=other_user.id, amount_krw=10_000, status=TopUpStatus.CONFIRMED
            ),
        ]
    )
    db_session.commit()

    body = client.get("/api/admin/dashboard").json()

    assert body["quarter"]["code"] == "2026-Q1"
    assert body["pending_applications"] == 1
    assert body["pending_top_ups"] == 1

    assert body["counts"]["total"] == 2
    assert body["counts"]["accounts"]["active"] == 2
    assert body["counts"]["membership"]["active"] == 1
    # The admin never joined, and a missing row means "not participating".
    assert body["counts"]["membership"]["none"] == 1

    # The seeded catalogue is two member-visible models out of three.
    assert body["video_models_total"] == len(video_models)
    assert body["video_models_member_visible"] == sum(
        1 for model in video_models if model.enabled and model.member_visible
    )


def test_dashboard_membership_counts_cover_every_account(
    client: TestClient, db_session: Session, dev_user, other_user, quarter
) -> None:
    """active + inactive + none always adds up to the number of accounts.

    The dashboard shows these three side by side, so they have to be a
    partition of the membership. If they did not add up, the card would
    be arithmetic an admin cannot check.
    """
    set_membership(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)
    set_membership(db_session, other_user.id, quarter.id, MembershipStatus.INACTIVE)
    db_session.commit()

    counts = client.get("/api/admin/dashboard").json()["counts"]
    assert sum(counts["membership"].values()) == counts["total"] == 2


def test_dashboard_carries_the_last_ten_audit_entries(
    client: TestClient, db_session: Session, other_user, quarter
) -> None:
    """Newest first, and capped at ten however many rows exist."""
    for index in range(12):
        response = client.put(
            f"/api/admin/quarters/{quarter.id}/members/{other_user.id}",
            json={"status": "active" if index % 2 == 0 else "inactive"},
        )
        assert response.status_code == 200, response.text

    entries = client.get("/api/admin/dashboard").json()["recent_audit"]
    assert len(entries) == 10
    assert [entry["id"] for entry in entries] == sorted(
        (entry["id"] for entry in entries), reverse=True
    )
    # The Korean label is resolved on the backend, like the audit screen.
    assert entries[0]["action_label"] == "참여 상태 변경"


def test_dashboard_accepts_an_explicit_quarter(
    client: TestClient, db_session: Session, quarter
) -> None:
    """An admin looking at an older quarter gets that quarter's figures."""
    older = Quarter(
        code="2025-Q4",
        display_name="2025 Q4",
        starts_at=date(2025, 10, 1),
        ends_at=date(2025, 12, 31),
        status=QuarterStatus.CLOSED,
        subsidy_limit_krw=100_000,
    )
    db_session.add(older)
    db_session.commit()
    db_session.refresh(older)

    body = client.get(f"/api/admin/dashboard?quarter_id={older.id}").json()
    assert body["quarter"]["code"] == "2025-Q4"
    assert body["pending_applications"] == 0


def test_dashboard_rejects_an_unknown_quarter(client: TestClient) -> None:
    assert client.get("/api/admin/dashboard?quarter_id=9999").status_code == 404


def test_dashboard_survives_an_empty_database(client: TestClient) -> None:
    """No quarter yet is a normal state, not an error.

    This is what a fresh install looks like, and the dashboard is the
    first screen an admin opens.
    """
    body = client.get("/api/admin/dashboard").json()
    assert body["quarter"] is None
    assert body["pending_applications"] == 0
    assert body["counts"]["membership"] == {}


def test_dev_flag_follows_the_environment(client: TestClient, monkeypatch) -> None:
    """`is_development` is what hides the dev tools, so it must be real.

    The backend still refuses the simulator with 404 outside development
    — this flag only keeps a card from being offered that would fail.
    """
    from app.core.config import Settings, get_settings
    from app.main import app

    assert client.get("/api/admin/dashboard").json()["is_development"] is True

    app.dependency_overrides[get_settings] = lambda: Settings(app_env="production")
    try:
        assert client.get("/api/admin/dashboard").json()["is_development"] is False
        # And the simulator it guards really is gone.
        simulated = client.post(
            "/api/admin/simulate-usage", json={"category": "build", "amount_krw": 1000}
        )
        assert simulated.status_code == 404
    finally:
        del app.dependency_overrides[get_settings]


# ----------------------------------------------------------- 회원 상세


def test_member_detail_is_admin_only(other_client: TestClient, other_user) -> None:
    """Not even about themselves: this view is an admin tool."""
    response = other_client.get(f"/api/admin/members/{other_user.id}")
    assert response.status_code == 403, response.text


def test_member_detail_needs_a_session(anon_client: TestClient, other_user) -> None:
    assert anon_client.get(f"/api/admin/members/{other_user.id}").status_code == 401


def test_member_detail_reports_the_account(client: TestClient, other_user) -> None:
    body = client.get(f"/api/admin/members/{other_user.id}").json()

    assert body["username"] == other_user.username
    assert body["display_name"] == other_user.display_name
    assert body["email"] == other_user.email
    assert body["role"] == UserRole.MEMBER.value
    assert body["account_status"] == AccountStatus.ACTIVE.value
    # The hash is never in a response schema.
    assert "password_hash" not in body


def test_member_detail_lists_every_quarter_newest_first(
    client: TestClient, db_session: Session, other_user, quarter
) -> None:
    """A quarter the member sat out still appears, with no membership.

    Participation history is the point of the page: "not in Q1" is a fact
    an admin needs to see, not an absence.
    """
    older = Quarter(
        code="2025-Q4",
        display_name="2025 Q4",
        starts_at=date(2025, 10, 1),
        ends_at=date(2025, 12, 31),
        status=QuarterStatus.CLOSED,
        subsidy_limit_krw=100_000,
    )
    db_session.add(older)
    db_session.commit()

    set_membership(db_session, other_user.id, quarter.id, MembershipStatus.ACTIVE)
    db_session.commit()

    history = client.get(f"/api/admin/members/{other_user.id}").json()["quarters"]
    assert [row["quarter_code"] for row in history] == ["2026-Q1", "2025-Q4"]
    assert history[0]["membership_status"] == "active"
    assert history[1]["membership_status"] is None


def test_member_detail_carries_the_approved_allocation(
    client: TestClient, db_session: Session, other_user, quarter
) -> None:
    """Approving an application is what creates the budget, so go through it."""
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

    approved = client.post(
        f"/api/admin/applications/{application.id}/review", json={"approve": True}
    )
    assert approved.status_code == 200, approved.text

    row = client.get(f"/api/admin/members/{other_user.id}").json()["quarters"][0]
    assert row["application"]["status"] == "approved"
    assert row["allocation"]["build_budget_krw"] == 70_000
    assert row["allocation"]["video_budget_krw"] == 30_000
    assert row["allocation"]["build_remaining_krw"] == 70_000
    # Approving also writes the membership row.
    assert row["membership_status"] == "active"


def test_member_detail_collects_that_members_audit_trail(
    client: TestClient, db_session: Session, dev_user, other_user, quarter
) -> None:
    """Only entries about this member, across every target type.

    A membership change records the user's id; an allocation change
    records the allocation's id and carries the member in the label. Both
    belong on the member's page, and another member's changes do not.
    """
    application = QuarterApplication(
        user_id=other_user.id,
        quarter_id=quarter.id,
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

    assert (
        client.post(
            f"/api/admin/applications/{application.id}/review", json={"approve": True}
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/admin/quarters/{quarter.id}/allocations/{other_user.id}",
            json={"build_budget_krw": 60_000, "video_budget_krw": 40_000},
        ).status_code
        == 200
    )
    # A change to somebody else, which must not appear.
    assert (
        client.put(
            f"/api/admin/quarters/{quarter.id}/members/{dev_user.id}",
            json={"status": "inactive"},
        ).status_code
        == 200
    )

    trail = client.get(f"/api/admin/members/{other_user.id}").json()["audit"]
    actions = {entry["action"] for entry in trail}
    assert "application.approved" in actions
    assert "allocation.adjusted" in actions
    assert all(entry["target_label"] == other_user.username for entry in trail)


def test_member_detail_reports_an_empty_wallet_without_creating_one(
    client: TestClient, db_session: Session, other_user
) -> None:
    """A GET must not write. A member with no wallet simply has nothing in it."""
    from app.models import PersonalBalance

    body = client.get(f"/api/admin/members/{other_user.id}").json()
    assert body["personal"] == {
        "balance_krw": 0,
        "consumed_krw": 0,
        "remaining_krw": 0,
        "overage_enabled": False,
    }
    assert body["top_ups"] == []
    assert db_session.query(PersonalBalance).count() == 0


def test_member_detail_rejects_an_unknown_member(client: TestClient) -> None:
    assert client.get("/api/admin/members/9999").status_code == 404
