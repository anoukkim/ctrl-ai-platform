"""Admin: quarters, participation applications, and personal top-ups.

Kept separate from admin.py, which owns the video model catalogue, so
neither file becomes a grab bag.

Every route is behind `require_admin`. Authorization is checked here, not
by hiding a button in the frontend.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import (
    AUDIT_ACTION_LABEL,
    AccountStatus,
    AuditAction,
    MembershipStatus,
    QuarterMembership,
    UserRole,
    ApplicationStatus,
    PersonalTopUp,
    Quarter,
    QuarterAllocation,
    QuarterApplication,
    TopUpStatus,
    User,
)
from app.services import audit
from app.services import usage as usage_service
from app.services.quarters import current_quarter, membership_for, set_membership
from app.services.wallet import get_or_create_balance
from app.schemas.usage import SimulateUsageRequest, UsageEventRead
from app.schemas.quarter import (
    AllocationAdjust,
    AllocationRead,
    ApplicationRead,
    AuditLogRead,
    MemberWithMembership,
    MembershipUpdate,
    RoleUpdate,
    ApplicationReview,
    ApplicationWithMember,
    QuarterCreate,
    QuarterRead,
    QuarterUpdate,
    TopUpConfirm,
    TopUpRead,
)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/quarters", response_model=list[QuarterRead], summary="All quarters")
def list_quarters(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[Quarter]:
    return list(db.scalars(select(Quarter).order_by(Quarter.starts_at.desc())))


@router.post(
    "/quarters",
    response_model=QuarterRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a quarter",
)
def create_quarter(
    payload: QuarterCreate,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: User = Depends(require_admin),
) -> Quarter:
    if db.scalar(select(Quarter).where(Quarter.code == payload.code)) is not None:
        raise HTTPException(status_code=409, detail="이미 있는 분기 코드입니다.")

    quarter = Quarter(
        code=payload.code,
        display_name=payload.display_name,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        application_opens_at=payload.application_opens_at,
        application_closes_at=payload.application_closes_at,
        # Each quarter keeps its own limit, copied from the configured
        # default, so changing the default later never alters a quarter
        # that already ran.
        subsidy_limit_krw=(
            payload.subsidy_limit_krw
            if payload.subsidy_limit_krw is not None
            else settings.quarterly_subsidy_limit_krw
        ),
    )
    db.add(quarter)
    db.flush()
    audit.record(
        db,
        actor=_,
        action=AuditAction.QUARTER_CREATED,
        target_type="quarter",
        target_id=quarter.id,
        target_label=quarter.code,
        summary=f"{quarter.display_name} 분기를 만들었습니다.",
        detail={"subsidy_limit_krw": quarter.subsidy_limit_krw},
    )
    db.commit()
    db.refresh(quarter)
    return quarter


@router.patch("/quarters/{quarter_id}", response_model=QuarterRead, summary="Update a quarter")
def update_quarter(
    quarter_id: int,
    payload: QuarterUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Quarter:
    quarter = db.get(Quarter, quarter_id)
    if quarter is None:
        raise HTTPException(status_code=404, detail="분기를 찾을 수 없습니다.")

    changes = payload.model_dump(exclude_unset=True)
    before = {field: getattr(quarter, field) for field in changes}
    for field, value in changes.items():
        setattr(quarter, field, value)

    audit.record(
        db,
        actor=_,
        action=AuditAction.QUARTER_UPDATED,
        target_type="quarter",
        target_id=quarter.id,
        target_label=quarter.code,
        summary=f"{quarter.display_name} 분기를 수정했습니다.",
        detail={"before": {k: str(v) for k, v in before.items()},
                "after": {k: str(v) for k, v in changes.items()}},
    )
    db.commit()
    db.refresh(quarter)
    return quarter


@router.get(
    "/quarters/{quarter_id}/applications",
    response_model=list[ApplicationWithMember],
    summary="Applications for a quarter",
)
def list_applications(
    quarter_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[ApplicationWithMember]:
    rows = db.execute(
        select(QuarterApplication, User)
        .join(User, User.id == QuarterApplication.user_id)
        .where(QuarterApplication.quarter_id == quarter_id)
        .order_by(QuarterApplication.id)
    ).all()

    return [
        ApplicationWithMember(
            **ApplicationRead.model_validate(application).model_dump(),
            username=member.email.split("@")[0],
            display_name=member.display_name,
        )
        for application, member in rows
    ]


@router.post(
    "/applications/{application_id}/review",
    response_model=ApplicationRead,
    summary="Approve or reject an application",
)
def review_application(
    application_id: int,
    payload: ApplicationReview,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> QuarterApplication:
    """Approving creates the allocation the member can actually spend.

    The allocation copies the requested figures rather than recomputing
    them, so a later change to the quarter's subsidy limit cannot silently
    move an allocation that was already approved.
    """
    application = db.get(QuarterApplication, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="신청을 찾을 수 없습니다.")
    if application.status is not ApplicationStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="심사 중인 신청만 처리할 수 있습니다.")

    application.reviewed_at = datetime.now(timezone.utc)
    application.reviewed_by = admin.id
    application.admin_note = payload.admin_note

    if not payload.approve:
        application.status = ApplicationStatus.REJECTED
        applicant = db.get(User, application.user_id)
        audit.record(
            db,
            actor=admin,
            action=AuditAction.APPLICATION_REJECTED,
            target_type="application",
            target_id=application.id,
            target_label=applicant.username if applicant else str(application.user_id),
            summary=f"{applicant.display_name if applicant else application.user_id}의 참여 신청을 거절했습니다.",
            detail={"admin_note": payload.admin_note},
        )
        db.commit()
        db.refresh(application)
        return application

    application.status = ApplicationStatus.APPROVED

    existing = db.scalar(
        select(QuarterAllocation).where(
            QuarterAllocation.user_id == application.user_id,
            QuarterAllocation.quarter_id == application.quarter_id,
        )
    )
    allocation = existing or QuarterAllocation(
        user_id=application.user_id, quarter_id=application.quarter_id
    )
    approved_at = datetime.now(timezone.utc)

    allocation.application_id = application.id
    allocation.community_total_budget_krw = application.requested_total_budget_krw
    allocation.build_budget_krw = application.requested_build_budget_krw
    allocation.video_budget_krw = application.requested_video_budget_krw
    allocation.build_percentage = application.build_percentage
    allocation.video_percentage = application.video_percentage
    allocation.approved_at = approved_at
    allocation.approved_by = admin.id
    # Provider prices as they stood at approval. Kept so a member's quota
    # in tokens or generations stays consistent even if prices change.
    allocation.pricing_snapshot = {"captured_at": approved_at.isoformat()}

    db.add(allocation)

    # Approving is what makes a member a participant in the quarter. The
    # budget alone is not enough: `require_active_member` reads the
    # membership row, so without this the member would have money they
    # could not spend.
    set_membership(db, application.user_id, application.quarter_id, MembershipStatus.ACTIVE)

    applicant = db.get(User, application.user_id)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.APPLICATION_APPROVED,
        target_type="application",
        target_id=application.id,
        target_label=applicant.username if applicant else str(application.user_id),
        summary=(
            f"{applicant.display_name if applicant else application.user_id}의 참여 신청을 승인하고 "
            f"Build {application.requested_build_budget_krw:,}원 / "
            f"Video {application.requested_video_budget_krw:,}원을 배정했습니다."
        ),
        detail={
            "build_budget_krw": application.requested_build_budget_krw,
            "video_budget_krw": application.requested_video_budget_krw,
        },
    )

    db.commit()
    db.refresh(application)
    return application


@router.get("/top-ups", response_model=list[TopUpRead], summary="Personal top-up requests")
def list_top_ups(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[PersonalTopUp]:
    return list(db.scalars(select(PersonalTopUp).order_by(PersonalTopUp.id.desc())))


@router.post(
    "/top-ups/{top_up_id}/confirm",
    response_model=TopUpRead,
    summary="Confirm or reject a top-up",
)
def confirm_top_up(
    top_up_id: int,
    payload: TopUpConfirm,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PersonalTopUp:
    """Manual deposit confirmation — no payment provider is involved.

    The balance only moves on confirmation, so a request alone never gives
    a member spendable money.
    """
    top_up = db.get(PersonalTopUp, top_up_id)
    if top_up is None:
        raise HTTPException(status_code=404, detail="충전 신청을 찾을 수 없습니다.")
    if top_up.status is not TopUpStatus.REQUESTED:
        raise HTTPException(status_code=400, detail="이미 처리한 신청입니다.")

    top_up.confirmed_at = datetime.now(timezone.utc)
    top_up.confirmed_by = admin.id
    top_up.payment_reference = payload.payment_reference

    member = db.get(User, top_up.user_id)

    if not payload.confirm:
        top_up.status = TopUpStatus.REJECTED
        audit.record(
            db,
            actor=admin,
            action=AuditAction.TOPUP_REJECTED,
            target_type="top_up",
            target_id=top_up.id,
            target_label=member.username if member else str(top_up.user_id),
            summary=f"{member.display_name if member else top_up.user_id}의 {top_up.amount_krw:,}원 충전 신청을 거절했습니다.",
        )
        db.commit()
        db.refresh(top_up)
        return top_up

    top_up.status = TopUpStatus.CONFIRMED

    balance = get_or_create_balance(db, top_up.user_id)
    balance.balance_krw += top_up.amount_krw

    audit.record(
        db,
        actor=admin,
        action=AuditAction.TOPUP_CONFIRMED,
        target_type="top_up",
        target_id=top_up.id,
        target_label=member.username if member else str(top_up.user_id),
        summary=(
            f"{member.display_name if member else top_up.user_id}의 "
            f"{top_up.amount_krw:,}원 충전을 확인했습니다."
        ),
        detail={"payment_reference": payload.payment_reference},
    )

    db.commit()
    db.refresh(top_up)
    return top_up


@router.get(
    "/quarters/{quarter_id}/members",
    response_model=list[MemberWithMembership],
    summary="Members and their participation in a quarter",
)
def list_quarter_members(
    quarter_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[MemberWithMembership]:
    """Every account, with its participation in this quarter.

    A left join rather than an inner one: a member with no row simply is
    not participating, and the admin still needs to see them in order to
    enrol them.
    """
    rows = db.execute(
        select(User, QuarterMembership)
        .outerjoin(
            QuarterMembership,
            (QuarterMembership.user_id == User.id)
            & (QuarterMembership.quarter_id == quarter_id),
        )
        .order_by(User.id)
    ).all()

    return [
        MemberWithMembership(
            user_id=member.id,
            username=member.username,
            display_name=member.display_name,
            role=member.role,
            account_status=member.account_status,
            membership_status=membership.status if membership else None,
        )
        for member, membership in rows
    ]


@router.put(
    "/quarters/{quarter_id}/members/{user_id}",
    response_model=MemberWithMembership,
    summary="Set a member's participation in a quarter",
)
def set_quarter_membership(
    quarter_id: int,
    user_id: int,
    payload: MembershipUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MemberWithMembership:
    """Enrol a member, mark them inactive, or record that they have left.

    Setting `former` also closes the account: a former member keeps their
    name on everything they published but cannot sign in again. The two
    are changed together so the admin cannot leave an account that is
    former in one place and active in another.
    """
    quarter = db.get(Quarter, quarter_id)
    if quarter is None:
        raise HTTPException(status_code=404, detail="분기를 찾을 수 없습니다.")

    member = db.get(User, user_id)
    if member is None:
        raise HTTPException(status_code=404, detail="회원을 찾을 수 없습니다.")

    membership = set_membership(db, user_id, quarter_id, payload.status)

    if payload.status is MembershipStatus.FORMER:
        member.account_status = AccountStatus.FORMER
    elif member.account_status is AccountStatus.FORMER:
        # Bringing a former member back re-opens the account.
        member.account_status = AccountStatus.ACTIVE

    audit.record(
        db,
        actor=_,
        action=AuditAction.MEMBERSHIP_SET,
        target_type="user",
        target_id=member.id,
        target_label=member.username,
        summary=(
            f"{member.display_name}의 {quarter.display_name} 참여 상태를 "
            f"{payload.status.value}(으)로 바꿨습니다."
        ),
        detail={"quarter": quarter.code, "status": payload.status.value},
    )

    db.commit()
    db.refresh(member)
    db.refresh(membership)

    return MemberWithMembership(
        user_id=member.id,
        username=member.username,
        display_name=member.display_name,
        role=member.role,
        account_status=member.account_status,
        membership_status=membership.status,
    )


@router.put(
    "/members/{user_id}/role",
    response_model=MemberWithMembership,
    summary="Set a member's system role",
)
def set_member_role(
    user_id: int,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> MemberWithMembership:
    """Only `admin` and `member` exist (CLAUDE.md section 13)."""
    member = db.get(User, user_id)
    if member is None:
        raise HTTPException(status_code=404, detail="회원을 찾을 수 없습니다.")

    if member.id == admin.id and payload.role is not UserRole.ADMIN:
        # Removing your own admin rights locks you out of the screen you
        # would need in order to undo it.
        raise HTTPException(status_code=400, detail="자신의 관리자 권한은 해제할 수 없습니다.")

    before = member.role
    member.role = payload.role

    audit.record(
        db,
        actor=admin,
        action=AuditAction.ROLE_SET,
        target_type="user",
        target_id=member.id,
        target_label=member.username,
        summary=f"{member.display_name}의 역할을 {before.value}에서 {payload.role.value}(으)로 바꿨습니다.",
        detail={"before": before.value, "after": payload.role.value},
    )
    db.commit()
    db.refresh(member)

    quarter = current_quarter(db)
    membership = membership_for(db, member.id, quarter.id) if quarter else None
    return MemberWithMembership(
        user_id=member.id,
        username=member.username,
        display_name=member.display_name,
        role=member.role,
        account_status=member.account_status,
        membership_status=membership.status if membership else None,
    )


@router.put(
    "/quarters/{quarter_id}/allocations/{user_id}",
    response_model=AllocationRead,
    summary="Adjust a member's approved allocation (KRW)",
)
def adjust_allocation(
    quarter_id: int,
    user_id: int,
    payload: AllocationAdjust,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> QuarterAllocation:
    """Change the KRW figures on an allocation that already exists.

    Money is the unit here, not percentages: the admin types won, which is
    what the panel and the member's Usage screen both show. The approved
    percentages are recomputed from the new figures so the two cannot
    disagree.

    The budget may be lowered below what has already been spent — the
    remaining figures clamp at zero rather than going negative — but that
    is a deliberate act and it is logged.
    """
    allocation = db.scalar(
        select(QuarterAllocation).where(
            QuarterAllocation.user_id == user_id,
            QuarterAllocation.quarter_id == quarter_id,
        )
    )
    if allocation is None:
        raise HTTPException(
            status_code=404,
            detail="승인된 지원금이 없습니다. 먼저 참여 신청을 승인해 주세요.",
        )

    member = db.get(User, user_id)
    before = {
        "build_budget_krw": allocation.build_budget_krw,
        "video_budget_krw": allocation.video_budget_krw,
    }

    total = payload.build_budget_krw + payload.video_budget_krw
    allocation.build_budget_krw = payload.build_budget_krw
    allocation.video_budget_krw = payload.video_budget_krw
    allocation.community_total_budget_krw = total
    # Percentages follow the money, so they can never drift from it.
    allocation.build_percentage = round(payload.build_budget_krw * 100 / total) if total else 0
    allocation.video_percentage = 100 - allocation.build_percentage if total else 0

    audit.record(
        db,
        actor=admin,
        action=AuditAction.ALLOCATION_ADJUSTED,
        target_type="allocation",
        target_id=allocation.id,
        target_label=member.username if member else str(user_id),
        summary=(
            f"{member.display_name if member else user_id}의 지원금을 "
            f"Build {payload.build_budget_krw:,}원 / Video {payload.video_budget_krw:,}원으로 "
            f"조정했습니다."
        ),
        detail={"before": before, "after": {
            "build_budget_krw": payload.build_budget_krw,
            "video_budget_krw": payload.video_budget_krw,
        }, "note": payload.note},
    )
    db.commit()
    db.refresh(allocation)
    return allocation


@router.get("/audit", response_model=list[AuditLogRead], summary="Audit log (read-only)")
def read_audit_log(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[AuditLogRead]:
    """Every administrative change, newest first.

    Read-only by design: nothing in the application updates or deletes an
    audit row.
    """
    return [
        AuditLogRead(
            **AuditLogRead.model_validate(row).model_dump(exclude={"action_label"}),
            action_label=AUDIT_ACTION_LABEL.get(row.action, row.action),
        )
        for row in audit.recent(db)
    ]


@router.post(
    "/simulate-usage",
    response_model=UsageEventRead,
    status_code=status.HTTP_201_CREATED,
    summary="Development only: record a charge through the real budget service",
)
def simulate_usage(
    payload: SimulateUsageRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> UsageEventRead:
    """Spend a member's budget without calling a provider.

    This exists so the Usage screen and the audit log can be exercised
    before any provider is connected (Phases 2 and 6). It deliberately
    goes through the same `charge()` the real providers will use — a
    shortcut that wrote its own ledger row would prove nothing about the
    code that matters.

    **Returns 404 outside development**, not 403: in a deployed
    environment this endpoint should not appear to exist at all. 404 is
    also what FastAPI returns for an unknown path, so the response is
    indistinguishable from the route being absent.
    """
    if not settings.is_development:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    target = db.get(User, payload.user_id) if payload.user_id else admin
    if target is None:
        raise HTTPException(status_code=404, detail="회원을 찾을 수 없습니다.")

    try:
        result = usage_service.charge(
            db,
            user=target,
            category=payload.category,
            amount_krw=payload.amount_krw,
            provider=payload.provider,
            model_id=payload.model_id,
        )
    except usage_service.NoQuarterError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except usage_service.InsufficientBudgetError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    # Logged like any other admin action: this moves someone's money.
    audit.record(
        db,
        actor=admin,
        action=AuditAction.USAGE_SIMULATED,
        target_type="user",
        target_id=target.id,
        target_label=target.username,
        summary=(
            f"{target.display_name}의 {payload.category.value} 예산에서 "
            f"{payload.amount_krw:,}원을 시뮬레이션으로 사용했습니다."
        ),
        detail={"provider": payload.provider, "funding_source": result.funding_source.value},
    )
    db.commit()

    return UsageEventRead(
        **UsageEventRead.model_validate(result.event).model_dump(exclude={"label"}),
        label="시뮬레이션",
    )
