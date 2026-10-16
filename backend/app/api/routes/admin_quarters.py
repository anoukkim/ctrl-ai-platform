"""Admin: quarters, participation applications, and personal top-ups.

Kept separate from admin.py, which owns the video model catalogue, so
neither file becomes a grab bag.

Every route is behind `require_admin`. Authorization is checked here, not
by hiding a button in the frontend.
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

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
    QuarterStatus,
    TopUpStatus,
    User,
    WalletAdjustment,
)
from app.services import accounting, audit
from app.services import quarter_budget as quarter_budget_service
from app.services import withdrawal as withdrawal_service
from app.services.quarters import current_quarter, membership_for, set_membership
from app.services.wallet import get_or_create_balance
from app.schemas.quarter import (
    ApplicationRead,
    AuditLogRead,
    MemberWithMembership,
    MembershipUpdate,
    RoleUpdate,
    ApplicationReview,
    ApplicationWithMember,
    QuarterBudgetRead,
    QuarterCreate,
    QuarterRead,
    QuarterUpdate,
    TopUpConfirm,
    TopUpRead,
    date_problem,
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
        raise HTTPException(status_code=409, detail=f"{payload.code} 분기가 이미 있습니다.")
    _refuse_overlap(db, payload.starts_at, payload.ends_at)

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


def _refuse_overlap(db: Session, starts_at, ends_at, ignore_id: int | None = None) -> None:
    """Quarters never overlap (fix-quarter-form-autofill): one date belongs
    to one quarter, or wallets and reports would disagree about it."""
    clash = db.scalar(
        select(Quarter)
        .where(Quarter.starts_at <= ends_at, Quarter.ends_at >= starts_at)
        .where(Quarter.id != (ignore_id if ignore_id is not None else -1))
        .order_by(Quarter.starts_at)
        .limit(1)
    )
    if clash is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"기간이 {clash.display_name}({clash.starts_at.isoformat()} – "
                f"{clash.ends_at.isoformat()})와 겹칩니다. 분기 기간은 겹칠 수 없습니다."
            ),
        )


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
    # 분기 마감 is its own action (cost-clarity): it freezes every wallet
    # and records 회수 and carry-over. Setting the status by hand would
    # skip all of that, and a closed quarter never reopens — its frozen
    # wallets must not move again.
    if quarter.status is QuarterStatus.CLOSED or quarter.closed_at is not None:
        if "status" in changes and changes["status"] is not QuarterStatus.CLOSED:
            raise HTTPException(
                status_code=409, detail="마감한 분기는 다시 열 수 없습니다."
            )
    elif changes.get("status") is QuarterStatus.CLOSED:
        raise HTTPException(
            status_code=400,
            detail="분기는 Admin › Quarters의 '분기 마감'으로만 마감합니다 — 지갑을 멈추고 회수를 기록합니다.",
        )
    # The same date rules as creating, on the dates the quarter would end
    # up with — never trust the form (fix-quarter-form-autofill).
    after = {
        field: changes.get(field, getattr(quarter, field))
        for field in ("starts_at", "ends_at", "application_opens_at", "application_closes_at")
    }
    # A deadline set on a quarter that never had an application window
    # (both dates empty) opens the window from the quarter's first day —
    # the dialog sends only the deadline, and the date rule wants both.
    if (
        changes.get("application_closes_at") is not None
        and "application_opens_at" not in changes
        and after["application_opens_at"] is None
    ):
        changes["application_opens_at"] = after["application_opens_at"] = min(
            after["starts_at"], changes["application_closes_at"]
        )
    problem = date_problem(
        after["starts_at"], after["ends_at"],
        after["application_opens_at"], after["application_closes_at"],
    )
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if "starts_at" in changes or "ends_at" in changes:
        _refuse_overlap(db, after["starts_at"], after["ends_at"], ignore_id=quarter.id)
    # 신청 기한 연장 (ui-improvements B): once a quarter is open or running,
    # its deadline only moves to a day that has not passed — a deadline in
    # the past with 신청 접수 중 on the badge tells members two different
    # things. Draft quarters are still being written and keep every date.
    extending = (
        "application_closes_at" in changes
        and changes["application_closes_at"] is not None
        and quarter.status in (QuarterStatus.APPLICATION_OPEN, QuarterStatus.ACTIVE)
    )
    if extending and changes["application_closes_at"] < date.today():
        raise HTTPException(
            status_code=400, detail="신청 마감일은 오늘이거나 그 뒤여야 합니다."
        )
    reopening = (
        quarter.status is QuarterStatus.ACTIVE
        and changes.get("status") is QuarterStatus.APPLICATION_OPEN
    )
    if reopening and after["application_closes_at"] is not None and after["application_closes_at"] < date.today():
        raise HTTPException(
            status_code=400,
            detail="신청 마감일이 이미 지났습니다. 신청을 다시 열려면 마감일을 함께 늦춰 주세요.",
        )
    before = {field: getattr(quarter, field) for field in changes}
    for field, value in changes.items():
        setattr(quarter, field, value)

    if extending:
        # Named in the log for what it was, so the admin who reads 분기
        # 수정 rows next month does not have to diff dates. "늦췄습니다"
        # only when the day really moved later; a deadline set where there
        # was none, or moved earlier by a direct call, is "바꿨습니다".
        closes = changes["application_closes_at"].isoformat()
        was = before["application_closes_at"]
        moved = "늦췄습니다" if was is not None and changes["application_closes_at"] > was else "바꿨습니다"
        summary = (
            f"{quarter.display_name} 분기의 신청을 다시 열고 마감일을 {closes}로 {moved}."
            if reopening
            else f"{quarter.display_name} 분기의 신청 마감일을 {closes}로 {moved}."
        )
    else:
        summary = f"{quarter.display_name} 분기를 수정했습니다."

    audit.record(
        db,
        actor=_,
        action=AuditAction.QUARTER_UPDATED,
        target_type="quarter",
        target_id=quarter.id,
        target_label=quarter.code,
        summary=summary,
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
    """Every application for one quarter, with the applicant and reviewer.

    Two joins to `users`: the applicant, and whoever reviewed it. The
    second is a LEFT join and aliased — an application that nobody has
    decided yet still has to appear, and it is the pending ones the
    screen is mainly about.
    """
    reviewer = aliased(User)

    rows = db.execute(
        select(QuarterApplication, User, reviewer)
        .join(User, User.id == QuarterApplication.user_id)
        .outerjoin(reviewer, reviewer.id == QuarterApplication.reviewed_by)
        .where(QuarterApplication.quarter_id == quarter_id)
        .order_by(QuarterApplication.id)
    ).all()

    return [
        ApplicationWithMember(
            **ApplicationRead.model_validate(application).model_dump(),
            # The stored username, not a guess from the email address.
            # Deriving it from the email showed "@test" for a member whose
            # username is "testmember2" — the same person with two
            # different handles depending on the screen.
            username=member.username,
            display_name=member.display_name,
            reviewed_by_username=reviewed_by.username if reviewed_by else "",
            reviewed_by_display_name=reviewed_by.display_name if reviewed_by else "",
        )
        for application, member, reviewed_by in rows
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
    # The quarter's amount, plus whatever adjustments this wallet already
    # carries (a re-approval must not wipe an admin's earlier +/−, which
    # are rows, never overwritten — cost-clarity).
    earlier = db.scalar(
        select(func.coalesce(func.sum(WalletAdjustment.amount_krw), 0)).where(
            WalletAdjustment.allocation_id == allocation.id
        )
    ) if allocation.id is not None else 0
    allocation.budget_krw = application.requested_budget_krw + int(earlier or 0)
    allocation.approved_at = approved_at
    allocation.approved_by = admin.id
    # Provider prices as they stood at approval. Kept so a member's quota
    # in tokens or generations stays consistent even if prices change.
    allocation.pricing_snapshot = {"captured_at": approved_at.isoformat()}

    db.add(allocation)
    db.flush()
    # 분기 마감's carry-over (cost-clarity): part of last quarter's unspent
    # wallet, if the closing admin chose to carry any, lands here once.
    carried = accounting.apply_carry_over(db, admin=admin, allocation=allocation)

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
            f"동아리 지원 {application.requested_budget_krw:,}원을 배정했습니다."
        ),
        detail={"budget_krw": application.requested_budget_krw, "carried_in_krw": carried},
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
    settings: Settings = Depends(get_settings),
) -> PersonalTopUp:
    """Manual deposit confirmation — no payment provider is involved.

    The balance only moves on confirmation, so a request alone never gives
    a member spendable money. In the beta nothing may be confirmed (no
    real money moves); rejecting stays possible.
    """
    if payload.confirm and not settings.top_ups_enabled:
        raise HTTPException(
            status_code=403, detail="지금은 개인 충전을 확인할 수 없습니다."
        )
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
        select(User, QuarterMembership, QuarterApplication.status)
        .outerjoin(
            QuarterMembership,
            (QuarterMembership.user_id == User.id)
            & (QuarterMembership.quarter_id == quarter_id),
        )
        .outerjoin(
            QuarterApplication,
            (QuarterApplication.user_id == User.id)
            & (QuarterApplication.quarter_id == quarter_id),
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
            application_status=application_status,
        )
        for member, membership, application_status in rows
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

    Setting `former` is a withdrawal, and goes through the same service as
    the member's own 회원 탈퇴 and Admin's 탈퇴 처리: the account closes,
    remaining 동아리 지원 is released, a personal balance puts a refund on
    hold, and the 30-day grace period starts. Published work is kept, the
    default. Without this, the oldest route to `former` would skip every
    rule the newer ones keep.

    A withdrawn account comes back through 복구, not through here — 복구 is
    what puts the released budget and the earlier participation back. Only
    an account made `former` before withdrawals were recorded, which has
    nothing to restore, is re-opened by this route as it always was.
    """
    quarter = db.get(Quarter, quarter_id)
    if quarter is None:
        raise HTTPException(status_code=404, detail="분기를 찾을 수 없습니다.")

    member = db.get(User, user_id)
    if member is None:
        raise HTTPException(status_code=404, detail="회원을 찾을 수 없습니다.")

    if payload.status is MembershipStatus.FORMER:
        if member.id == _.id:
            raise HTTPException(
                status_code=400,
                detail="자신은 여기서 탈퇴 처리할 수 없습니다. Profile에서 탈퇴해 주세요.",
            )
        try:
            withdrawal_service.withdraw(db, member=member, actor=_)
        except withdrawal_service.WithdrawalError as error:
            raise HTTPException(status_code=error.status_code, detail=error.message) from error
        # The service has already moved any row this member had. None is
        # written where there was none: a missing row means "not
        # participating", and a new `former` row would outlive a 복구.
        membership = membership_for(db, user_id, quarter_id)
    else:
        if (
            member.account_status is AccountStatus.FORMER
            and withdrawal_service.latest_withdrawal(db, member.id) is not None
        ):
            raise HTTPException(
                status_code=409,
                detail="탈퇴한 계정은 회원 상세의 '복구'로만 되돌릴 수 있습니다.",
            )
        membership = set_membership(db, user_id, quarter_id, payload.status)
        if member.account_status is AccountStatus.FORMER:
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
    if membership is not None:
        db.refresh(membership)

    return MemberWithMembership(
        user_id=member.id,
        username=member.username,
        display_name=member.display_name,
        role=member.role,
        account_status=member.account_status,
        membership_status=membership.status if membership else None,
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


@router.get(
    "/quarters/{quarter_id}/budget",
    response_model=QuarterBudgetRead,
    summary="Every member's wallet and the quarter's spend by provider",
)
def read_quarter_budget(
    quarter_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> QuarterBudgetRead:
    """Admin › Budget. Read-only: the per-provider totals are what the 팀장
    reads before buying the next round of credit from each provider."""
    quarter = db.get(Quarter, quarter_id)
    if quarter is None:
        raise HTTPException(status_code=404, detail="분기를 찾을 수 없습니다.")
    return quarter_budget_service.quarter_budget(db, quarter, settings)


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
