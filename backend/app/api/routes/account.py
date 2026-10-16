"""A member's own account: leaving CTRL+AI.

Behind `get_current_user`, not `require_active_member`. A member who sat
this quarter out still owns their account, and the way out of CTRL+AI must
not be locked behind participating in it.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.auth import as_current_user
from app.core.config import Settings, get_settings
from app.core.security import UNUSABLE_PASSWORD_HASH, verify_password
from app.db.session import get_db
from app.models import User
from app.schemas.auth import CurrentUser
from app.schemas.withdrawal import WithdrawalPreviewRead, WithdrawalRead, WithdrawRequest
from app.services import chat_models
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


# --------------------------------------------- profile (owner-polish 9)


class ProfileUpdate(BaseModel):
    #: The name other members see. The 아이디 (username) stays fixed: it
    #: is the sign-in name and the one stable handle on published work.
    display_name: str = Field(min_length=1, max_length=100)


@router.patch("/profile", response_model=CurrentUser, summary="Change my display name")
def update_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CurrentUser:
    """Profile › 계정 설정 › 이름 바꾸기. The same 1~100-character rule as
    the sign-up screens; spends nothing, so a member sitting out the
    quarter may still fix their name. Published apps read the owner's
    display_name live, so they pick the new name up at once."""
    display_name = payload.display_name.strip()
    if not display_name or len(display_name) > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="이름을 1~100자로 적어 주세요.")
    user.display_name = display_name
    db.commit()
    return as_current_user(user)


# --------------------------------------------- preferences (spend feedback)


class PreferencesRead(BaseModel):
    #: Profile › 알림 › 사용 알림 표시 (feat-spend-feedback): the toast,
    #: the floating "-N원" and the milestone cards after a charge.
    spend_notifications: bool
    #: Profile › 기본 모델 (quality-tuning Q1): what a new conversation and
    #: a new Builder project start with. None: the catalogue default · 보통.
    default_chat_model_id: int | None = None
    default_depth: str | None = None


class PreferencesUpdate(BaseModel):
    """Each field optional; at least one."""

    spend_notifications: bool | None = None
    default_chat_model_id: int | None = None
    #: A level name only (the server decides every number).
    default_depth: Literal["low", "medium", "high", "max"] | None = None


def _preferences(user: User) -> PreferencesRead:
    return PreferencesRead(
        spend_notifications=user.spend_notifications,
        default_chat_model_id=user.default_chat_model_id,
        default_depth=user.default_depth,
    )


@router.get("/preferences", response_model=PreferencesRead, summary="My settings")
def read_preferences(user: User = Depends(get_current_user)) -> PreferencesRead:
    return _preferences(user)


@router.patch("/preferences", response_model=PreferencesRead, summary="Change my notification settings")
def update_preferences(
    payload: PreferencesUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PreferencesRead:
    """Spends nothing and is the member's own screen, so it stays open to
    a member who is not participating this quarter. A default model must be
    one this member may use."""
    if payload.spend_notifications is None and payload.default_chat_model_id is None and payload.default_depth is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="바꿀 내용을 보내 주세요.")
    if payload.spend_notifications is not None:
        user.spend_notifications = payload.spend_notifications
    if payload.default_chat_model_id is not None:
        try:
            user.default_chat_model_id = chat_models.checked_choice(db, user, payload.default_chat_model_id).id
        except chat_models.ModelChoiceError as error:
            raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    if payload.default_depth is not None:
        user.default_depth = payload.default_depth
    db.commit()
    return _preferences(user)
