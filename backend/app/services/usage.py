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

## One wallet, then personal money

Every paid feature — Chat, video, the prompt helper, whatever comes next
— spends from the member's one 동아리 지원 wallet for the quarter
(`single-wallet`). What a charge was for is recorded on the event
(`provider`, `feature`, `model_id`, native units), not by choosing a
bucket.

A charge is paid from **one** pot, never split across two. The wallet is
spent first; if it cannot cover the charge, the charge falls to personal
money only when the member has explicitly enabled overage *and* has
enough. Splitting
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

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models import (
    FundingSource,
    PersonalBalance,
    QuarterAllocation,
    UsageEvent,
    User,
)
from app.models.usage import spending_group
from app.services import chat_limits
from app.services.quarters import current_quarter
from app.services.wallet import get_or_create_balance


class InsufficientBudgetError(Exception):
    """Raised when neither the wallet nor personal money covers a charge.

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


def _personal_allowed(settings: Settings | None) -> bool:
    """Whether personal money may be spent at all.

    personal-topup-off (owner, 2026-10-14): with `PERSONAL_TOPUP_ENABLED`
    off — the default — a member's earlier overage opt-in is ignored and
    no personal money moves, even where a balance exists. The rows are
    kept for personal-topup-ui.
    """
    return (settings or get_settings()).top_ups_enabled


#: The refusal when only the wallet may pay. The longer sentence telling
#: the member to switch on 개인 사용 is shown only while that switch does
#: anything.
WALLET_SHORT = "이번 분기 지원금이 부족합니다."


def ensure_affordable(
    db: Session, *, user: User, amount_krw: int, settings: Settings | None = None
) -> None:
    """Raise exactly what `charge()` would, without locking or changing anything.

    For use before a provider call. It reads without `FOR UPDATE`, so a
    concurrent charge can still win the race; `charge()` catches that.
    """
    quarter = current_quarter(db)
    if quarter is None:
        raise NoQuarterError("지금은 진행 중인 분기가 없습니다.")

    # The daily cap (token-guard), before any pot is consulted: it is a
    # guard on the member's day, not on where the money comes from.
    # Checked only here — `charge()` settles work the club has already
    # paid for, and refusing there would lose a paid reply.
    limits = chat_limits.current(db)
    if limits.daily_cap_krw > 0:
        spent_today = chat_limits.daily_spent_krw(db, user.id)
        if spent_today + amount_krw > limits.daily_cap_krw:
            raise InsufficientBudgetError(
                f"오늘 쓸 수 있는 금액({limits.daily_cap_krw:,}원)을 넘습니다. "
                f"오늘 {spent_today:,}원을 썼습니다. 내일 다시 이용해 주세요."
            )

    allocation = db.scalar(
        select(QuarterAllocation).where(
            QuarterAllocation.user_id == user.id,
            QuarterAllocation.quarter_id == quarter.id,
        )
    )
    if allocation is not None and amount_krw <= allocation.remaining_krw:
        return

    if not _personal_allowed(settings):
        raise InsufficientBudgetError(WALLET_SHORT)
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
    cache_write_tokens: int | None = None,
    cache_read_tokens: int | None = None,
    estimated_input_tokens: int | None = None,
    exchange_rate_krw: Decimal | None = None,
    conversation_id: int | None = None,
    web_search_count: int | None = None,
    web_fetch_count: int | None = None,
    tool_fee_krw: int | None = None,
    commit: bool = True,
    cap_to_available: bool = False,
    settings: Settings | None = None,
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

    community_remaining = allocation.remaining_krw if allocation is not None else 0

    personal_remaining = max(0, balance.balance_krw - balance.consumed_krw)

    # The member's opt-in counts only while personal money may move at
    # all (personal-topup-off, 2026-10-14).
    overage = balance.overage_enabled and _personal_allowed(settings)

    # Community first, then personal only if the member opted in.
    if allocation is not None and amount_krw <= community_remaining:
        funding_source = FundingSource.COMMUNITY
        allocation.consumed_krw += amount_krw
        community_remaining -= amount_krw

    elif overage and amount_krw <= personal_remaining:
        funding_source = FundingSource.PERSONAL
        balance.consumed_krw += amount_krw
        personal_remaining -= amount_krw

    elif cap_to_available:
        # Never split across pots (see the module note): take what is left
        # of the one that would have paid.
        if overage and personal_remaining > community_remaining:
            funding_source = FundingSource.PERSONAL
            amount_krw = personal_remaining
            balance.consumed_krw += amount_krw
            personal_remaining = 0
        else:
            funding_source = FundingSource.COMMUNITY
            amount_krw = community_remaining
            if allocation is not None:
                allocation.consumed_krw += amount_krw
            community_remaining = 0

    else:
        if not _personal_allowed(settings):
            raise InsufficientBudgetError(WALLET_SHORT)
        if not balance.overage_enabled:
            raise InsufficientBudgetError(
                "이번 분기 지원금이 부족합니다. 개인 잔액을 쓰려면 Usage에서 개인 사용을 켜 주세요."
            )
        raise InsufficientBudgetError("남은 지원금과 개인 잔액이 모두 부족합니다.")

    event = UsageEvent(
        user_id=user.id,
        quarter_id=quarter.id,
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
        cache_write_tokens=cache_write_tokens,
        cache_read_tokens=cache_read_tokens,
        estimated_input_tokens=estimated_input_tokens,
        web_search_count=web_search_count,
        web_fetch_count=web_fetch_count,
        tool_fee_krw=tool_fee_krw,
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


def spending_breakdown(db: Session, user_id: int, quarter_id: int) -> dict[str, int]:
    """What the member's wallet went on this quarter: chat, video, other.

    Information only — it does not limit anything. Counts wallet money
    (`FundingSource.COMMUNITY`) so the three figures add up to what the
    wallet card says was used; personal money has its own card.
    """
    totals = {"chat": 0, "video": 0, "other": 0}
    rows = db.execute(
        select(UsageEvent.feature, func.coalesce(func.sum(UsageEvent.charged_krw), 0))
        .where(
            UsageEvent.user_id == user_id,
            UsageEvent.quarter_id == quarter_id,
            UsageEvent.funding_source == FundingSource.COMMUNITY,
        )
        .group_by(UsageEvent.feature)
    ).all()
    for feature, amount in rows:
        totals[spending_group(feature)] += int(amount)
    return totals
