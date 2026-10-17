"""Admin: where the money went (cost-clarity, 2026-10-14).

Admin › Budget's club side — credit bought per provider and what is
estimated to be left, 지급 vs 사용, the per-member table, the caching
panel, CSV exports and the optional reconciliation against Anthropic's
cost report — plus the three money actions: a wallet adjustment (Admin ›
Members), and closing a quarter with its carry-over (Admin › Quarters).

Every route is `require_admin`. Every write appends a row and an audit
entry in one transaction; nothing here updates or deletes a purchase or
an adjustment.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import AuditAction, AuditLog, Quarter, UsageEvent, User
from app.schemas.accounting import (
    AdjustmentCreate,
    AdjustmentRead,
    CacheRowRead,
    CloseLineRead,
    ClosePreviewRead,
    CloseRequest,
    CreditOverviewRead,
    MemberMoneyRowRead,
    ProviderCreditRead,
    PurchaseCreate,
    PurchaseRead,
    QuarterMoneyRead,
    ReconcileDayRead,
    ReconcileRead,
)
from app.services import money_flow as money_flow_service
from app.services import accounting, audit, cost_report, purge
from app.services.storage import get_storage
from app.services.quarters import current_quarter

router = APIRouter(prefix="/admin", tags=["admin"])


def _usd(value: Decimal) -> str:
    return str(Decimal(value).quantize(Decimal("0.01")))


def _quarter(db: Session, quarter_id: int) -> Quarter:
    quarter = db.get(Quarter, quarter_id)
    if quarter is None:
        raise HTTPException(status_code=404, detail="분기를 찾을 수 없습니다.")
    return quarter


def _purchase_read(purchase, username: str) -> PurchaseRead:
    return PurchaseRead(
        id=purchase.id,
        provider=purchase.provider,
        provider_label=accounting.PROVIDER_LABEL.get(purchase.provider, purchase.provider),
        purchased_on=purchase.purchased_on,
        amount_usd=_usd(purchase.amount_usd),
        paid_krw=purchase.paid_krw,
        memo=purchase.memo,
        created_by_username=username,
        created_at=purchase.created_at,
    )


# ----------------------------------------------------------- club credit


@router.get("/credit", response_model=CreditOverviewRead, summary="Club credit per provider")
def read_credit(
    quarter_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> CreditOverviewRead:
    """Bought, used (from the ledger) and estimated remaining, per provider.

    The estimate is ours; the provider's console is the final word.
    """
    quarter = _quarter(db, quarter_id) if quarter_id is not None else current_quarter(db)
    providers = [
        ProviderCreditRead(
            provider=line.provider,
            label=line.label,
            purchased_usd=_usd(line.purchased_usd),
            paid_krw=line.paid_krw,
            purchases=line.purchases,
            used_usd=_usd(line.used_usd),
            absorbed_usd=_usd(line.absorbed_usd),
            used_krw=line.used_krw,
            used_usd_quarter=_usd(line.used_usd_quarter),
            used_krw_quarter=line.used_krw_quarter,
            remaining_usd=_usd(line.remaining_usd),
            unpriced_events=line.unpriced_events,
        )
        for line in accounting.provider_credit(db, quarter)
    ]
    return CreditOverviewRead(
        providers=providers,
        purchases=[_purchase_read(p, u) for p, u in accounting.purchases(db)],
        report_provider=(
            "anthropic"
            if settings.anthropic_admin_provider.strip().lower() == "anthropic"
            else "mock"
        ),
    )


@router.post(
    "/credit/purchases",
    response_model=PurchaseRead,
    status_code=201,
    summary="Record a credit purchase (append-only)",
)
def create_purchase(
    payload: PurchaseCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PurchaseRead:
    provider = accounting.provider_key(payload.provider.strip().lower())
    if provider not in accounting.PURCHASE_PROVIDERS:
        raise HTTPException(status_code=400, detail="알 수 없는 제공자입니다.")
    memo = payload.memo.strip()
    if payload.amount_usd < 0 and not memo:
        raise HTTPException(
            status_code=400,
            detail="음수는 앞선 기록을 바로잡을 때만 씁니다. 메모에 무엇을 바로잡는지 적어 주세요.",
        )
    if payload.purchased_on > date.today() + timedelta(days=1):
        raise HTTPException(status_code=400, detail="구매일이 미래입니다.")
    row = accounting.record_purchase(
        db,
        admin=admin,
        provider=provider,
        purchased_on=payload.purchased_on,
        amount_usd=payload.amount_usd,
        paid_krw=payload.paid_krw,
        memo=memo,
    )
    db.commit()
    db.refresh(row)
    return _purchase_read(row, admin.username)


# ------------------------------------------------------ 지급 vs 사용, members


@router.get(
    "/quarters/{quarter_id}/money",
    response_model=QuarterMoneyRead,
    summary="Granted vs used, and the per-member table",
)
def read_quarter_money(
    quarter_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> QuarterMoneyRead:
    quarter = _quarter(db, quarter_id)
    rows = accounting.member_rows(db, quarter)
    absorbed = db.scalar(
        select(func.coalesce(func.sum(UsageEvent.provider_cost), 0)).where(
            UsageEvent.quarter_id == quarter.id, UsageEvent.club_absorbed.is_(True)
        )
    )
    return QuarterMoneyRead(
        quarter_id=quarter.id,
        quarter_name=quarter.display_name,
        closed_at=quarter.closed_at,
        carry_over_percent=quarter.carry_over_percent,
        granted_krw=sum(row.granted_krw for row in rows),
        charged_krw=sum(row.consumed_krw for row in rows),
        unspent_krw=sum(row.remaining_krw for row in rows),
        cache_saved_krw=round(sum(row.cache_saved_krw for row in rows), 2),
        absorbed_usd=_usd(Decimal(str(absorbed or 0))),
        members=[
            MemberMoneyRowRead(
                user_id=row.user_id,
                username=row.username,
                display_name=row.display_name,
                membership_status=row.membership_status,
                granted_krw=row.granted_krw,
                consumed_krw=row.consumed_krw,
                remaining_krw=row.remaining_krw,
                chat_krw=row.by_group["chat"],
                build_krw=row.by_group["build"],
                video_krw=row.by_group["video"],
                other_krw=row.by_group["other"],
                cache_saved_krw=row.cache_saved_krw,
                adjusted_krw=row.adjusted_krw,
                carried_in_krw=row.carried_in_krw,
                frozen=row.frozen,
                reclaimed_krw=row.reclaimed_krw,
                carry_over_krw=row.carry_over_krw,
            )
            for row in rows
        ],
    )


@router.get("/cache-panel", response_model=list[CacheRowRead], summary="Caching per model per day")
def read_cache_panel(
    days: int = Query(default=14, ge=1, le=92),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[CacheRowRead]:
    return [
        CacheRowRead(
            day=row.day,
            model_id=row.model_id,
            replies=row.replies,
            hit_replies=row.hit_replies,
            hit_rate=row.hit_rate,
            input_tokens=row.input_tokens,
            write_tokens=row.write_tokens,
            read_tokens=row.read_tokens,
            write_krw=float(row.write_krw.quantize(Decimal("0.01"))),
            saved_krw=float(row.saved_krw.quantize(Decimal("0.01"))),
            estimated=row.estimated,
        )
        for row in accounting.cache_panel(db, days)
    ]


# ----------------------------------------------------------------- CSV


def _csv(body: bytes, filename: str) -> Response:
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/members.csv", summary="Per-member figures for one quarter (CSV)")
def export_members(
    quarter_id: int = Query(),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    quarter = _quarter(db, quarter_id)
    return _csv(accounting.members_csv(db, quarter), f"ctrlai-members-{quarter.code}.csv")


@router.get("/export/daily.csv", summary="Per-day totals for one quarter (CSV)")
def export_daily(
    quarter_id: int = Query(),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    quarter = _quarter(db, quarter_id)
    return _csv(accounting.daily_csv(db, quarter), f"ctrlai-daily-{quarter.code}.csv")


@router.get("/export/purchases.csv", summary="Every credit purchase (CSV)")
def export_purchases(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    return _csv(accounting.purchases_csv(db), "ctrlai-purchases.csv")


@router.get("/export/caching.csv", summary="Caching per model per day (CSV)")
def export_caching(
    days: int = Query(default=30, ge=1, le=92),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    return _csv(accounting.caching_csv(db, days), f"ctrlai-caching-{days}d.csv")


# ------------------------------------------------------- wallet adjustments


def _adjustment_read(row, quarter_name: str, username: str) -> AdjustmentRead:
    return AdjustmentRead(
        id=row.id,
        quarter_id=row.quarter_id,
        quarter_name=quarter_name,
        amount_krw=row.amount_krw,
        kind=row.kind,
        reason=row.reason,
        budget_before_krw=row.budget_before_krw,
        budget_after_krw=row.budget_after_krw,
        created_by_username=username,
        created_at=row.created_at,
    )


@router.post(
    "/quarters/{quarter_id}/allocations/{user_id}/adjustments",
    response_model=AdjustmentRead,
    status_code=201,
    summary="Adjust one member's wallet (+/− KRW, with a reason)",
)
def create_adjustment(
    quarter_id: int,
    user_id: int,
    payload: AdjustmentCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AdjustmentRead:
    quarter = _quarter(db, quarter_id)
    try:
        row = accounting.adjust_wallet(
            db,
            admin=admin,
            quarter=quarter,
            user_id=user_id,
            amount_krw=payload.amount_krw,
            reason=payload.reason,
        )
    except accounting.AccountingError as error:
        db.rollback()
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None
    db.commit()
    db.refresh(row)
    return _adjustment_read(row, quarter.display_name, admin.username)


@router.get(
    "/members/{user_id}/adjustments",
    response_model=list[AdjustmentRead],
    summary="One member's wallet adjustments",
)
def list_adjustments(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[AdjustmentRead]:
    return [
        _adjustment_read(row, quarter_name, username)
        for row, quarter_name, username in accounting.adjustments_for(db, user_id)
    ]


# ------------------------------------------------------------ quarter close


def _close_read(
    quarter: Quarter, percent: int, lines, closed: bool, purge_count: int
) -> ClosePreviewRead:
    return ClosePreviewRead(
        quarter_id=quarter.id,
        quarter_name=quarter.display_name,
        carry_over_percent=percent,
        closed=closed,
        reclaimed_krw=sum(line.reclaimed_krw for line in lines),
        carry_over_krw=sum(line.carry_over_krw for line in lines),
        lines=[CloseLineRead(**line.__dict__) for line in lines],
        purge_count=purge_count,
    )


def _purged_at_close(db: Session, quarter: Quarter) -> int:
    """How many deleted items the close removed — from its audit row."""
    row = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == AuditAction.WORK_PURGED_AT_CLOSE, AuditLog.target_id == quarter.id)
        .order_by(AuditLog.id.desc())
    )
    return int((row.detail or {}).get("count", 0)) if row is not None else 0


@router.get(
    "/quarters/{quarter_id}/close-preview",
    response_model=ClosePreviewRead,
    summary="What closing the quarter would freeze and reclaim",
)
def preview_close(
    quarter_id: int,
    carry_over_percent: int = Query(default=0, ge=0, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> ClosePreviewRead:
    quarter = _quarter(db, quarter_id)
    if quarter.closed_at is not None:
        # Closed already: the recorded figures, not a recomputation.
        lines = [
            accounting.CloseLine(
                user_id=line.user_id,
                username=line.username,
                display_name=line.display_name,
                budget_krw=line.granted_krw,
                consumed_krw=line.consumed_krw,
                reclaimed_krw=line.reclaimed_krw or 0,
                carry_over_krw=line.carry_over_krw or 0,
            )
            for line in accounting.member_rows(db, quarter)
        ]
        return _close_read(
            quarter, quarter.carry_over_percent, lines, closed=True,
            purge_count=_purged_at_close(db, quarter),
        )
    lines = accounting.close_preview(db, quarter, carry_over_percent)
    # 분기 마감 also purges everything still in Deleted Items (ui-improvements
    # B) — the dialog says how many, so nothing disappears unannounced.
    return _close_read(
        quarter, carry_over_percent, lines, closed=False, purge_count=purge.deleted_count(db, until=purge.close_cutoff(quarter))
    )


@router.post(
    "/quarters/{quarter_id}/close",
    response_model=ClosePreviewRead,
    summary="분기 마감: freeze every wallet, record 회수 and carry-over",
)
def close_quarter(
    quarter_id: int,
    payload: CloseRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ClosePreviewRead:
    quarter = _quarter(db, quarter_id)
    try:
        lines = accounting.close_quarter(
            db, admin=admin, quarter=quarter, percent=payload.carry_over_percent
        )
    except accounting.AccountingError as error:
        db.rollback()
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None
    # Everything nobody restored goes with the quarter (owner, 2026-10-16).
    # Same transaction as the freeze: a close either does both or neither.
    purged = purge.purge_all_deleted(db, admin=admin, quarter=quarter)
    db.commit()
    purge.remove_files(settings, get_storage(settings), purged)
    return _close_read(quarter, payload.carry_over_percent, lines, closed=True, purge_count=len(purged))


# ----------------------------------------------------------- reconciliation


@router.get(
    "/reconcile",
    response_model=ReconcileRead,
    summary="Our recorded Anthropic cost vs Anthropic's cost report",
)
def reconcile(
    start: date = Query(),
    end: date = Query(),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ReconcileRead:
    provider = cost_report.get_cost_report_provider(settings, db)
    try:
        days = cost_report.reconcile(db, provider, start, end)
    except cost_report.CostReportError as error:
        raise HTTPException(status_code=400, detail=str(error)) from None
    return ReconcileRead(
        provider=provider.name,
        start=start,
        end=end,
        ours_usd=_usd(sum((day.ours_usd for day in days), Decimal(0))),
        anthropic_usd=_usd(sum((day.anthropic_usd for day in days), Decimal(0))),
        days=[
            ReconcileDayRead(
                day=day.day,
                ours_usd=_usd(day.ours_usd),
                anthropic_usd=_usd(day.anthropic_usd),
                difference_usd=_usd(day.difference_usd),
                matches=day.matches,
            )
            for day in days
        ],
    )


# ----------------------------------------------------------- 돈의 흐름 (v3)


class MoneyFlowRead(BaseModel):
    """admin-consolidation v3: where the bought credit went, in won."""

    purchased_krw: int
    granted_krw: int
    members: int
    used_krw: int
    unused_krw: int
    #: Bought but not handed out (negative: more handed out than bought).
    reserve_krw: int
    #: What the reserve itself paid for (calls the club absorbed).
    reserve_spent_krw: int
    forecast_used_krw: int | None = None
    days_left: int


@router.get(
    "/quarters/{quarter_id}/money-flow",
    response_model=MoneyFlowRead,
    summary="돈의 흐름: credit bought, handed out (used / unused), the reserve",
)
def read_money_flow(
    quarter_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MoneyFlowRead:
    return MoneyFlowRead(**vars(money_flow_service.money_flow(db, _quarter(db, quarter_id))))


class CloseStepsRead(BaseModel):
    """What the 분기 마감 steps need beyond the quarter itself (v3)."""

    apps_archived_at: datetime | None = None


def _apps_archived_at(db: Session, quarter_id: int) -> datetime | None:
    return db.scalar(
        select(AuditLog.created_at)
        .where(
            AuditLog.action == AuditAction.QUARTER_APPS_ARCHIVED,
            AuditLog.target_type == "quarter",
            AuditLog.target_id == quarter_id,
        )
        .order_by(AuditLog.id.desc())
        .limit(1)
    )


@router.get("/quarters/{quarter_id}/close-steps", response_model=CloseStepsRead, summary="분기 마감 steps' own state")
def read_close_steps(quarter_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> CloseStepsRead:
    _quarter(db, quarter_id)
    return CloseStepsRead(apps_archived_at=_apps_archived_at(db, quarter_id))


class EmptyRequest(BaseModel):
    """A write with nothing to say still sends a JSON body (CLAUDE.md §2)."""


@router.post(
    "/quarters/{quarter_id}/apps-archived",
    response_model=CloseStepsRead,
    summary="분기 마감 4단계: the admin confirms the apps are put away (audited)",
)
def confirm_apps_archived(
    quarter_id: int,
    payload: EmptyRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> CloseStepsRead:
    """The step's own record is its audit row — the log is append-only and
    every admin sees the step as done."""
    quarter = _quarter(db, quarter_id)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.QUARTER_APPS_ARCHIVED,
        target_type="quarter",
        target_id=quarter.id,
        target_label=quarter.code,
        summary=f"{quarter.display_name} 분기 마감 — 앱 보관을 확인했습니다.",
    )
    db.commit()
    return CloseStepsRead(apps_archived_at=_apps_archived_at(db, quarter_id))

