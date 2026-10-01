"""Quarter lookups shared by routes and dependencies.

`current_quarter` used to live in `api/routes/quarters.py`, but
`api/deps.py` needs it too in order to decide whether a member is
participating. A dependency importing a route module would be a circular
import, so the rule it encodes lives here instead — one definition, used
by both.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MembershipStatus, Quarter, QuarterMembership, QuarterStatus


def current_quarter(db: Session) -> Quarter | None:
    """The quarter members are currently dealing with.

    An open application window wins over an active quarter: when
    applications for the next quarter open, that is what Profile should
    be inviting people to do.
    """
    open_now = db.scalar(
        select(Quarter)
        .where(Quarter.status == QuarterStatus.APPLICATION_OPEN)
        .order_by(Quarter.starts_at)
    )
    if open_now is not None:
        return open_now

    return db.scalar(
        select(Quarter).where(Quarter.status == QuarterStatus.ACTIVE).order_by(Quarter.starts_at)
    )


def membership_for(db: Session, user_id: int, quarter_id: int) -> QuarterMembership | None:
    """One member's participation row for one quarter, if any.

    A missing row means "not participating" — there is deliberately no
    inactive row written for every member who did not apply.
    """
    return db.scalar(
        select(QuarterMembership).where(
            QuarterMembership.user_id == user_id,
            QuarterMembership.quarter_id == quarter_id,
        )
    )


def set_membership(
    db: Session,
    user_id: int,
    quarter_id: int,
    status: MembershipStatus,
) -> QuarterMembership:
    """Create or update a member's participation in a quarter.

    Used when an admin approves an application (which makes the member
    active) and when an admin changes a member's status by hand. Does not
    commit: the caller decides the transaction boundary.
    """
    membership = membership_for(db, user_id, quarter_id)
    if membership is None:
        membership = QuarterMembership(user_id=user_id, quarter_id=quarter_id, status=status)
        db.add(membership)
        db.flush()
    else:
        membership.status = status
    return membership
