"""Every Admin stat card and quarter column, checked against the database.

These numbers drive decisions — whether to chase applicants, whether a
quarter's budget is going unused — so each one is built from rows the
test wrote and compared against what the endpoint reports.

The definitions under test, because they are the part that can quietly
drift:

* **참여 회원** is the `active` membership count, *not* the approved
  application count. An admin can enrol someone directly, and that person
  is just as much a participant.
* **실제 사용자** counts members, not events: one member with four
  charges is one user.
* **사용률** is `None` when nobody is participating, not 0 — 0/0 is not
  zero percent.
* **전체 회원** excludes former members, since the card beside it counts
  them separately.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    AccountStatus,
    ApplicationStatus,
    BudgetCategory,
    FundingSource,
    MembershipStatus,
    Quarter,
    QuarterApplication,
    QuarterStatus,
    UsageEvent,
    User,
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


def make_member(db: Session, username: str, status=AccountStatus.ACTIVE, role=UserRole.MEMBER):
    from app.core.security import hash_password

    user = User(
        username=username,
        email=f"{username}@ctrl.ai",
        password_hash=hash_password("x" * 12),
        display_name=username.upper(),
        role=role,
        account_status=status,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_application(db: Session, user_id: int, quarter_id: int, status: ApplicationStatus):
    row = QuarterApplication(
        user_id=user_id,
        quarter_id=quarter_id,
        build_percentage=60,
        video_percentage=40,
        requested_total_budget_krw=100_000,
        requested_build_budget_krw=60_000,
        requested_video_budget_krw=40_000,
        status=status,
    )
    db.add(row)
    db.commit()
    return row


def make_usage(db: Session, user_id: int, quarter_id: int, amount: int = 1_000):
    row = UsageEvent(
        user_id=user_id,
        quarter_id=quarter_id,
        category=BudgetCategory.BUILD,
        funding_source=FundingSource.COMMUNITY_BUILD,
        provider="claude",
        charged_krw=amount,
    )
    db.add(row)
    db.commit()
    return row


# ------------------------------------------------------- admin only


@pytest.mark.parametrize(
    "path",
    [
        "/api/admin/stats/applications",
        "/api/admin/stats/members",
        "/api/admin/quarters-with-stats",
        "/api/admin/providers",
    ],
)
def test_the_stats_routes_are_admin_only(other_client: TestClient, path: str) -> None:
    assert other_client.get(path).status_code == 403, path


@pytest.mark.parametrize(
    "path",
    [
        "/api/admin/stats/applications",
        "/api/admin/stats/members",
        "/api/admin/quarters-with-stats",
        "/api/admin/providers",
    ],
)
def test_the_stats_routes_need_a_session(anon_client: TestClient, path: str) -> None:
    assert anon_client.get(path).status_code == 401, path


# ------------------------------------------------------- 신청 통계


def test_application_stats_match_the_database(
    client: TestClient, db_session: Session, dev_user, quarter
) -> None:
    a = make_member(db_session, "alpha")
    b = make_member(db_session, "bravo")
    c = make_member(db_session, "charlie")

    make_application(db_session, a.id, quarter.id, ApplicationStatus.SUBMITTED)
    make_application(db_session, b.id, quarter.id, ApplicationStatus.APPROVED)
    make_application(db_session, c.id, quarter.id, ApplicationStatus.REJECTED)

    body = client.get(f"/api/admin/stats/applications?quarter_id={quarter.id}").json()

    assert body["total"] == 3
    assert body["pending"] == 1
    assert body["approved"] == 1
    assert body["rejected"] == 1
    # 신청 금액 is what was asked for, across every status.
    assert body["requested_total_krw"] == 300_000


def test_application_stats_count_only_the_quarter_asked_for(
    client: TestClient, db_session: Session, quarter
) -> None:
    other = Quarter(
        code="2025-Q4",
        display_name="2025 Q4",
        starts_at=date(2025, 10, 1),
        ends_at=date(2025, 12, 31),
        status=QuarterStatus.CLOSED,
        subsidy_limit_krw=100_000,
    )
    db_session.add(other)
    db_session.commit()
    db_session.refresh(other)

    member = make_member(db_session, "alpha")
    make_application(db_session, member.id, quarter.id, ApplicationStatus.SUBMITTED)
    make_application(db_session, member.id, other.id, ApplicationStatus.APPROVED)

    this = client.get(f"/api/admin/stats/applications?quarter_id={quarter.id}").json()
    that = client.get(f"/api/admin/stats/applications?quarter_id={other.id}").json()

    assert (this["total"], this["pending"]) == (1, 1)
    assert (that["total"], that["approved"]) == (1, 1)


def test_application_stats_are_empty_without_a_quarter(client: TestClient) -> None:
    body = client.get("/api/admin/stats/applications").json()
    assert body["total"] == 0 and body["requested_total_krw"] == 0


# ------------------------------------------------------- 회원 통계


def test_member_stats_match_the_database(
    client: TestClient, db_session: Session, dev_user, quarter
) -> None:
    """One member of each kind, so no two cards can share a count."""
    active = make_member(db_session, "alpha")
    inactive = make_member(db_session, "bravo")
    make_member(db_session, "charlie")  # no membership, no application
    make_member(db_session, "delta", status=AccountStatus.FORMER)
    make_member(db_session, "echo", role=UserRole.ADMIN)

    set_membership(db_session, active.id, quarter.id, MembershipStatus.ACTIVE)
    set_membership(db_session, inactive.id, quarter.id, MembershipStatus.INACTIVE)
    db_session.commit()

    # alpha and bravo applied; charlie, echo and dev did not.
    make_application(db_session, active.id, quarter.id, ApplicationStatus.APPROVED)
    make_application(db_session, inactive.id, quarter.id, ApplicationStatus.REJECTED)

    body = client.get(f"/api/admin/stats/members?quarter_id={quarter.id}").json()

    # dev + alpha + bravo + charlie + echo; delta is former and excluded.
    assert body["total"] == 5
    assert body["former"] == 1
    assert body["active"] == 1
    assert body["inactive"] == 1
    # dev, charlie and echo have no application for this quarter.
    assert body["not_applied"] == 3
    # dev is an admin too.
    assert body["admins"] == 2


def test_former_members_are_left_out_of_every_live_count(
    client: TestClient, db_session: Session, quarter
) -> None:
    """A former member is counted once, in 탈퇴 — and nowhere else.

    They keep their rows (attribution survives), so the risk is that they
    quietly keep appearing in 전체 and 미신청 as well.
    """
    gone = make_member(db_session, "gone", status=AccountStatus.FORMER)
    set_membership(db_session, gone.id, quarter.id, MembershipStatus.ACTIVE)
    db_session.commit()

    body = client.get(f"/api/admin/stats/members?quarter_id={quarter.id}").json()
    assert body["former"] == 1
    assert body["active"] == 0
    # Only the seeded admin remains in 전체.
    assert body["total"] == 1
    assert body["not_applied"] == 1


def test_member_counts_add_up(client: TestClient, db_session: Session, quarter) -> None:
    """활동 + 비활동 never exceeds 전체. A card that overcounts is unreadable."""
    for index in range(4):
        member = make_member(db_session, f"m{index}")
        set_membership(
            db_session,
            member.id,
            quarter.id,
            MembershipStatus.ACTIVE if index % 2 == 0 else MembershipStatus.INACTIVE,
        )
    db_session.commit()

    body = client.get(f"/api/admin/stats/members?quarter_id={quarter.id}").json()
    assert body["active"] + body["inactive"] <= body["total"]
    assert body["active"] == 2 and body["inactive"] == 2


# ------------------------------------------------------- 분기 통계


def test_quarter_stats_match_the_database(
    client: TestClient, db_session: Session, dev_user, quarter
) -> None:
    a = make_member(db_session, "alpha")
    b = make_member(db_session, "bravo")
    c = make_member(db_session, "charlie")

    make_application(db_session, a.id, quarter.id, ApplicationStatus.APPROVED)
    make_application(db_session, b.id, quarter.id, ApplicationStatus.SUBMITTED)

    # Three participants, but one of them never applied — enrolled by an
    # admin. 참여 회원 must count them.
    for member in (a, b, c):
        set_membership(db_session, member.id, quarter.id, MembershipStatus.ACTIVE)
    db_session.commit()

    # alpha spends twice, bravo once, charlie not at all.
    make_usage(db_session, a.id, quarter.id)
    make_usage(db_session, a.id, quarter.id)
    make_usage(db_session, b.id, quarter.id)

    rows = client.get("/api/admin/quarters-with-stats").json()
    stats = next(row["stats"] for row in rows if row["id"] == quarter.id)

    assert stats["applicants"] == 2
    assert stats["pending"] == 1
    assert stats["participants"] == 3
    # Two people spent something, not three events.
    assert stats["users_with_usage"] == 2
    assert stats["usage_rate"] == pytest.approx(2 / 3)


def test_usage_rate_is_undefined_with_no_participants(
    client: TestClient, db_session: Session, quarter
) -> None:
    """None, not 0 — a quarter nobody joined has no usage rate.

    The screen prints "–" for this. 0% would read as "everyone failed to
    use their budget", which is a different and wrong statement.
    """
    rows = client.get("/api/admin/quarters-with-stats").json()
    stats = next(row["stats"] for row in rows if row["id"] == quarter.id)

    assert stats["participants"] == 0
    assert stats["usage_rate"] is None


def test_quarters_with_stats_covers_every_quarter_newest_first(
    client: TestClient, db_session: Session, quarter
) -> None:
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

    rows = client.get("/api/admin/quarters-with-stats").json()
    assert [row["code"] for row in rows] == ["2026-Q1", "2025-Q4"]
    assert all("stats" in row for row in rows)


# ------------------------------------------------ 대시보드와 같은 숫자


def test_the_dashboard_shows_the_same_numbers_as_the_sections(
    client: TestClient, db_session: Session, dev_user, quarter
) -> None:
    """The point of a single stats service: no two screens disagree."""
    a = make_member(db_session, "alpha")
    b = make_member(db_session, "bravo")
    make_application(db_session, a.id, quarter.id, ApplicationStatus.SUBMITTED)
    set_membership(db_session, a.id, quarter.id, MembershipStatus.ACTIVE)
    set_membership(db_session, b.id, quarter.id, MembershipStatus.INACTIVE)
    db_session.commit()
    make_usage(db_session, a.id, quarter.id)

    dashboard = client.get(f"/api/admin/dashboard?quarter_id={quarter.id}").json()
    members = client.get(f"/api/admin/stats/members?quarter_id={quarter.id}").json()
    applications = client.get(f"/api/admin/stats/applications?quarter_id={quarter.id}").json()
    quarters = client.get("/api/admin/quarters-with-stats").json()
    quarter_row = next(row["stats"] for row in quarters if row["id"] == quarter.id)

    assert dashboard["members"] == members
    assert dashboard["applications"] == applications
    assert dashboard["quarter_stats"] == quarter_row
