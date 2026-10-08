"""Admin › Budget: every member's wallet in a quarter, and spend by provider.

Members have one 동아리 지원 wallet each (`single-wallet`), but the club
still buys credit per provider — Anthropic for Claude, Higgsfield for
video — and credit cannot move between providers once bought. So the
figure the 팀장 needs before the next purchase is *what was spent with
each provider*, which the usage ledger records on every event.

Everything here is a grouped query over the ledger and the allocations;
nothing is counted in Python row by row, and nothing here moves money.
"""

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    FundingSource,
    Quarter,
    QuarterAllocation,
    QuarterMembership,
    UsageEvent,
    User,
)
from app.schemas.quarter import (
    MemberWalletRead,
    ProviderSpendRead,
    QuarterBudgetRead,
    QuarterRead,
)

#: What the 팀장 buys from. `claude` and `anthropic` are the same account.
PROVIDER_LABEL = {
    "claude": "Claude (Anthropic)",
    "anthropic": "Claude (Anthropic)",
    "higgsfield": "Higgsfield",
}

#: Ledger providers that are one purchase. Older Claude rows say `claude`;
#: a later adapter may say `anthropic`.
_PROVIDER_KEY = {"anthropic": "claude"}


def _key(provider: str) -> str:
    return _PROVIDER_KEY.get(provider, provider)


def member_wallets(db: Session, quarter: Quarter) -> list[MemberWalletRead]:
    """Every member with a wallet this quarter, largest spend first."""
    rows = db.execute(
        select(QuarterAllocation, User, QuarterMembership.status)
        .join(User, User.id == QuarterAllocation.user_id)
        .outerjoin(
            QuarterMembership,
            (QuarterMembership.user_id == QuarterAllocation.user_id)
            & (QuarterMembership.quarter_id == quarter.id),
        )
        .where(QuarterAllocation.quarter_id == quarter.id)
        .order_by(QuarterAllocation.consumed_krw.desc(), User.username)
    ).all()
    return [
        MemberWalletRead(
            user_id=member.id,
            username=member.username,
            display_name=member.display_name,
            account_status=member.account_status,
            membership_status=membership_status,
            budget_krw=allocation.budget_krw,
            consumed_krw=allocation.consumed_krw,
            remaining_krw=allocation.remaining_krw,
        )
        for allocation, member, membership_status in rows
    ]


def provider_spend(
    db: Session, quarter: Quarter, total_budget_krw: int
) -> list[ProviderSpendRead]:
    """What the quarter spent with each provider, from the usage ledger.

    Counts both pots — the wallet and members' own money — because the
    club buys the credit either way; the two are reported side by side.
    """
    in_quarter = UsageEvent.quarter_id == quarter.id

    by_source = db.execute(
        select(
            UsageEvent.provider,
            UsageEvent.funding_source,
            func.count(UsageEvent.id),
            func.coalesce(func.sum(UsageEvent.charged_krw), 0),
            func.coalesce(func.sum(UsageEvent.input_tokens), 0),
            func.coalesce(func.sum(UsageEvent.output_tokens), 0),
        )
        .where(in_quarter)
        .group_by(UsageEvent.provider, UsageEvent.funding_source)
    ).all()

    lines: dict[str, dict] = defaultdict(
        lambda: {
            "events": 0,
            "community_krw": 0,
            "personal_krw": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "provider_cost": defaultdict(Decimal),
            "units": defaultdict(int),
        }
    )
    for provider, source, events, charged, input_tokens, output_tokens in by_source:
        line = lines[_key(provider)]
        line["events"] += events
        pot = "personal_krw" if source is FundingSource.PERSONAL else "community_krw"
        line[pot] += int(charged)
        line["input_tokens"] += int(input_tokens)
        line["output_tokens"] += int(output_tokens)

    for provider, currency, cost in db.execute(
        select(
            UsageEvent.provider,
            UsageEvent.provider_currency,
            func.sum(UsageEvent.provider_cost),
        )
        .where(in_quarter, UsageEvent.provider_cost.is_not(None))
        .group_by(UsageEvent.provider, UsageEvent.provider_currency)
    ).all():
        lines[_key(provider)]["provider_cost"][currency] += Decimal(str(cost))

    for provider, unit, units in db.execute(
        select(
            UsageEvent.provider,
            UsageEvent.provider_unit,
            func.coalesce(func.sum(UsageEvent.provider_units), 0),
        )
        .where(in_quarter, UsageEvent.provider_unit != "")
        .group_by(UsageEvent.provider, UsageEvent.provider_unit)
    ).all():
        lines[_key(provider)]["units"][unit] += int(units)

    grand_total = sum(line["community_krw"] + line["personal_krw"] for line in lines.values())

    result = []
    for provider, line in lines.items():
        charged = line["community_krw"] + line["personal_krw"]
        share = charged / grand_total if grand_total else None
        result.append(
            ProviderSpendRead(
                provider=provider,
                label=PROVIDER_LABEL.get(provider, provider),
                events=line["events"],
                charged_krw=charged,
                community_krw=line["community_krw"],
                personal_krw=line["personal_krw"],
                provider_cost={
                    currency: str(amount.quantize(Decimal("0.01")))
                    for currency, amount in line["provider_cost"].items()
                },
                units=dict(line["units"]),
                input_tokens=line["input_tokens"],
                output_tokens=line["output_tokens"],
                share=share,
                share_of_wallets_krw=(
                    round(total_budget_krw * share) if share is not None else None
                ),
            )
        )
    return sorted(result, key=lambda line: line.charged_krw, reverse=True)


def quarter_budget(db: Session, quarter: Quarter) -> QuarterBudgetRead:
    wallets = member_wallets(db, quarter)
    total_budget = sum(wallet.budget_krw for wallet in wallets)
    providers = provider_spend(db, quarter, total_budget)
    return QuarterBudgetRead(
        quarter=QuarterRead.model_validate(quarter),
        member_budget_krw=quarter.subsidy_limit_krw,
        wallets=wallets,
        total_budget_krw=total_budget,
        total_consumed_krw=sum(wallet.consumed_krw for wallet in wallets),
        total_remaining_krw=sum(wallet.remaining_krw for wallet in wallets),
        providers=providers,
        total_charged_krw=sum(line.charged_krw for line in providers),
    )
