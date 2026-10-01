"""Counting, in one place.

Every figure the Admin screens show comes from here, and every one is a
**grouped query**. Loading the rows and counting them in Python — or in
the browser — gives the same answer today and the wrong answer, slowly,
once the club has a few hundred members and a few thousand usage events.

One module rather than a count beside each route, because the same
numbers appear twice: the dashboard shows 참여 회원 and 실제 사용자 for
the current quarter, and 분기 설정 shows them for every quarter. Two
implementations of "참여 회원" is two chances to disagree, and an admin
who sees 12 on one screen and 11 on another cannot tell which is wrong.

The definitions, fixed here so they cannot drift:

* **신청자** — applications for the quarter, any status.
* **승인 대기** — applications still `submitted`.
* **참여 회원** — members whose `QuarterMembership` for that quarter is
  `active`. Not "approved applications": an admin can enrol someone
  directly, and that person is just as much a participant.
* **실제 사용자** — distinct members with at least one `UsageEvent` in
  the quarter. The question it answers is "did the budget get used", so
  one member with forty events counts once.
* **사용률** — 실제 사용자 ÷ 참여 회원. Undefined, not zero, when nobody
  is participating: 0/0 is not 0%.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import Select, distinct, func, select
from sqlalchemy.orm import Session

from app.models import (
    AccountStatus,
    ApplicationStatus,
    MembershipStatus,
    Quarter,
    QuarterApplication,
    QuarterMembership,
    UsageEvent,
    User,
    UserRole,
)


@dataclass
class ApplicationStats:
    """The 신청 승인 stat cards, for one quarter."""

    total: int = 0
    pending: int = 0
    approved: int = 0
    rejected: int = 0
    #: Sum of every application's requested budget, in KRW. Across all
    #: statuses, because the card is labelled 신청 금액 — what was asked
    #: for, not what was granted.
    requested_total_krw: int = 0


@dataclass
class MemberStats:
    """The 회원 stat cards, for one quarter."""

    #: Everyone who still has an account — former members excluded, since
    #: the card next to this one counts them.
    total: int = 0
    active: int = 0
    inactive: int = 0
    #: Accounts with no application for this quarter at all. Former
    #: members are left out: they are not "yet to apply".
    not_applied: int = 0
    former: int = 0
    admins: int = 0


@dataclass
class QuarterStats:
    """One row of the 분기 설정 table."""

    quarter_id: int
    applicants: int = 0
    pending: int = 0
    participants: int = 0
    users_with_usage: int = 0

    @property
    def usage_rate(self) -> float | None:
        """실제 사용자 ÷ 참여 회원, or None when nobody is participating.

        None rather than 0.0 so the screen can print "–". A quarter with
        no participants has no usage rate; printing 0% would read as
        "everybody failed to use it".
        """
        if self.participants == 0:
            return None
        return self.users_with_usage / self.participants


@dataclass
class DashboardCounts:
    """What the dashboard shows, assembled from the same pieces."""

    members: MemberStats = field(default_factory=MemberStats)
    applications: ApplicationStats = field(default_factory=ApplicationStats)
    quarter: QuarterStats | None = None


def _scalar(db: Session, statement: Select) -> int:
    return db.scalar(statement) or 0


# ----------------------------------------------------------- 신청


def application_stats(db: Session, quarter_id: int | None) -> ApplicationStats:
    if quarter_id is None:
        return ApplicationStats()

    # One grouped query for the four counts rather than four queries.
    by_status = dict(
        db.execute(
            select(QuarterApplication.status, func.count(QuarterApplication.id))
            .where(QuarterApplication.quarter_id == quarter_id)
            .group_by(QuarterApplication.status)
        ).all()
    )

    requested = _scalar(
        db,
        select(func.coalesce(func.sum(QuarterApplication.requested_total_budget_krw), 0)).where(
            QuarterApplication.quarter_id == quarter_id
        ),
    )

    counts = {
        status.value if hasattr(status, "value") else str(status): number
        for status, number in by_status.items()
    }

    return ApplicationStats(
        total=sum(counts.values()),
        pending=counts.get(ApplicationStatus.SUBMITTED.value, 0),
        approved=counts.get(ApplicationStatus.APPROVED.value, 0),
        rejected=counts.get(ApplicationStatus.REJECTED.value, 0),
        requested_total_krw=requested,
    )


# ----------------------------------------------------------- 회원


def member_stats(db: Session, quarter_id: int | None) -> MemberStats:
    by_account = {
        status.value if hasattr(status, "value") else str(status): number
        for status, number in db.execute(
            select(User.account_status, func.count(User.id)).group_by(User.account_status)
        ).all()
    }
    former = by_account.get(AccountStatus.FORMER.value, 0)
    total = sum(by_account.values()) - former

    admins = _scalar(
        db,
        select(func.count(User.id)).where(
            User.role == UserRole.ADMIN, User.account_status != AccountStatus.FORMER
        ),
    )

    stats = MemberStats(total=total, former=former, admins=admins)
    if quarter_id is None:
        # With no quarter there is nothing to be active *in*, and nobody
        # has failed to apply to it.
        return stats

    by_membership = {
        status.value if hasattr(status, "value") else str(status): number
        for status, number in db.execute(
            select(QuarterMembership.status, func.count(QuarterMembership.id))
            .join(User, User.id == QuarterMembership.user_id)
            .where(
                QuarterMembership.quarter_id == quarter_id,
                User.account_status != AccountStatus.FORMER,
            )
            .group_by(QuarterMembership.status)
        ).all()
    }
    stats.active = by_membership.get(MembershipStatus.ACTIVE.value, 0)
    stats.inactive = by_membership.get(MembershipStatus.INACTIVE.value, 0)

    # Counted with NOT EXISTS rather than by subtracting: an account can
    # have a membership row without an application (an admin enrolled
    # them), so "applied" and "participating" are different sets.
    applied = (
        select(QuarterApplication.id)
        .where(
            QuarterApplication.user_id == User.id,
            QuarterApplication.quarter_id == quarter_id,
        )
        .exists()
    )
    stats.not_applied = _scalar(
        db,
        select(func.count(User.id)).where(
            User.account_status != AccountStatus.FORMER, ~applied
        ),
    )
    return stats


# ----------------------------------------------------------- 분기


def quarter_stats(db: Session, quarter_ids: list[int]) -> dict[int, QuarterStats]:
    """Every figure for several quarters, in four grouped queries.

    Four queries for N quarters rather than four per quarter: the 분기
    설정 table shows them all at once, and a per-row query is how a table
    becomes slow without anyone noticing.
    """
    stats = {quarter_id: QuarterStats(quarter_id=quarter_id) for quarter_id in quarter_ids}
    if not quarter_ids:
        return stats

    for quarter_id, number in db.execute(
        select(QuarterApplication.quarter_id, func.count(QuarterApplication.id))
        .where(QuarterApplication.quarter_id.in_(quarter_ids))
        .group_by(QuarterApplication.quarter_id)
    ).all():
        stats[quarter_id].applicants = number

    for quarter_id, number in db.execute(
        select(QuarterApplication.quarter_id, func.count(QuarterApplication.id))
        .where(
            QuarterApplication.quarter_id.in_(quarter_ids),
            QuarterApplication.status == ApplicationStatus.SUBMITTED,
        )
        .group_by(QuarterApplication.quarter_id)
    ).all():
        stats[quarter_id].pending = number

    for quarter_id, number in db.execute(
        select(QuarterMembership.quarter_id, func.count(QuarterMembership.id))
        .where(
            QuarterMembership.quarter_id.in_(quarter_ids),
            QuarterMembership.status == MembershipStatus.ACTIVE,
        )
        .group_by(QuarterMembership.quarter_id)
    ).all():
        stats[quarter_id].participants = number

    # DISTINCT user: the question is how many people spent anything, not
    # how many charges there were.
    for quarter_id, number in db.execute(
        select(UsageEvent.quarter_id, func.count(distinct(UsageEvent.user_id)))
        .where(UsageEvent.quarter_id.in_(quarter_ids))
        .group_by(UsageEvent.quarter_id)
    ).all():
        if quarter_id in stats:
            stats[quarter_id].users_with_usage = number

    return stats


def quarter_stats_for(db: Session, quarter_id: int | None) -> QuarterStats | None:
    if quarter_id is None:
        return None
    return quarter_stats(db, [quarter_id])[quarter_id]


# ----------------------------------------------------------- 대시보드


def dashboard_counts(db: Session, quarter: Quarter | None) -> DashboardCounts:
    """The dashboard's figures — the same functions the sections use."""
    quarter_id = quarter.id if quarter is not None else None
    return DashboardCounts(
        members=member_stats(db, quarter_id),
        applications=application_stats(db, quarter_id),
        quarter=quarter_stats_for(db, quarter_id),
    )
