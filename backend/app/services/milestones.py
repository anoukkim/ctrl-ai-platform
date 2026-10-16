"""Spend milestones (feat-spend-feedback, owner 2026-10-14).

A small, game-like moment when money leaves the wallet. The milestones —
첫 사용, 25 / 50 / 75 % used, 잔액 10,000원 이하, 잔액 0 — are each shown
**once per member per quarter**, recorded here so a second device or a
reload never repeats one.

`claim()` is called by the screen after a charge. It works out every
milestone the wallet has now crossed, records all the new ones at once,
and returns only the **highest** — a charge that jumps from 20% to 60%
shows the 50% card, never 25% and then 50%.

The figures come from the wallet row (`QuarterAllocation`), which only
`usage.charge()` moves — never from anything the browser sends.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import QuarterAllocation, SpendMilestone, User
from app.services import notifications
from app.services.quarters import current_quarter

#: 잔액이 이만큼 이하로 내려가면 차분한 경고 한 번.
LOW_BALANCE_KRW = 10_000

#: Highest first: the one returned when several are crossed together.
PRIORITY: tuple[str, ...] = ("empty", "low", "used_75", "used_50", "used_25", "first")
THRESHOLDS = {"used_25": 25, "used_50": 50, "used_75": 75}


@dataclass(frozen=True)
class Claim:
    milestone: str | None
    budget_krw: int
    consumed_krw: int
    remaining_krw: int

    @property
    def percent_used(self) -> int:
        if self.budget_krw <= 0:
            return 0
        return min(100, (self.consumed_krw * 100) // self.budget_krw)


def crossed(budget_krw: int, consumed_krw: int) -> set[str]:
    """Every milestone a wallet in this state has reached."""
    reached: set[str] = set()
    if consumed_krw <= 0:
        return reached
    reached.add("first")
    if budget_krw > 0:
        for kind, percent in THRESHOLDS.items():
            if consumed_krw * 100 >= budget_krw * percent:
                reached.add(kind)
    remaining = max(0, budget_krw - consumed_krw)
    if remaining <= 0:
        reached.add("empty")
    # A wallet that started at or under 10,000원 is "low" from the start;
    # the warning still waits for the first charge, like the others.
    if remaining <= LOW_BALANCE_KRW:
        reached.add("low")
    return reached


def claim(db: Session, user: User) -> Claim | None:
    """Record the newly crossed milestones; return the highest new one."""
    quarter = current_quarter(db)
    if quarter is None:
        return None
    allocation = db.scalar(
        select(QuarterAllocation).where(
            QuarterAllocation.user_id == user.id, QuarterAllocation.quarter_id == quarter.id
        )
    )
    if allocation is None:
        return None
    seen = set(
        db.scalars(
            select(SpendMilestone.kind).where(
                SpendMilestone.user_id == user.id, SpendMilestone.quarter_id == quarter.id
            )
        )
    )
    new = crossed(allocation.budget_krw, allocation.consumed_krw) - seen
    for kind in new:
        db.add(SpendMilestone(user_id=user.id, quarter_id=quarter.id, kind=kind))
    # The same moments in the member's notification list (feat-notifications).
    for kind in new:
        notifications.milestone_crossed(db, user.id, quarter.id, kind, allocation.remaining_krw)
    try:
        db.commit()
    except IntegrityError:
        # Two tabs claimed at once: the other recorded it and shows it.
        db.rollback()
        new = set()
    top = next((kind for kind in PRIORITY if kind in new), None)
    return Claim(
        milestone=top,
        budget_krw=allocation.budget_krw,
        consumed_krw=allocation.consumed_krw,
        remaining_krw=allocation.remaining_krw,
    )
