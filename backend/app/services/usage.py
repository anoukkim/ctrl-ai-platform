"""Charging a member for a paid action.

This is the only place money comes off a budget. Every paid call goes
through `charge()`, which does three things **in one transaction**:

1. locks the allocation row,
2. checks the money is actually there,
3. deducts it and writes the matching `UsageEvent`.

## Why the lock

Without it, two concurrent requests can both read "45,500원 remaining",
both decide 30,000원 is affordable, and both deduct — leaving the member
14,500원 overdrawn. The gap between the check and the write is the bug,
and no amount of re-checking in Python closes it.

`SELECT ... FOR UPDATE` makes the second request wait until the first has
committed, so it sees the already-reduced figure and is correctly refused.
The deduction and the ledger row share the transaction, so a crash between
them cannot leave money deducted with nothing to show for it, or a ledger
row for money that was never taken.

SQLite ignores `FOR UPDATE`, which is fine for the unit tests — they are
single-threaded. The concurrency test runs against PostgreSQL and skips
when it is not reachable.

## Community money and personal money

A charge is paid from **one** pot, never split across two. If the
community budget cannot cover it, the charge falls to personal money only
when the member has explicitly enabled overage *and* has enough. Splitting
a single action across both pots would make the Usage screen much harder
to explain, and CLAUDE.md is explicit that the two are never added
together.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    BudgetCategory,
    FundingSource,
    PersonalBalance,
    QuarterAllocation,
    UsageEvent,
    User,
)
from app.services.quarters import current_quarter
from app.services.wallet import get_or_create_balance


class InsufficientBudgetError(Exception):
    """Raised when neither the community budget nor personal money covers a charge.

    Carries a Korean message, because it is shown to the member.
    """


class NoQuarterError(Exception):
    """Raised when there is no current quarter to charge against."""


@dataclass(frozen=True)
class ChargeResult:
    event: UsageEvent
    funding_source: FundingSource
    community_remaining_krw: int
    personal_remaining_krw: int


def _community_source(category: BudgetCategory) -> FundingSource:
    return (
        FundingSource.COMMUNITY_BUILD
        if category is BudgetCategory.BUILD
        else FundingSource.COMMUNITY_VIDEO
    )


def charge(
    db: Session,
    *,
    user: User,
    category: BudgetCategory,
    amount_krw: int,
    provider: str,
    model_id: str | None = None,
    provider_units: int = 0,
    provider_unit: str = "",
    provider_cost: float | None = None,
    provider_currency: str = "USD",
    builder_project_id: int | None = None,
    video_project_id: int | None = None,
) -> ChargeResult:
    """Deduct `amount_krw` and record the matching usage event.

    Commits on success. Raises `InsufficientBudgetError` without changing
    anything when the money is not there.
    """
    if amount_krw < 0:
        raise ValueError("금액은 0보다 작을 수 없습니다.")

    quarter = current_quarter(db)
    if quarter is None:
        raise NoQuarterError("지금은 진행 중인 분기가 없습니다.")

    # The lock is the whole point: everything below reads figures that no
    # other transaction can change until this one commits.
    allocation = db.scalar(
        select(QuarterAllocation)
        .where(
            QuarterAllocation.user_id == user.id,
            QuarterAllocation.quarter_id == quarter.id,
        )
        .with_for_update()
    )
    # Personal money needs the same protection as the community budget,
    # so the wallet row is locked too. Created first if it does not exist,
    # because you cannot lock a row that is not there yet.
    get_or_create_balance(db, user.id)
    balance = db.scalar(
        select(PersonalBalance).where(PersonalBalance.user_id == user.id).with_for_update()
    )
    assert balance is not None  # just created above

    community_remaining = 0
    if allocation is not None:
        community_remaining = (
            allocation.build_remaining_krw
            if category is BudgetCategory.BUILD
            else allocation.video_remaining_krw
        )

    personal_remaining = max(0, balance.balance_krw - balance.consumed_krw)

    # Community first, then personal only if the member opted in.
    if allocation is not None and amount_krw <= community_remaining:
        funding_source = _community_source(category)
        if category is BudgetCategory.BUILD:
            allocation.build_consumed_krw += amount_krw
        else:
            allocation.video_consumed_krw += amount_krw
        community_remaining -= amount_krw

    elif balance.overage_enabled and amount_krw <= personal_remaining:
        funding_source = FundingSource.PERSONAL
        balance.consumed_krw += amount_krw
        personal_remaining -= amount_krw

    else:
        if not balance.overage_enabled:
            raise InsufficientBudgetError(
                "이번 분기 지원금이 부족합니다. 개인 잔액을 쓰려면 Usage에서 개인 사용을 켜 주세요."
            )
        raise InsufficientBudgetError("남은 지원금과 개인 잔액이 모두 부족합니다.")

    event = UsageEvent(
        user_id=user.id,
        quarter_id=quarter.id,
        category=category,
        funding_source=funding_source,
        provider=provider,
        model_id=model_id,
        provider_units=provider_units,
        provider_unit=provider_unit,
        provider_cost=provider_cost,
        provider_currency=provider_currency,
        charged_krw=amount_krw,
        builder_project_id=builder_project_id,
        video_project_id=video_project_id,
    )
    db.add(event)

    # One commit for the deduction and the ledger row together.
    db.commit()
    db.refresh(event)

    return ChargeResult(
        event=event,
        funding_source=funding_source,
        community_remaining_krw=community_remaining,
        personal_remaining_krw=personal_remaining,
    )


def recent_events(db: Session, user_id: int, limit: int = 20) -> list[UsageEvent]:
    """The member's most recent charges, newest first."""
    return list(
        db.scalars(
            select(UsageEvent)
            .where(UsageEvent.user_id == user_id)
            .order_by(UsageEvent.created_at.desc(), UsageEvent.id.desc())
            .limit(limit)
        )
    )


def personal_balance(db: Session, user_id: int) -> PersonalBalance:
    balance = get_or_create_balance(db, user_id)
    db.commit()
    return balance
