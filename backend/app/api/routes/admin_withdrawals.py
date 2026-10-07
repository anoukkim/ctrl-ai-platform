"""Admin: withdrawing a member, restoring one, and recording a refund.

The same service as the member's own 회원 탈퇴, so an admin-initiated
withdrawal follows the same rules — the same money released, the same
refund hold, the same 30-day grace period. What an admin does not need is
the member's password.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import User
from app.schemas.withdrawal import (
    AdminWithdrawRequest,
    RefundRecordRequest,
    WithdrawalPreviewRead,
    WithdrawalRead,
)
from app.services import withdrawal as withdrawal_service

router = APIRouter(prefix="/admin/members/{user_id}/withdrawal", tags=["admin"])


def _member(db: Session, user_id: int) -> User:
    member = db.get(User, user_id)
    if member is None:
        raise HTTPException(status_code=404, detail="회원을 찾을 수 없습니다.")
    return member


def _refuse(error: withdrawal_service.WithdrawalError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.message)


@router.get("", response_model=WithdrawalPreviewRead, summary="What withdrawing would do")
def preview_member_withdrawal(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> WithdrawalPreviewRead:
    return WithdrawalPreviewRead.of(withdrawal_service.preview(db, _member(db, user_id)))


@router.post("", response_model=WithdrawalRead, summary="Withdraw a member")
def withdraw_member(
    user_id: int,
    payload: AdminWithdrawRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WithdrawalRead:
    member = _member(db, user_id)
    if member.id == admin.id:
        # From here the admin would be signed out of the screen they are
        # using. Profile's 회원 탈퇴 is the way to leave yourself.
        raise HTTPException(
            status_code=400, detail="자신은 여기서 탈퇴 처리할 수 없습니다. Profile에서 탈퇴해 주세요."
        )
    try:
        row = withdrawal_service.withdraw(
            db, member=member, actor=admin, published_work=payload.published_work
        )
    except withdrawal_service.WithdrawalError as error:
        raise _refuse(error) from error
    db.commit()
    db.refresh(row)
    return WithdrawalRead.of(row)


@router.post("/restore", response_model=WithdrawalRead, summary="Restore a withdrawn member (복구)")
def restore_member(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WithdrawalRead:
    member = _member(db, user_id)
    try:
        row = withdrawal_service.restore(db, member=member, actor=admin)
    except withdrawal_service.WithdrawalError as error:
        raise _refuse(error) from error
    db.commit()
    db.refresh(row)
    return WithdrawalRead.of(row)


@router.post("/refund", response_model=WithdrawalRead, summary="Record the refund (환불 완료 기록)")
def record_member_refund(
    user_id: int,
    payload: RefundRecordRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WithdrawalRead:
    member = _member(db, user_id)
    try:
        row = withdrawal_service.record_refund(
            db, member=member, actor=admin, reference=payload.reference
        )
    except withdrawal_service.WithdrawalError as error:
        raise _refuse(error) from error
    db.commit()
    db.refresh(row)
    return WithdrawalRead.of(row)
