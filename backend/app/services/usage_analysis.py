"""admin-consolidation v3 (3) — "어디에 썼나".

Two read-only views of the ledger (`UsageEvent`), in the same units the
rest of Admin uses: **원가** (what the provider billed, USD, and its won at
the call's own rate) and **청구** (what left members' wallets, `charged_krw`)
— recorded separately, shown side by side.

* `quarter_analysis` — Quarters › 사용 분석: per provider (원가, 청구, the
  credit left and when it runs out), cache savings, by feature, by model,
  the top 5 apps and members, and the last 30 days with the forecast to
  the quarter's end.
* `member_usage` — the member panel's 사용 내역: used / share / left / calls
  / when the wallet runs out, by feature, by model (tokens), recent calls.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    BuilderProject,
    ChatModel,
    CreditPurchase,
    Quarter,
    QuarterAllocation,
    UsageEvent,
    User,
)
from app.services import accounting
from app.services.admin_alerts import FEATURE_PLACE

KST = timezone(timedelta(hours=9))
#: The trend's window, and the burn rate's (for "소진 예상").
TREND_DAYS = 30
BURN_DAYS = 14
TOP = 5


def _today() -> date:
    return datetime.now(KST).date()


def _place(feature: str | None) -> str:
    return FEATURE_PLACE.get(feature or "", "기타")


def _model_labels(db: Session) -> dict[str, str]:
    return {row.model_id: row.label for row in db.scalars(select(ChatModel))}


# ------------------------------------------------------------ the quarter


@dataclass
class ProviderLine:
    provider: str
    label: str
    cost_usd: float
    charged_krw: int
    remaining_usd: float | None
    runs_out_on: date | None


@dataclass
class Share:
    label: str
    krw: int
    pct: int


@dataclass
class ModelLine:
    model_id: str
    label: str
    krw: int
    input_tokens: int
    output_tokens: int


@dataclass
class TopLine:
    id: int
    name: str
    krw: int


@dataclass
class DayLine:
    day: date
    krw: int


@dataclass
class QuarterAnalysis:
    cost_usd: float
    cost_krw: int
    charged_krw: int
    cache_saved_krw: int
    providers: list[ProviderLine]
    by_feature: list[Share]
    by_model: list[ModelLine]
    top_apps: list[TopLine]
    top_members: list[TopLine]
    daily: list[DayLine]
    forecast_krw: int | None
    runs_out_on: date | None = None


def _shares(totals: dict[str, int]) -> list[Share]:
    whole = sum(totals.values())
    return [
        Share(label=label, krw=krw, pct=round(krw * 100 / whole) if whole else 0)
        for label, krw in sorted(totals.items(), key=lambda item: item[1], reverse=True)
        if krw > 0
    ]


def _burn_date(remaining_usd: Decimal, recent_usd: Decimal, today: date) -> date | None:
    if remaining_usd <= 0 or recent_usd <= 0:
        return None
    per_day = recent_usd / BURN_DAYS
    return today + timedelta(days=int(remaining_usd / per_day))


def quarter_analysis(db: Session, quarter: Quarter, today: date | None = None) -> QuarterAnalysis:
    today = today or _today()
    in_quarter = UsageEvent.quarter_id == quarter.id

    cost_usd, cost_krw, charged = db.execute(
        select(
            func.coalesce(func.sum(UsageEvent.provider_cost), 0),
            func.coalesce(func.sum(UsageEvent.provider_cost * UsageEvent.exchange_rate_krw), 0),
            func.coalesce(func.sum(UsageEvent.charged_krw), 0),
        ).where(in_quarter)
    ).one()

    # Per provider: the quarter's 원가 and 청구, the credit left (credit is not
    # per quarter) and, at the last two weeks' pace, when it runs out.
    since = datetime.now(timezone.utc) - timedelta(days=BURN_DAYS)
    recent = {
        accounting.provider_key(provider): Decimal(str(usd))
        for provider, usd in db.execute(
            select(UsageEvent.provider, func.coalesce(func.sum(UsageEvent.provider_cost), 0))
            .where(UsageEvent.created_at >= since)
            .group_by(UsageEvent.provider)
        )
    }
    providers = []
    for line in accounting.provider_credit(db, quarter):
        bought = line.purchases > 0
        providers.append(
            ProviderLine(
                provider=line.provider,
                label=line.label,
                cost_usd=float(line.used_usd_quarter),
                charged_krw=line.used_krw_quarter,
                remaining_usd=float(line.remaining_usd) if bought else None,
                runs_out_on=_burn_date(line.remaining_usd, recent.get(line.provider, Decimal(0)), today) if bought else None,
            )
        )

    features: dict[str, int] = defaultdict(int)
    for feature, krw in db.execute(
        select(UsageEvent.feature, func.coalesce(func.sum(UsageEvent.charged_krw), 0)).where(in_quarter).group_by(UsageEvent.feature)
    ):
        features[_place(feature)] += int(krw or 0)

    labels = _model_labels(db)
    models = [
        ModelLine(model_id=model_id, label=labels.get(model_id, model_id), krw=int(krw or 0), input_tokens=int(tin or 0), output_tokens=int(tout or 0))
        for model_id, krw, tin, tout in db.execute(
            select(
                UsageEvent.model_id,
                func.coalesce(func.sum(UsageEvent.charged_krw), 0),
                func.coalesce(func.sum(UsageEvent.input_tokens), 0),
                func.coalesce(func.sum(UsageEvent.output_tokens), 0),
            )
            .where(in_quarter, UsageEvent.model_id.is_not(None))
            .group_by(UsageEvent.model_id)
            .order_by(func.sum(UsageEvent.charged_krw).desc())
        )
    ]

    apps = [
        TopLine(id=row[0], name=row[1], krw=int(row[2] or 0))
        for row in db.execute(
            select(BuilderProject.id, BuilderProject.name, func.sum(UsageEvent.charged_krw))
            .join(BuilderProject, BuilderProject.id == UsageEvent.builder_project_id)
            .where(in_quarter, UsageEvent.feature == "app_ai", BuilderProject.deleted_at.is_(None))
            .group_by(BuilderProject.id, BuilderProject.name)
            .order_by(func.sum(UsageEvent.charged_krw).desc())
            .limit(TOP)
        )
        if int(row[2] or 0) > 0
    ]
    members = [
        TopLine(id=row[0], name=row[1], krw=int(row[2] or 0))
        for row in db.execute(
            select(User.id, User.display_name, func.sum(UsageEvent.charged_krw))
            .join(User, User.id == UsageEvent.user_id)
            .where(in_quarter)
            .group_by(User.id, User.display_name)
            .order_by(func.sum(UsageEvent.charged_krw).desc())
            .limit(TOP)
        )
        if int(row[2] or 0) > 0
    ]

    # The last 30 KST days, and the pace stretched to the quarter's end.
    start = max(quarter.starts_at, today - timedelta(days=TREND_DAYS - 1))
    per_day: dict[date, int] = defaultdict(int)
    saved = Decimal(0)
    prices = accounting.catalogue_prices(db)
    for event in db.scalars(select(UsageEvent).where(in_quarter)):
        day = accounting.kst_day(event.created_at)
        if day >= start:
            per_day[day] += event.charged_krw or 0
        if event.cache_read_tokens:
            saved += accounting.split_of(event, prices).cache_saved
    daily = [DayLine(day=start + timedelta(days=n), krw=per_day.get(start + timedelta(days=n), 0)) for n in range((min(today, quarter.ends_at) - start).days + 1)]
    elapsed = (min(today, quarter.ends_at) - quarter.starts_at).days + 1
    total_days = (quarter.ends_at - quarter.starts_at).days + 1
    charged_i = int(charged or 0)
    forecast = round(charged_i * total_days / elapsed) if elapsed >= 7 and charged_i > 0 else None
    soonest = [line.runs_out_on for line in providers if line.runs_out_on is not None]

    return QuarterAnalysis(
        cost_usd=round(float(cost_usd or 0), 2),
        cost_krw=round(float(cost_krw or 0)),
        charged_krw=charged_i,
        cache_saved_krw=round(float(saved)),
        providers=providers,
        by_feature=_shares(features),
        by_model=models,
        top_apps=apps,
        top_members=members,
        daily=daily,
        forecast_krw=forecast,
        runs_out_on=min(soonest) if soonest else None,
    )


def concur_csv(db: Session, quarter: Quarter) -> bytes:
    """The quarter's credit purchases as expense lines (Concur-style
    import): one row per purchase, in the won the club paid."""
    rows = []
    for purchase in db.scalars(
        select(CreditPurchase)
        .where(CreditPurchase.purchased_on >= quarter.starts_at, CreditPurchase.purchased_on <= quarter.ends_at)
        .order_by(CreditPurchase.purchased_on, CreditPurchase.id)
    ):
        label = accounting.PROVIDER_LABEL.get(accounting.provider_key(purchase.provider), purchase.provider)
        rows.append(
            [
                purchase.purchased_on.isoformat(),
                label,
                purchase.paid_krw,
                "KRW",
                "Software / Cloud services",
                f"CTRL+AI {quarter.display_name} — {label} credit ${purchase.amount_usd}",
                purchase.memo,
            ]
        )
    return accounting.csv_bytes(
        ["Transaction Date", "Vendor", "Amount", "Currency", "Expense Type", "Business Purpose", "Comment"], rows
    )


# ------------------------------------------------------------ one member


@dataclass
class CallLine:
    when: datetime
    place: str
    model: str
    krw: int


@dataclass
class MemberUsage:
    budget_krw: int
    used_krw: int
    remaining_krw: int
    used_pct: int | None
    calls: int
    runs_out_on: date | None
    by_feature: list[Share]
    by_model: list[ModelLine]
    recent: list[CallLine] = field(default_factory=list)


def member_usage(db: Session, user: User, quarter: Quarter, today: date | None = None) -> MemberUsage:
    today = today or _today()
    wallet = db.scalar(
        select(QuarterAllocation).where(QuarterAllocation.user_id == user.id, QuarterAllocation.quarter_id == quarter.id)
    )
    budget = wallet.budget_krw if wallet else 0
    used = wallet.consumed_krw if wallet else 0
    remaining = max(0, budget - used)
    mine = (UsageEvent.user_id == user.id, UsageEvent.quarter_id == quarter.id, UsageEvent.club_absorbed.is_(False))

    calls = db.scalar(select(func.count(UsageEvent.id)).where(*mine)) or 0
    features: dict[str, int] = defaultdict(int)
    for feature, krw in db.execute(
        select(UsageEvent.feature, func.coalesce(func.sum(UsageEvent.charged_krw), 0)).where(*mine).group_by(UsageEvent.feature)
    ):
        features[_place(feature)] += int(krw or 0)
    labels = _model_labels(db)
    models = [
        ModelLine(model_id=model_id, label=labels.get(model_id, model_id), krw=int(krw or 0), input_tokens=int(tin or 0), output_tokens=int(tout or 0))
        for model_id, krw, tin, tout in db.execute(
            select(
                UsageEvent.model_id,
                func.coalesce(func.sum(UsageEvent.charged_krw), 0),
                func.coalesce(func.sum(UsageEvent.input_tokens), 0),
                func.coalesce(func.sum(UsageEvent.output_tokens), 0),
            )
            .where(*mine, UsageEvent.model_id.is_not(None))
            .group_by(UsageEvent.model_id)
            .order_by(func.sum(UsageEvent.charged_krw).desc())
        )
    ]
    recent = [
        CallLine(when=event.created_at, place=_place(event.feature), model=labels.get(event.model_id or "", event.model_id or ""), krw=event.charged_krw)
        for event in db.scalars(select(UsageEvent).where(*mine).order_by(UsageEvent.id.desc()).limit(10))
    ]
    # 소진 예상: at the pace so far this quarter, when the wallet is empty.
    elapsed = (min(today, quarter.ends_at) - quarter.starts_at).days + 1
    runs_out = None
    if remaining > 0 and used > 0 and elapsed > 0:
        days = int(remaining / (used / elapsed))
        candidate = today + timedelta(days=days)
        runs_out = candidate if candidate <= quarter.ends_at else None
    return MemberUsage(
        budget_krw=budget,
        used_krw=used,
        remaining_krw=remaining,
        used_pct=min(100, int(used * 100 / budget + 0.5)) if budget else None,
        calls=int(calls),
        runs_out_on=runs_out,
        by_feature=_shares(features),
        by_model=models,
        recent=recent,
    )
