"""Profile › 로그인 방법 — a member's ways into their own account.

member-password-login (owner, 2026-10-14): every member may sign in with
Google, with username and password, or both. Here a Google member sets a
password, a password member changes theirs, and either removes one of the
two — **only while the other remains**, so nobody locks themselves out.
Linking Google stays in `google_auth.py` (by `sub`, never by email).

Every change that touches the password asks for the current one when
there is one, and those checks count towards the same database-backed
limit as the sign-in form: the profile must not be a quieter place to
guess a password from a browser left open.

The "is another method left" check runs with the member's row locked
(`SELECT … FOR UPDATE`), so a password removal and a Google unlink sent at
the same moment cannot both pass. Removing the password also needs Google
sign-in to be *switched on* on this server — a linked Google account is no
way in while Google sign-in is off.

**Adding a way in needs a recent sign-in.** A first password (a Google
member has no password to ask for) and linking Google are refused when
this browser signed in more than `RECENT_SIGN_IN` ago: a browser left open
must not be enough to give someone a lasting way into the account.

Every change signs out the member's other browsers and keeps this one —
whoever knew the old method should not stay in.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.core.security import (
    MIN_PASSWORD_LENGTH,
    UNUSABLE_PASSWORD_HASH,
    hash_password,
    verify_password,
)
from app.db.session import get_db
from app.models import User, UserSession
from app.models.audit import AuditAction
from app.models.connected_account import ConnectedAccount
from app.services import audit, rate_limit
from app.services.google_login import get_google_login

router = APIRouter(prefix="/account", tags=["account"])

WRONG_PASSWORD = "현재 비밀번호가 올바르지 않습니다."
TOO_MANY = "비밀번호를 너무 여러 번 틀렸습니다. 15분 뒤에 다시 시도해 주세요."
LAST_METHOD = "로그인 방법이 하나만 남아 있어 없앨 수 없습니다. 다른 방법을 먼저 추가해 주세요."
GOOGLE_OFF = "지금은 이 서버에서 Google 로그인이 꺼져 있어 비밀번호를 없앨 수 없습니다."
SIGN_IN_AGAIN = "보안을 위해 로그아웃한 뒤 다시 로그인하고 해 주세요. 로그인한 지 10분이 지났어요."
ALREADY_SET = "이미 비밀번호가 있습니다. 화면을 새로 고친 뒤 바꾸기를 써 주세요."

#: How recent a sign-in must be to add a way into the account.
RECENT_SIGN_IN = timedelta(minutes=10)


class GoogleMethod(BaseModel):
    #: Google sign-in is switched on on this server.
    available: bool
    linked: bool
    email: str


class SignInMethods(BaseModel):
    password: bool
    google: GoogleMethod


class SetPasswordRequest(BaseModel):
    #: Required when the account already has a password; ignored otherwise.
    current_password: str = Field(default="", max_length=128)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)


class ConfirmPasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)


def _has_password(user: User) -> bool:
    return bool(user.password_hash) and user.password_hash != UNUSABLE_PASSWORD_HASH


def _google_account(db: Session, user_id: int) -> ConnectedAccount | None:
    return db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.user_id == user_id, ConnectedAccount.provider == "google"
        )
    )


def _methods(db: Session, user: User, settings: Settings) -> SignInMethods:
    account = _google_account(db, user.id)
    return SignInMethods(
        password=_has_password(user),
        google=GoogleMethod(
            available=get_google_login(settings) is not None,
            linked=account is not None,
            email=account.email if account is not None else "",
        ),
    )


def check_current_password(
    db: Session, request: Request, user: User, given: str, settings: Settings
) -> None:
    """The current password, under the sign-in form's attempt limit."""
    address = rate_limit.client_address(request, settings)
    if rate_limit.login_blocked(db, address, user.username, settings):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=TOO_MANY)
    if not verify_password(given, user.password_hash):
        rate_limit.record_login_failure(db, address, user.username)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=WRONG_PASSWORD)


def _session_token(request: Request, settings: Settings) -> str:
    return request.cookies.get(settings.session_cookie_name, "")


def signed_in_recently(db: Session, request: Request, settings: Settings) -> bool:
    """This browser's session began less than `RECENT_SIGN_IN` ago."""
    row = db.scalar(select(UserSession).where(UserSession.token == _session_token(request, settings)))
    if row is None:
        return False
    created = row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - created <= RECENT_SIGN_IN


def end_other_sessions(db: Session, user_id: int, keep_token: str) -> None:
    """Sign the member out everywhere but this browser. Does not commit."""
    db.execute(
        delete(UserSession)
        .where(UserSession.user_id == user_id, UserSession.token != keep_token)
        .execution_options(synchronize_session=False)
    )


def _locked(db: Session, user: User) -> User:
    """The member's row, locked until this request commits."""
    row = db.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update()
        # Re-read the columns: another request may have changed them while
        # this one waited for the lock.
        .execution_options(populate_existing=True)
    )
    if row is None:  # pragma: no cover — get_current_user just loaded it
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="계정을 찾을 수 없습니다.")
    return row


def drop_password(db: Session, user: User, settings: Settings, keep_token: str = "") -> User:
    """Remove the password, if Google is still linked and switched on —
    under the row lock. Signs out other browsers. Commits.

    Kept apart from the route so the lock can be tested with two real
    connections at once.
    """
    if get_google_login(settings) is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=GOOGLE_OFF)
    member = _locked(db, user)
    if not _has_password(member):
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="비밀번호가 설정되어 있지 않습니다.")
    if _google_account(db, member.id) is None:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=LAST_METHOD)
    member.password_hash = UNUSABLE_PASSWORD_HASH
    end_other_sessions(db, member.id, keep_token)
    audit.record(
        db,
        actor=member,
        action=AuditAction.PASSWORD_REMOVED,
        target_type="user",
        target_id=member.id,
        target_label=member.username,
        summary=f"{member.username} 계정의 비밀번호 로그인을 없앴습니다.",
    )
    db.commit()
    return member


def drop_google(db: Session, user: User, keep_token: str = "") -> User:
    """Unlink Google, if a password remains — under the row lock. Signs out
    other browsers. Commits."""
    member = _locked(db, user)
    account = _google_account(db, member.id)
    if not _has_password(member):
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=LAST_METHOD)
    if account is not None:
        db.delete(account)
        end_other_sessions(db, member.id, keep_token)
        audit.record(
            db,
            actor=member,
            action=AuditAction.GOOGLE_UNLINKED,
            target_type="user",
            target_id=member.id,
            target_label=member.username,
            summary=f"{member.username} 계정의 Google 로그인 연결을 끊었습니다.",
        )
    db.commit()
    return member


@router.get("/sign-in", response_model=SignInMethods, summary="How I can sign in")
def read_sign_in_methods(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SignInMethods:
    return _methods(db, user, settings)


@router.put("/password", response_model=SignInMethods, summary="Set or change my password")
def set_password(
    payload: SetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SignInMethods:
    """A Google member's first password, or a change of an existing one.

    Other signed-in browsers are signed out: whoever knew the old
    password — or sat at a browser left open — should not stay in.
    """
    had_password = _has_password(user)
    if had_password:
        check_current_password(db, request, user, payload.current_password, settings)
    elif not signed_in_recently(db, request, settings):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=SIGN_IN_AGAIN)

    member = _locked(db, user)
    if _has_password(member) and not had_password:
        # Another request set a first password while this one waited: a
        # change now needs that password.
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=ALREADY_SET)
    member.password_hash = hash_password(payload.new_password)
    end_other_sessions(db, member.id, _session_token(request, settings))
    audit.record(
        db,
        actor=member,
        action=AuditAction.PASSWORD_CHANGED if had_password else AuditAction.PASSWORD_SET,
        target_type="user",
        target_id=member.id,
        target_label=member.username,
        summary=(
            f"{member.username} 계정의 비밀번호를 바꿨습니다."
            if had_password
            else f"{member.username} 계정에 비밀번호 로그인을 추가했습니다."
        ),
    )
    db.commit()
    db.refresh(member)
    return _methods(db, member, settings)


@router.post("/password/remove", response_model=SignInMethods, summary="Stop signing in by password")
def remove_password(
    payload: ConfirmPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SignInMethods:
    if not _has_password(user):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="비밀번호가 설정되어 있지 않습니다.")
    if get_google_login(settings) is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=GOOGLE_OFF)
    check_current_password(db, request, user, payload.current_password, settings)

    member = drop_password(db, user, settings, _session_token(request, settings))
    db.refresh(member)
    return _methods(db, member, settings)


@router.post("/google/unlink", response_model=SignInMethods, summary="Stop signing in with Google")
def unlink_google(
    payload: ConfirmPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SignInMethods:
    """Allowed only with a password left — and that password is asked for,
    which proves the member can still get in once Google is gone."""
    if _google_account(db, user.id) is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="연결된 Google 계정이 없습니다.")
    if not _has_password(user):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=LAST_METHOD)
    check_current_password(db, request, user, payload.current_password, settings)

    member = drop_google(db, user, _session_token(request, settings))
    db.refresh(member)
    return _methods(db, member, settings)
