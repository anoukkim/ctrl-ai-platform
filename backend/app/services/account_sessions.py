"""Every way an account is signed in, ended at once (admin-consolidation v3 (4)).

A password reset is often "this account may be in someone else's hands".
Ending only the site sessions (`user_sessions`) is not enough: a member
app's own session (`app_sessions`, 30 days, `ctrlai_app_<slug>`) can still
spend the member's wallet through 앱 AI, and an unused app login code or
a Google link that was started can still turn into one. All of them go
here, in the caller's transaction.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from app.models import AppLoginCode, AppSession, LoginAttempt, OAuthState, User, UserSession


@dataclass
class Ended:
    site: int
    apps: int

    @property
    def total(self) -> int:
        return self.site + self.apps


def end_everywhere(db: Session, user: User) -> Ended:
    """Sign `user` out of the site and every member app, drop their pending
    app login codes and Google flows, and lift their sign-in lockout.
    Does not commit."""
    now = datetime.now(timezone.utc)
    site = db.execute(
        delete(UserSession).where(UserSession.user_id == user.id).execution_options(synchronize_session=False)
    ).rowcount or 0
    apps = db.execute(
        update(AppSession)
        .where(AppSession.user_id == user.id, AppSession.revoked_at.is_(None))
        .values(revoked_at=now)
        .execution_options(synchronize_session=False)
    ).rowcount or 0
    db.execute(
        delete(AppLoginCode)
        .where(AppLoginCode.user_id == user.id, AppLoginCode.used_at.is_(None))
        .execution_options(synchronize_session=False)
    )
    db.execute(delete(OAuthState).where(OAuthState.user_id == user.id).execution_options(synchronize_session=False))
    db.execute(
        delete(LoginAttempt)
        .where(LoginAttempt.username == user.username.lower())
        .execution_options(synchronize_session=False)
    )
    return Ended(site=site, apps=apps)
