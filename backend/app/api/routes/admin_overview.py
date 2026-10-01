"""Admin: the dashboard and the member detail page.

Both routes here are **read-only**. They add no business rule and change
nothing: every figure they return is already decided elsewhere, and this
module only gathers it into one response so a screen does not have to
make six calls and then show figures from six different moments.

Kept apart from `admin_quarters.py`, which owns the routes that *change*
things, so it stays obvious that nothing in this file writes.

Every route is behind `require_admin`. Authorization is checked here, not
by hiding a card in the frontend.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import (
    AUDIT_ACTION_LABEL,
    AccountStatus,
    ApplicationStatus,
    PersonalBalance,
    PersonalTopUp,
    Quarter,
    QuarterAllocation,
    QuarterApplication,
    QuarterMembership,
    TopUpStatus,
    User,
    VideoModel,
)
from app.schemas.quarter import (
    AdminDashboard,
    AllocationRead,
    ApplicationRead,
    ApplicationStatsRead,
    AuditLogRead,
    MemberDetail,
    MemberQuarterHistory,
    MemberStatsRead,
    PersonalBalanceRead,
    ProviderCheckResult,
    ProviderStatusRead,
    QuarterRead,
    QuarterStatsRead,
    QuarterWithStats,
    StatusCounts,
    TopUpRead,
)
from app.services import admin_stats, audit, providers
from app.services.quarters import current_quarter

router = APIRouter(prefix="/admin", tags=["admin"])


def _audit_rows(rows) -> list[AuditLogRead]:
    """Attach the Korean action label the same way the audit route does."""
    return [
        AuditLogRead(
            **AuditLogRead.model_validate(row).model_dump(exclude={"action_label"}),
            action_label=AUDIT_ACTION_LABEL.get(row.action, row.action),
        )
        for row in rows
    ]


def _quarter_stats_read(stats) -> QuarterStatsRead | None:
    """A `QuarterStats` as the wire shape, with the rate worked out once."""
    if stats is None:
        return None
    return QuarterStatsRead(
        quarter_id=stats.quarter_id,
        applicants=stats.applicants,
        pending=stats.pending,
        participants=stats.participants,
        users_with_usage=stats.users_with_usage,
        usage_rate=stats.usage_rate,
    )


def _failing_providers(db: Session, settings: Settings) -> list[str]:
    """Real providers whose last call or check failed.

    Mock providers are never included. A mock cannot fail in a way an
    admin can act on, and a warning card that fires on the default
    configuration would be noise on every fresh install.
    """
    rows = providers.all_status(db)
    failing = []
    for entry in providers.PROVIDERS:
        key = entry["key"]
        if settings.provider_is_mock(key):
            continue
        row = rows.get(key)
        if row is None or row.last_error_at is None:
            continue
        # Only if the failure is the most recent thing that happened.
        if row.last_success_at is not None and row.last_success_at >= row.last_error_at:
            continue
        failing.append(entry["name"])
    return failing


@router.get("/dashboard", response_model=AdminDashboard, summary="Admin dashboard figures")
def read_dashboard(
    quarter_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> AdminDashboard:
    """Counts, the work waiting, and the most recent administrative changes.

    `quarter_id` is optional: without it the dashboard shows the current
    quarter, chosen by the same rule members see, so Admin and Profile
    never disagree about which quarter "now" is.
    """
    quarter = db.get(Quarter, quarter_id) if quarter_id is not None else current_quarter(db)
    if quarter_id is not None and quarter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="분기를 찾을 수 없습니다.")

    # Counted in the database rather than by loading every row: these are
    # numbers on a card, and the member list has its own endpoint.
    accounts = {
        row.value if isinstance(row, AccountStatus) else str(row): count
        for row, count in db.execute(
            select(User.account_status, func.count(User.id)).group_by(User.account_status)
        ).all()
    }
    total_accounts = sum(accounts.values())

    membership: dict[str, int] = {}
    pending_applications = 0
    if quarter is not None:
        membership = {
            row.value if hasattr(row, "value") else str(row): count
            for row, count in db.execute(
                select(QuarterMembership.status, func.count(QuarterMembership.id))
                .where(QuarterMembership.quarter_id == quarter.id)
                .group_by(QuarterMembership.status)
            ).all()
        }
        # A missing row means "not participating" (CLAUDE.md section 10),
        # so the remainder is counted rather than read.
        membership["none"] = max(0, total_accounts - sum(membership.values()))

        pending_applications = (
            db.scalar(
                select(func.count(QuarterApplication.id)).where(
                    QuarterApplication.quarter_id == quarter.id,
                    QuarterApplication.status == ApplicationStatus.SUBMITTED,
                )
            )
            or 0
        )

    pending_top_ups = (
        db.scalar(
            select(func.count(PersonalTopUp.id)).where(
                PersonalTopUp.status == TopUpStatus.REQUESTED
            )
        )
        or 0
    )

    models_total = db.scalar(select(func.count(VideoModel.id))) or 0
    models_visible = (
        db.scalar(
            select(func.count(VideoModel.id)).where(
                VideoModel.enabled.is_(True), VideoModel.member_visible.is_(True)
            )
        )
        or 0
    )

    # The same functions the section screens call, so the dashboard and
    # 회원 / 신청 승인 / 분기 설정 cannot show different numbers.
    figures = admin_stats.dashboard_counts(db, quarter)

    return AdminDashboard(
        quarter=QuarterRead.model_validate(quarter) if quarter is not None else None,
        pending_applications=pending_applications,
        pending_top_ups=pending_top_ups,
        counts=StatusCounts(
            accounts=accounts,
            membership=membership,
            total=total_accounts,
        ),
        members=MemberStatsRead(**vars(figures.members)),
        applications=ApplicationStatsRead(**vars(figures.applications)),
        quarter_stats=_quarter_stats_read(figures.quarter),
        video_models_total=models_total,
        video_models_member_visible=models_visible,
        recent_audit=_audit_rows(audit.recent(db, limit=10)),
        is_development=settings.is_development,
        failing_providers=_failing_providers(db, settings),
    )


@router.get(
    "/members/{user_id}",
    response_model=MemberDetail,
    summary="One member: account, participation history, budgets and audit trail",
)
def read_member(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MemberDetail:
    """Everything the member detail page shows, in one call.

    The participation history is per quarter because participation *is*
    per quarter: someone may be active in Q1, sit out Q2 and return in
    Q3, and an admin deciding what to do next needs to see that rather
    than only this quarter's row.
    """
    member = db.get(User, user_id)
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회원을 찾을 수 없습니다.")

    quarters = list(db.scalars(select(Quarter).order_by(Quarter.starts_at.desc())))

    memberships = {
        row.quarter_id: row
        for row in db.scalars(
            select(QuarterMembership).where(QuarterMembership.user_id == user_id)
        )
    }
    # The newest application per quarter. There is one live application per
    # member per quarter, but a cancelled one can leave an older row behind.
    applications: dict[int, QuarterApplication] = {}
    for row in db.scalars(
        select(QuarterApplication)
        .where(QuarterApplication.user_id == user_id)
        .order_by(QuarterApplication.id)
    ):
        applications[row.quarter_id] = row

    allocations = {
        row.quarter_id: row
        for row in db.scalars(
            select(QuarterAllocation).where(QuarterAllocation.user_id == user_id)
        )
    }

    history = [
        MemberQuarterHistory(
            quarter_id=quarter.id,
            quarter_code=quarter.code,
            quarter_display_name=quarter.display_name,
            quarter_status=quarter.status,
            membership_status=(
                memberships[quarter.id].status if quarter.id in memberships else None
            ),
            application=(
                ApplicationRead.model_validate(applications[quarter.id])
                if quarter.id in applications
                else None
            ),
            allocation=(
                AllocationRead.model_validate(allocations[quarter.id])
                if quarter.id in allocations
                else None
            ),
        )
        for quarter in quarters
    ]

    # Read, never create. `get_or_create_balance` would flush a row, and a
    # GET that writes is a surprise waiting to happen; a member with no
    # wallet yet simply has nothing in it.
    balance = db.scalar(select(PersonalBalance).where(PersonalBalance.user_id == user_id))
    top_ups = list(
        db.scalars(
            select(PersonalTopUp)
            .where(PersonalTopUp.user_id == user_id)
            .order_by(PersonalTopUp.id.desc())
        )
    )

    return MemberDetail(
        user_id=member.id,
        username=member.username,
        display_name=member.display_name,
        email=member.email,
        role=member.role,
        account_status=member.account_status,
        created_at=member.created_at,
        quarters=history,
        personal=PersonalBalanceRead(
            balance_krw=balance.balance_krw if balance else 0,
            consumed_krw=balance.consumed_krw if balance else 0,
            remaining_krw=(
                max(0, balance.balance_krw - balance.consumed_krw) if balance else 0
            ),
            overage_enabled=balance.overage_enabled if balance else False,
        ),
        top_ups=[TopUpRead.model_validate(row) for row in top_ups],
        audit=_audit_rows(audit.for_member(db, member.id, member.username)),
    )


# ------------------------------------------------------- 구역별 숫자
#
# 각 화면이 자기 숫자를 한 번에 받습니다. 전부 `services/admin_stats.py`의
# 묶음 질의를 지나가므로, 대시보드와 구역 화면이 다른 답을 낼 수 없습니다.


@router.get(
    "/stats/applications",
    response_model=ApplicationStatsRead,
    summary="Application counts for one quarter",
)
def read_application_stats(
    quarter_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> ApplicationStatsRead:
    quarter = db.get(Quarter, quarter_id) if quarter_id is not None else current_quarter(db)
    if quarter_id is not None and quarter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="분기를 찾을 수 없습니다.")

    stats = admin_stats.application_stats(db, quarter.id if quarter else None)
    return ApplicationStatsRead(**vars(stats))


@router.get(
    "/stats/members",
    response_model=MemberStatsRead,
    summary="Member counts for one quarter",
)
def read_member_stats(
    quarter_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MemberStatsRead:
    quarter = db.get(Quarter, quarter_id) if quarter_id is not None else current_quarter(db)
    if quarter_id is not None and quarter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="분기를 찾을 수 없습니다.")

    stats = admin_stats.member_stats(db, quarter.id if quarter else None)
    return MemberStatsRead(**vars(stats))


@router.get(
    "/quarters-with-stats",
    response_model=list[QuarterWithStats],
    summary="Every quarter with its applicant, participant and usage figures",
)
def read_quarters_with_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[QuarterWithStats]:
    """The 분기 설정 table, in a fixed number of queries.

    The figures for every quarter come from four grouped queries, not one
    set per row: this table shows all quarters at once, and a per-row
    query is how a screen becomes slow without anyone noticing.
    """
    quarters = list(db.scalars(select(Quarter).order_by(Quarter.starts_at.desc())))
    stats = admin_stats.quarter_stats(db, [quarter.id for quarter in quarters])

    return [
        QuarterWithStats(
            **QuarterRead.model_validate(quarter).model_dump(),
            stats=_quarter_stats_read(stats[quarter.id]),
        )
        for quarter in quarters
    ]


# ------------------------------------------------------- 외부 서비스


@router.get(
    "/providers",
    response_model=list[ProviderStatusRead],
    summary="External service status — never the credentials",
)
def read_providers(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> list[ProviderStatusRead]:
    """Which provider implementation is selected, and how it last went.

    **No API key, secret or token appears in this response.** `has_key`
    is a yes/no, and the error text is the status line the provider
    returned, never the request that was sent to it.
    """
    rows = providers.all_status(db)

    return [
        ProviderStatusRead(
            key=entry["key"],
            name=entry["name"],
            purpose=entry["purpose"],
            setting=entry["setting"],
            mode=settings.provider_mode(entry["key"]),
            is_mock=settings.provider_is_mock(entry["key"]),
            has_key=settings.provider_has_key(entry["key"]),
            last_success_at=rows[entry["key"]].last_success_at if entry["key"] in rows else None,
            last_success_label=(
                rows[entry["key"]].last_success_label if entry["key"] in rows else ""
            ),
            last_error_at=rows[entry["key"]].last_error_at if entry["key"] in rows else None,
            last_error_message=(
                providers.explain(rows[entry["key"]].last_error_kind)
                if entry["key"] in rows and rows[entry["key"]].last_error_at is not None
                else ""
            ),
            # No provider in use reports a balance through its API yet, so
            # the field is left out rather than filled with a guess. A
            # made-up 0 would read as "out of credit".
            balance_label=None,
        )
        for entry in providers.PROVIDERS
    ]


@router.post(
    "/providers/{provider}/check",
    response_model=ProviderCheckResult,
    summary="Check one provider's connection, on request only",
)
def check_provider(
    provider: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ProviderCheckResult:
    """Run the cheapest check that provider offers, and record the result.

    Only on the button press. A background poll against a paid API spends
    money to produce a green dot nobody asked for.

    In mock mode nothing leaves the process — the answer is that mock
    mode is on.
    """
    if provider not in providers.PROVIDER_KEYS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="그런 외부 서비스가 없습니다."
        )

    result = providers.check(db, provider, settings)
    db.commit()

    return ProviderCheckResult(
        key=provider,
        ok=result.ok,
        message=result.message,
        checked_at=datetime.now(timezone.utc),
    )
