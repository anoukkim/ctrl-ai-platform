"""admin-consolidation v3 (2) — Quarters › 분기 · 예산's 「돈의 흐름」.

The owner: "전체 산 토큰 / 회원들에게 부여된 토큰 (사용/미사용) / 남은 토큰
(유지보수 등 사용)". In won, the ledger's unit:

* **산 크레딧** — what the club paid for provider credit in the quarter
  (`CreditPurchase.paid_krw`, by purchase date);
* **회원에게 준 몫** — the quarter's wallets (`QuarterAllocation.budget_krw`),
  split into **회원이 쓴 돈** (`consumed_krw`) and **줬지만 안 쓴 돈**;
* **여유분** — bought but not handed out; and what the reserve itself paid
  for: calls the club absorbed (admin tests, 게시 요약, names …), at their
  provider cost in won;
* **분기 말 예상** — members' spending so far, stretched to the quarter's end.

Read only; nothing here moves money.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import CreditPurchase, Quarter, QuarterAllocation, UsageEvent

KST = timezone(timedelta(hours=9))


@dataclass
class MoneyFlow:
    purchased_krw: int
    granted_krw: int
    members: int
    used_krw: int
    unused_krw: int
    reserve_krw: int
    reserve_spent_krw: int
    forecast_used_krw: int | None
    days_left: int


def money_flow(db: Session, quarter: Quarter, today: date | None = None) -> MoneyFlow:
    today = today or datetime.now(KST).date()
    purchased = db.scalar(
        select(func.coalesce(func.sum(CreditPurchase.paid_krw), 0)).where(
            CreditPurchase.purchased_on >= quarter.starts_at, CreditPurchase.purchased_on <= quarter.ends_at
        )
    )
    granted, used, members = db.execute(
        select(
            func.coalesce(func.sum(QuarterAllocation.budget_krw), 0),
            func.coalesce(func.sum(QuarterAllocation.consumed_krw), 0),
            func.count(QuarterAllocation.id),
        ).where(QuarterAllocation.quarter_id == quarter.id)
    ).one()
    absorbed = db.scalar(
        select(func.coalesce(func.sum(UsageEvent.provider_cost * UsageEvent.exchange_rate_krw), 0)).where(
            UsageEvent.quarter_id == quarter.id,
            UsageEvent.club_absorbed.is_(True),
        )
    )
    granted, used = int(granted or 0), int(used or 0)
    total_days = (quarter.ends_at - quarter.starts_at).days + 1
    elapsed = min(total_days, max(0, (today - quarter.starts_at).days + 1))
    forecast = round(used * total_days / elapsed) if elapsed > 0 and used > 0 else None
    return MoneyFlow(
        purchased_krw=int(purchased or 0),
        granted_krw=granted,
        members=int(members or 0),
        used_krw=used,
        unused_krw=max(0, granted - used),
        reserve_krw=int(purchased or 0) - granted,
        reserve_spent_krw=round(float(absorbed or 0)),
        forecast_used_krw=forecast,
        days_left=max(0, (quarter.ends_at - today).days),
    )
