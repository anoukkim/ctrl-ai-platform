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
from app.models import MembershipStatus, User, UserRole, UserSession
from app.services.quarters import current_quarter, membership_for

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


# What an inactive member is told. Deliberately explains the state and the
# way out rather than just refusing.
NOT_PARTICIPATING = (
    "이번 분기에 참여하고 있지 않아 새로 만들 수 없습니다. "
    "지금까지 만든 작업물은 그대로 볼 수 있습니다."
)


def require_active_member(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Guard for paid creation and budget-spending routes.

    Signing in is not enough. A member must be **participating in the
    current quarter**, which means an active `QuarterMembership` row.

    This is deliberately narrower than `get_current_user`: an inactive
    member keeps their account, their projects and their published work,
    and can still read all of it. What they lose is the ability to start
    new work that costs the community money.

    A missing membership row means "not participating" — there is no need
    to write an inactive row for everyone who did not apply.
    """
    quarter = current_quarter(db)
    if quarter is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="지금은 진행 중인 분기가 없습니다.",
        )

    membership = membership_for(db, user.id, quarter.id)

    if membership is None or membership.status is not MembershipStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=NOT_PARTICIPATING,
        )

    return user
