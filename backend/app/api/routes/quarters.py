"""Member-facing quarter, application and wallet routes.

Credits are not automatic: a member applies for a quarter, chooses how to
split the budget between Build and Video, and an admin approves. Only then
does an allocation exist.
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import (
    ApplicationStatus,
    PersonalBalance,
    PersonalTopUp,
    Quarter,
    QuarterAllocation,
    QuarterApplication,
    QuarterStatus,
    TopUpStatus,
    User,
)
from app.schemas.quarter import (
    ApplicationCreate,
    ApplicationRead,
    MyQuarterStatus,
    PersonalBalanceRead,
    PersonalBalanceUpdate,
    QuarterRead,
    TopUpCreate,
    TopUpRead,
)
from app.services.budget import InvalidSplitError, split_budget
from app.services.wallet import get_or_create_balance


router = APIRouter(prefix="/quarters", tags=["quarters"])

#: Application states that block a second application for the same quarter.
LIVE_APPLICATION_STATES = {ApplicationStatus.SUBMITTED, ApplicationStatus.APPROVED}


def _wallet(db: Session, user: User) -> PersonalBalance:
    """The member's wallet, committed so a first read persists it."""
    balance = get_or_create_balance(db, user.id)
    db.commit()
    db.refresh(balance)
    return balance



def current_quarter(db: Session) -> Quarter | None:
    """The quarter members are currently dealing with.

    An open application window wins over an active quarter: when
    applications for the next quarter open, that is what Profile should
    be inviting people to do.
    """
    open_now = db.scalar(
        select(Quarter)
        .where(Quarter.status == QuarterStatus.APPLICATION_OPEN)
        .order_by(Quarter.starts_at)
    )
    if open_now is not None:
        return open_now

    return db.scalar(
        select(Quarter).where(Quarter.status == QuarterStatus.ACTIVE).order_by(Quarter.starts_at)
    )


def _describe_participation(
    quarter: Quarter | None,
    application: QuarterApplication | None,
    allocation: QuarterAllocation | None,
) -> str:
    if quarter is None:
        return "미참여"
    if allocation is not None:
        return "활동 회원"
    if application is None:
        return "신청 가능" if quarter.is_accepting_applications else "미참여"
    if application.status is ApplicationStatus.SUBMITTED:
        return "승인 대기"
    if application.status is ApplicationStatus.REJECTED:
        return "신청 거절"
    return "신청 가능" if quarter.is_accepting_applications else "미참여"


@router.get("/current", response_model=QuarterRead | None, summary="The current quarter")
def read_current_quarter(db: Session = Depends(get_db)) -> Quarter | None:
    return current_quarter(db)


@router.get("/me", response_model=MyQuarterStatus, summary="My standing this quarter")
def read_my_quarter(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MyQuarterStatus:
    quarter = current_quarter(db)
    application = allocation = None

    if quarter is not None:
        application = db.scalar(
            select(QuarterApplication).where(
                QuarterApplication.user_id == user.id,
                QuarterApplication.quarter_id == quarter.id,
            )
        )
        allocation = db.scalar(
            select(QuarterAllocation).where(
                QuarterAllocation.user_id == user.id,
                QuarterAllocation.quarter_id == quarter.id,
            )
        )

    days_remaining = None
    if quarter is not None:
        days_remaining = max(0, (quarter.ends_at - date.today()).days)

    return MyQuarterStatus(
        quarter=QuarterRead.model_validate(quarter) if quarter else None,
        application=ApplicationRead.model_validate(application) if application else None,
        allocation=allocation,  # type: ignore[arg-type]
        personal=_wallet(db, user),  # type: ignore[arg-type]
        participation=_describe_participation(quarter, application, allocation),
        days_remaining=days_remaining,
    )


@router.post(
    "/{quarter_id}/apply",
    response_model=ApplicationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Apply to take part in a quarter",
)
def apply_for_quarter(
    quarter_id: int,
    payload: ApplicationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> QuarterApplication:
    quarter = db.get(Quarter, quarter_id)
    if quarter is None:
        raise HTTPException(status_code=404, detail="분기를 찾을 수 없습니다.")

    if not quarter.is_accepting_applications:
        raise HTTPException(status_code=400, detail="지금은 신청 기간이 아닙니다.")

    existing = db.scalar(
        select(QuarterApplication).where(
            QuarterApplication.user_id == user.id,
            QuarterApplication.quarter_id == quarter.id,
        )
    )
    if existing is not None and existing.status in LIVE_APPLICATION_STATES:
        raise HTTPException(status_code=409, detail="이미 신청한 분기입니다.")

    # The split rule lives in one place; the amounts are derived from the
    # quarter's limit rather than trusted from the client.
    try:
        budget = split_budget(
            payload.build_percentage, payload.video_percentage, quarter.subsidy_limit_krw
        )
    except InvalidSplitError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    application = existing or QuarterApplication(user_id=user.id, quarter_id=quarter.id)
    application.build_percentage = budget.build_percentage
    application.video_percentage = budget.video_percentage
    application.requested_total_budget_krw = budget.total_budget_krw
    application.requested_build_budget_krw = budget.build_budget_krw
    application.requested_video_budget_krw = budget.video_budget_krw
    application.status = ApplicationStatus.SUBMITTED
    application.submitted_at = datetime.now(timezone.utc)
    application.reviewed_at = None
    application.reviewed_by = None

    db.add(application)
    db.commit()
    db.refresh(application)
    return application


@router.post(
    "/applications/{application_id}/cancel",
    response_model=ApplicationRead,
    summary="Cancel my application",
)
def cancel_application(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> QuarterApplication:
    application = db.scalar(
        select(QuarterApplication).where(
            QuarterApplication.id == application_id,
            QuarterApplication.user_id == user.id,
        )
    )
    if application is None:
        raise HTTPException(status_code=404, detail="신청을 찾을 수 없습니다.")
    if application.status is not ApplicationStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="심사 중인 신청만 취소할 수 있습니다.")

    application.status = ApplicationStatus.CANCELLED
    db.commit()
    db.refresh(application)
    return application


# ---------------------------------------------------------------------
# Personal money
# ---------------------------------------------------------------------


@router.get("/me/wallet", response_model=PersonalBalanceRead, summary="My personal balance")
def read_wallet(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PersonalBalance:
    return _wallet(db, user)


@router.patch(
    "/me/wallet",
    response_model=PersonalBalanceRead,
    summary="Turn personal spending on or off",
)
def update_wallet(
    payload: PersonalBalanceUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PersonalBalance:
    """Personal money is never spent unless the member opts in here."""
    balance = _wallet(db, user)
    balance.overage_enabled = payload.overage_enabled
    db.commit()
    db.refresh(balance)
    return balance


@router.post(
    "/me/top-ups",
    response_model=TopUpRead,
    status_code=status.HTTP_201_CREATED,
    summary="Request a personal top-up",
)
def request_top_up(
    payload: TopUpCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PersonalTopUp:
    """Records the request only.

    No payment provider is called. An admin confirms the deposit, and only
    then does the balance move.
    """
    top_up = PersonalTopUp(
        user_id=user.id,
        amount_krw=payload.amount_krw,
        status=TopUpStatus.REQUESTED,
        requested_at=datetime.now(timezone.utc),
    )
    db.add(top_up)
    db.commit()
    db.refresh(top_up)
    return top_up


@router.get("/me/top-ups", response_model=list[TopUpRead], summary="My top-up requests")
def list_my_top_ups(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[PersonalTopUp]:
    return list(
        db.scalars(
            select(PersonalTopUp)
            .where(PersonalTopUp.user_id == user.id)
            .order_by(PersonalTopUp.id.desc())
        )
    )
