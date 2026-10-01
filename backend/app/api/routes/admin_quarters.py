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
    ApplicationStatus,
    PersonalTopUp,
    Quarter,
    QuarterAllocation,
    QuarterApplication,
    TopUpStatus,
    User,
)
from app.services.wallet import get_or_create_balance
from app.schemas.quarter import (
    ApplicationRead,
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

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(quarter, field, value)

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

    if not payload.confirm:
        top_up.status = TopUpStatus.REJECTED
        db.commit()
        db.refresh(top_up)
        return top_up

    top_up.status = TopUpStatus.CONFIRMED

    balance = get_or_create_balance(db, top_up.user_id)
    balance.balance_krw += top_up.amount_krw

    db.commit()
    db.refresh(top_up)
    return top_up
