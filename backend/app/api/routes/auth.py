"""Registration, sign-in and sign-out.

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
from app.core.security import hash_password, new_session_token, verify_password
from app.db.session import get_db
from app.models import AccountStatus, User, UserRole, UserSession
from app.schemas.auth import CurrentUser, LoginRequest, RegisterRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def _as_current_user(user: User) -> CurrentUser:
    return CurrentUser(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        account_status=user.account_status,
        is_admin=user.role is UserRole.ADMIN,
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
        # The cookie is scoped to the whole site because Next.js proxies
        # /api/* on the same origin.
        path="/",
    )


@router.post(
    "/register",
    response_model=CurrentUser,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account and sign in",
)
def register(
    payload: RegisterRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    taken = db.scalar(
        select(User).where((User.username == payload.username) | (User.email == payload.email))
    )
    if taken is not None:
        # Which field collided is safe to say: both are visible to anyone
        # who tries to register, and a vague message only frustrates.
        field = "아이디" if taken.username == payload.username else "이메일"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"이미 사용 중인 {field}입니다.",
        )

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        role=UserRole.MEMBER,
        account_status=AccountStatus.ACTIVE,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    _start_session(db, response, user, settings)
    return _as_current_user(user)


@router.post("/login", response_model=CurrentUser, summary="Sign in")
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    user = db.scalar(select(User).where(User.username == payload.username))

    # One message for "no such account" and for "wrong password", so the
    # endpoint cannot be used to discover which usernames exist.
    if user is None or not verify_password(payload.password, user.password_hash):
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
    return _as_current_user(user)


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
        path="/",
    )


@router.get("/me", response_model=CurrentUser, summary="Who am I")
def me(user: User = Depends(get_current_user)) -> CurrentUser:
    return _as_current_user(user)
