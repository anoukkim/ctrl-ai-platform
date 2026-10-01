"""Shared route dependencies.

The important one is `get_current_user`. Authentication does not exist
yet, so it resolves the seeded development user — but every route that
touches member-owned data already goes through it and scopes its queries
by the returned user. When real sign-in arrives, this one function is
what changes; no route has to be rewritten.
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import User, UserRole

DEV_USER_EMAIL = "dev@ctrl.ai"


def get_current_user(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    """Return the member making the request.

    Phase 1 stand-in: the development user. It refuses to work outside a
    development environment, so this can never silently become the way a
    deployed instance authenticates.
    """
    if not settings.is_development:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Authentication is not implemented yet.",
        )

    user = db.scalar(select(User).where(User.email == DEV_USER_EMAIL))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Development user is missing. Run `python -m app.db.init_db`.",
        )
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Guard for admin-only routes.

    Authorization is checked on the backend, never by hiding a button.
    """
    if user.role is not UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access is required.",
        )
    return user
