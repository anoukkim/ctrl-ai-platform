"""admin-consolidation v3 (1) — what the Dashboard tells the admin.

The owner's v3: the Dashboard is **처리할 일** (only what has a count) plus
**automatic alerts** — a member past 80% of their wallet, the Anthropic
monthly budget, the thumbnail server — and one line, "이번 주 가장 많이 쓴
곳". Everything is read from rows that already exist; nothing here
changes anything.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import (
    AccountStatus,
    AppCommentReport,
    AppReport,
    BuilderProject,
    FundingSource,
    Quarter,
    QuarterAllocation,
    TubeReport,
    UsageEvent,
    User,
)
from app.services import quarter_budget, thumbnail_render

#: A wallet this used is worth a look (the Members list's amber, too).
WALLET_ALERT_SHARE = 0.8
#: The monthly Anthropic budget's warning, as on Quarters › 예산.
MONTH_ALERT_SHARE = 0.8
WALLET_ALERT_LIMIT = 10

#: "이번 주 가장 많이 쓴 곳": the menu names a feature is shown under.
FEATURE_PLACE = {
    "chat": "Chat",
    "build": "Project Builder",
    "publish_summary": "Project Builder",
    "project_name": "Project Builder",
    "app_ai": "앱 AI",
    "app_ai_preview": "앱 AI",
    "video_prompt": "Video Generator",
    "video_generate": "Video Generator",
    "video_edit": "Video Generator",
    "video_extend": "Video Generator",
}


def open_reports(db: Session) -> int:
    """신고 not yet handled: apps, app comments and CtrlAITube comments."""
    total = 0
    for model in (AppReport, AppCommentReport, TubeReport):
        total += db.scalar(select(func.count(model.id)).where(model.resolved_at.is_(None))) or 0
    return int(total)


@dataclass
class WalletAlert:
    user_id: int
    username: str
    display_name: str
    used_pct: int
    remaining_krw: int


def wallet_alerts(db: Session, quarter: Quarter | None, share: float = WALLET_ALERT_SHARE) -> list[WalletAlert]:
    """Members of the quarter whose wallet is `share` or more used (not
    frozen) — 80% unless 알림 기준 says otherwise."""
    if quarter is None:
        return []
    rows = db.execute(
        select(QuarterAllocation, User)
        .join(User, User.id == QuarterAllocation.user_id)
        .where(
            QuarterAllocation.quarter_id == quarter.id,
            QuarterAllocation.budget_krw > 0,
            QuarterAllocation.frozen_at.is_(None),
            User.account_status == AccountStatus.ACTIVE,
            QuarterAllocation.consumed_krw >= QuarterAllocation.budget_krw * share,
        )
    ).all()
    alerts = [
        WalletAlert(
            user_id=user.id,
            username=user.username,
            display_name=user.display_name,
            used_pct=min(100, int(wallet.consumed_krw * 100 / wallet.budget_krw + 0.5)),
            remaining_krw=wallet.remaining_krw,
        )
        for wallet, user in rows
    ]
    return sorted(alerts, key=lambda alert: alert.used_pct, reverse=True)[:WALLET_ALERT_LIMIT]


@dataclass
class MonthBudget:
    month: str
    used_usd: float
    budget_usd: float | None
    used_pct: int | None


def anthropic_month(db: Session, settings: Settings) -> MonthBudget:
    month, used = quarter_budget.anthropic_month_usd(db)
    budget = settings.monthly_budget_usd
    budget_f = float(budget) if budget else None
    pct = min(999, round(used * 100 / budget_f)) if budget_f else None
    return MonthBudget(month=month, used_usd=round(used, 2), budget_usd=budget_f, used_pct=pct)


def thumbnail_server(settings: Settings) -> str:
    """"off" (the browser takes pictures), "ok", or "down" — the worker's
    own /health, asked over its socket with a short timeout."""
    if not thumbnail_render.enabled(settings):
        return "off"
    return "ok" if thumbnail_render.worker_healthy(settings) else "down"


@dataclass
class Place:
    label: str
    krw: int
    pct: int


@dataclass
class WeekTop:
    places: list[Place] = field(default_factory=list)
    app_name: str | None = None
    app_krw: int = 0


def week_top(db: Session) -> WeekTop:
    """Where members' wallets went in the last 7 days, by menu place, and
    the app whose AI took most (charged won — what members paid)."""
    since = datetime.now(timezone.utc) - timedelta(days=7)
    totals: dict[str, int] = {}
    for feature, krw in db.execute(
        select(UsageEvent.feature, func.coalesce(func.sum(UsageEvent.charged_krw), 0))
        .where(UsageEvent.created_at >= since, UsageEvent.funding_source == FundingSource.COMMUNITY)
        .group_by(UsageEvent.feature)
    ).all():
        place = FEATURE_PLACE.get(feature or "", "기타")
        totals[place] = totals.get(place, 0) + int(krw or 0)
    whole = sum(totals.values())
    top = WeekTop()
    if whole > 0:
        top.places = [
            Place(label=label, krw=krw, pct=round(krw * 100 / whole))
            for label, krw in sorted(totals.items(), key=lambda item: item[1], reverse=True)
            if krw > 0
        ]
    app = db.execute(
        select(BuilderProject.name, func.sum(UsageEvent.charged_krw).label("krw"))
        .join(BuilderProject, BuilderProject.id == UsageEvent.builder_project_id)
        .where(
            UsageEvent.created_at >= since,
            UsageEvent.feature == "app_ai",
            UsageEvent.charged_krw > 0,
            UsageEvent.funding_source == FundingSource.COMMUNITY,
            # A member's deleted work is never listed (CLAUDE.md §10).
            BuilderProject.deleted_at.is_(None),
        )
        .group_by(BuilderProject.id, BuilderProject.name)
        .order_by(func.sum(UsageEvent.charged_krw).desc())
        .limit(1)
    ).first()
    if app is not None:
        top.app_name, top.app_krw = app[0], int(app[1] or 0)
    return top
