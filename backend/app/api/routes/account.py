"""A member's own account: leaving CTRL+AI.

Behind `get_current_user`, not `require_active_member`. A member who sat
this quarter out still owns their account, and the way out of CTRL+AI must
not be locked behind participating in it.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.core.security import UNUSABLE_PASSWORD_HASH, verify_password
from app.db.session import get_db
from app.models import User
from app.schemas.withdrawal import WithdrawalPreviewRead, WithdrawalRead, WithdrawRequest
from app.services import rate_limit
from app.services import withdrawal as withdrawal_service

router = APIRouter(prefix="/account", tags=["account"])


@router.get(
    "/withdrawal",
    response_model=WithdrawalPreviewRead,
    summary="What withdrawing would do",
)
def preview_withdrawal(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WithdrawalPreviewRead:
    return WithdrawalPreviewRead.of(withdrawal_service.preview(db, user))


@router.post(
    "/withdrawal",
    response_model=WithdrawalRead,
    summary="Withdraw from CTRL+AI (회원 탈퇴)",
)
def withdraw(
    payload: WithdrawRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(get_current_user),
) -> WithdrawalRead:
    """Close the member's own account.

    The password is asked for again even though the member is signed in:
    a browser left open is not the same as the member deciding to leave.
    """
    if user.password_hash == UNUSABLE_PASSWORD_HASH:
        # An account made with Google has no password (google-login); typing
        # the username out is the deliberate step instead.
        if payload.confirm_username.strip() != user.username:
            raise HTTPException(status_code=400, detail="아이디를 정확히 입력해 주세요.")
    else:
        # Counted like the sign-in form (member-password-login): a stolen
        # session must not be a quiet place to guess the password.
        address = rate_limit.client_address(request, settings)
        if rate_limit.login_blocked(db, address, user.username, settings):
            raise HTTPException(
                status_code=429,
                detail="비밀번호를 너무 여러 번 틀렸습니다. 15분 뒤에 다시 시도해 주세요.",
            )
        if not verify_password(payload.password, user.password_hash):
            rate_limit.record_login_failure(db, address, user.username)
            raise HTTPException(status_code=400, detail="비밀번호가 올바르지 않습니다.")

    try:
        row = withdrawal_service.withdraw(
            db, member=user, actor=user, published_work=payload.published_work
        )
    except withdrawal_service.WithdrawalError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error

    db.commit()
    db.refresh(row)

    # The session row is already gone; this clears the browser's copy.
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )
    return WithdrawalRead.of(row)
