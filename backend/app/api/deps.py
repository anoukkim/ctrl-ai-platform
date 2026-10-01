"""Shared route dependencies.

`get_current_user` resolves the session cookie to a member. Every route
that touches member-owned data depends on it and scopes its queries by
the user it returns, so a member can only ever reach their own rows.

Authorization lives here and in the routes, never in the frontend. The
sidebar hiding the Admin link is a convenience; `require_admin` is the
thing that actually stops a member calling an admin endpoint.
"""

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import User, UserRole, UserSession

CREDENTIALS_REQUIRED = "로그인이 필요합니다."


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    """Return the signed-in member, or refuse the request with 401."""
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=CREDENTIALS_REQUIRED,
        )

    session_row = db.scalar(select(UserSession).where(UserSession.token == token))
    if session_row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=CREDENTIALS_REQUIRED,
        )

    # SQLite returns naive datetimes even for timezone-aware columns, so
    # the stored value is treated as UTC when it has no tzinfo.
    expires_at = session_row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at <= datetime.now(timezone.utc):
        # Clean up on the way past rather than leaving dead rows behind.
        db.delete(session_row)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 만료되었습니다. 다시 로그인해 주세요.",
        )

    user = db.get(User, session_row.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=CREDENTIALS_REQUIRED,
        )

    # Status is re-checked on every request, not only at sign-in, so
    # deactivating an account takes effect immediately on sessions that
    # are already open.
    if not user.can_sign_in:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="사용할 수 없는 계정입니다. 관리자에게 문의해 주세요.",
        )

    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Guard for admin-only routes.

    Authorization is checked on the backend, never by hiding a button.
    """
    if user.role is not UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자만 사용할 수 있습니다.",
        )
    return user
