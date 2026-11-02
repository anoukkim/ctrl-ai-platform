"""Sign-in and sign-out.

Sign-up is not here: since signup-google-first (2026-11-03) an account is
made only on the Google setup screen (`google_auth.py`), where the member
also chooses a password — so everyone leaves sign-up with both ways in.

The session cookie is set here and nowhere else. It is `HttpOnly`, so no
JavaScript on the page can read it — which is the point of proxying
`/api/*` through Next.js: the browser treats frontend and backend as one
origin, so the cookie is simply sent, with no CORS credentials dance and
no token sitting in `localStorage` for a script to steal.

Error messages are Korean, because members read them.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.core.security import UNUSABLE_PASSWORD_HASH, new_session_token, verify_password
from app.db.session import get_db
from app.models import ConnectedAccount, User, UserRole, UserSession
from app.schemas.auth import CurrentUser, LoginRequest
from app.services import rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])


def has_google(db: Session, user_id: int) -> bool:
    """Whether a Google account is linked (by `sub`, in `connected_accounts`)."""
    return (
        db.scalar(
            select(ConnectedAccount.id).where(
                ConnectedAccount.user_id == user_id, ConnectedAccount.provider == "google"
            )
        )
        is not None
    )


def as_current_user(user: User, db: Session) -> CurrentUser:
    """The signed-in member as every account route answers them."""
    return CurrentUser(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        account_status=user.account_status,
        is_admin=user.role is UserRole.ADMIN,
        has_password=user.password_hash != UNUSABLE_PASSWORD_HASH,
        has_google=has_google(db, user.id),
        spend_notifications=user.spend_notifications,
    )


def _start_session(db: Session, response: Response, user: User, settings: Settings) -> None:
    """Create a session row and attach its cookie to the response."""
    token = new_session_token()
    db.add(
        UserSession(
            token=token,
            user_id=user.id,
            expires_at=datetime.now(timezone.utc)
            + timedelta(seconds=settings.session_max_age_seconds),
        )
    )
    db.commit()

    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_max_age_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        # None (the default) is a host-only cookie: the main domain only.
        domain=settings.cookie_domain,
        # The cookie is scoped to the whole site because Next.js proxies
        # /api/* on the same origin.
        path="/",
    )


#: privacy-and-terms: shown when the consent box was not ticked on the
#: Google setup screen (`google_auth.py`).
TERMS_REQUIRED = "개인정보 처리방침과 이용약관에 동의해야 가입할 수 있습니다."


@router.post("/login", response_model=CurrentUser, summary="Sign in")
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    # Limited per address and per username. Every member may sign in by
    # password as well as with Google (member-password-login, 2026-10-14).
    address = rate_limit.client_address(request, settings)
    if rate_limit.login_blocked(db, address, payload.username, settings):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.",
        )

    user = db.scalar(select(User).where(User.username == payload.username))

    # One message for "no such account" and for "wrong password", so the
    # endpoint cannot be used to discover which usernames exist.
    if user is None or not verify_password(payload.password, user.password_hash):
        rate_limit.record_login_failure(db, address, payload.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다.",
        )

    if not user.can_sign_in:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="사용할 수 없는 계정입니다. 관리자에게 문의해 주세요.",
        )

    _start_session(db, response, user, settings)
    return as_current_user(user, db)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Sign out")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    """Delete the session row and clear the cookie.

    Deliberately does not require a valid session: signing out when
    already signed out should succeed quietly rather than fail. Because
    the session is a row, deleting it ends the session everywhere
    immediately — the cookie alone proves nothing once the row is gone.
    """
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        session_row = db.scalar(select(UserSession).where(UserSession.token == token))
        if session_row is not None:
            db.delete(session_row)
            db.commit()

    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )


@router.get("/me", response_model=CurrentUser, summary="Who am I")
def me(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> CurrentUser:
    return as_current_user(user, db)
