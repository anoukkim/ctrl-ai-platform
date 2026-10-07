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

## Checking before calling a provider

A provider call costs the club money whether or not the member can pay
for it. `ensure_affordable()` answers "would this charge succeed?" before
the call, so a member without budget is refused with nothing spent.
`charge()` still re-checks under the lock afterwards — the pre-check is a
courtesy, the lock is the guarantee.
"""

from dataclasses import dataclass
from decimal import Decimal

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


def ensure_affordable(
    db: Session, *, user: User, category: BudgetCategory, amount_krw: int
) -> None:
    """Raise exactly what `charge()` would, without locking or changing anything.

    For use before a provider call. It reads without `FOR UPDATE`, so a
    concurrent charge can still win the race; `charge()` catches that.
    """
    quarter = current_quarter(db)
    if quarter is None:
        raise NoQuarterError("지금은 진행 중인 분기가 없습니다.")

    allocation = db.scalar(
        select(QuarterAllocation).where(
            QuarterAllocation.user_id == user.id,
            QuarterAllocation.quarter_id == quarter.id,
        )
    )
    if allocation is not None:
        remaining = (
            allocation.build_remaining_krw
            if category is BudgetCategory.BUILD
            else allocation.video_remaining_krw
        )
        if amount_krw <= remaining:
            return

    balance = db.scalar(select(PersonalBalance).where(PersonalBalance.user_id == user.id))
    if balance is not None and balance.overage_enabled:
        if amount_krw <= max(0, balance.balance_krw - balance.consumed_krw):
            return
        raise InsufficientBudgetError("남은 지원금과 개인 잔액이 모두 부족합니다.")
    raise InsufficientBudgetError(
        "이번 분기 지원금이 부족합니다. 개인 잔액을 쓰려면 Usage에서 개인 사용을 켜 주세요."
    )


def charge(
    db: Session,
    *,
    user: User,
    category: BudgetCategory,
    amount_krw: int,
    provider: str,
    feature: str | None = None,
    model_id: str | None = None,
    provider_units: int = 0,
    provider_unit: str = "",
    provider_cost: float | Decimal | None = None,
    provider_currency: str = "USD",
    builder_project_id: int | None = None,
    video_project_id: int | None = None,
    video_version_id: int | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    exchange_rate_krw: Decimal | None = None,
    conversation_id: int | None = None,
    commit: bool = True,
    cap_to_available: bool = False,
) -> ChargeResult:
    """Deduct `amount_krw` and record the matching usage event.

    Commits on success. Raises `InsufficientBudgetError` without changing
    anything when the money is not there.

    `commit=False` leaves the commit to the caller, for a route whose own
    rows — a new video version — must land in the same transaction as the
    deduction, so that neither can exist without the other. The locks are
    held until that commit.

    `cap_to_available=True` is for a charge whose cost is only known
    *after* the provider has already been paid — a Chat reply. Its budget
    was checked against the worst case before the call, so this only
    matters when a concurrent charge won the race in between. Refusing
    then would leave a reply the club paid for with no ledger row at all;
    instead the event is written, the pot that would have paid gives what
    it has left, and `provider_cost` still records the full dollar figure,
    so the shortfall is visible rather than lost.
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

    elif cap_to_available:
        # Never split across pots (see the module note): take what is left
        # of the one that would have paid.
        if balance.overage_enabled and personal_remaining > community_remaining:
            funding_source = FundingSource.PERSONAL
            amount_krw = personal_remaining
            balance.consumed_krw += amount_krw
            personal_remaining = 0
        else:
            funding_source = _community_source(category)
            amount_krw = community_remaining
            if allocation is not None:
                if category is BudgetCategory.BUILD:
                    allocation.build_consumed_krw += amount_krw
                else:
                    allocation.video_consumed_krw += amount_krw
            community_remaining = 0

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
        feature=feature,
        model_id=model_id,
        provider_units=provider_units,
        provider_unit=provider_unit,
        provider_cost=provider_cost,
        provider_currency=provider_currency,
        charged_krw=amount_krw,
        builder_project_id=builder_project_id,
        video_project_id=video_project_id,
        video_version_id=video_version_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        exchange_rate_krw=exchange_rate_krw,
        conversation_id=conversation_id,
    )
    db.add(event)

    # One commit for the deduction and the ledger row together.
    if commit:
        db.commit()
        db.refresh(event)
    else:
        db.flush()

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
