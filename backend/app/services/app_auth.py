"""CTRL+AI 기능 상자 — signing in to a member app (app-platform P2).

The flow, end to end:

1. The app calls `ctrlai.login()`. The shell asks `/_ctrlai/v1/login/start`,
   which makes a `state`, keeps it in a short-lived cookie on the apps
   origin and answers the site's consent address.
2. The shell opens `ctrlai.my/apps/connect?app=<slug>&state=…` in a new
   window. Signed in there (or after signing in), the member sees the
   consent screen and presses 허용.
3. `POST /api/app-connect/<slug>` (the site, the member's own session)
   records the consent and makes a **one-time code** (60 s, single use)
   bound to the member, the app and the state; the window goes to
   `apps.ctrlai.my/<slug>/_ctrlai/callback?code=…&state=…`.
4. The callback checks the state against the browser's own state cookie,
   spends the code and sets the app-scoped cookie `ctrlai_app_<slug>`
   (HttpOnly, `SameSite=Strict`, Path `/_ctrlai/`, host-only). The window
   tells the shell and closes.

Nothing here touches the site's session: an app sign-in is its own row
(`AppSession`), checked only on the apps origin, and only for that app.
Codes, states and tokens are stored as SHA-256 hashes.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import (
    AccountStatus,
    AppConsent,
    AppLoginCode,
    AppSession,
    AuditAction,
    BuilderProject,
    User,
)
from app.services import audit

CODE_SECONDS = 60
STATE_SECONDS = 600
SESSION_DAYS = 30

#: What an app may be allowed, in the order the consent screen lists them.
SCOPES: dict[str, str] = {
    "profile": "내 표시 이름을 이 앱에 알려 줘요 (이메일·아이디·잔액은 알려 주지 않아요)",
    "ai": "이 앱에서 Claude를 써요 — 쓸 때마다 내 동아리 지원금에서 차감돼요",
}
#: What P2 asks for. P3 adds "data".
REQUESTED = ("profile", "ai")


def cookie_name(slug: str) -> str:
    return f"ctrlai_app_{slug}"


def state_cookie_name(slug: str) -> str:
    return f"ctrlai_app_state_{slug}"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def new_state() -> str:
    return secrets.token_urlsafe(24)


# ----------------------------------------------------------------- consent


def consent_of(db: Session, user: User, project: BuilderProject) -> AppConsent | None:
    """The member's consent for this app, revoked or not."""
    return db.scalar(
        select(AppConsent).where(AppConsent.user_id == user.id, AppConsent.project_id == project.id)
    )


def active_consent(db: Session, user_id: int, project_id: int) -> AppConsent | None:
    return db.scalar(
        select(AppConsent).where(
            AppConsent.user_id == user_id,
            AppConsent.project_id == project_id,
            AppConsent.revoked_at.is_(None),
        )
    )


def grant(db: Session, user: User, project: BuilderProject, scopes: tuple[str, ...] = REQUESTED) -> AppConsent:
    """허용: record (or renew) the consent. Audited when it is new or was revoked."""
    consent = consent_of(db, user, project)
    renewed = consent is None or consent.revoked_at is not None or set(consent.scopes) != set(scopes)
    if consent is None:
        consent = AppConsent(
            user_id=user.id,
            project_id=project.id,
            scopes=list(scopes),
            app_user_id="u_" + secrets.token_hex(10),
        )
        db.add(consent)
    else:
        consent.scopes = list(scopes)
        consent.revoked_at = None
        consent.granted_at = _now()
    db.flush()
    if renewed:
        audit.record(
            db,
            actor=user,
            action=AuditAction.APP_CONSENT_GRANTED,
            target_type="app",
            target_id=project.id,
            target_label=project.name,
            summary=f"{user.username}이(가) 앱 '{project.name}'을(를) 연결했습니다: " + ", ".join(scopes),
            detail={"scopes": list(scopes)},
        )
    return consent


def revoke(db: Session, user: User, consent: AppConsent) -> None:
    """연결 끊기: the consent is revoked and every sign-in to the app ends."""
    if consent.revoked_at is not None:
        return
    consent.revoked_at = _now()
    db.execute(
        update(AppSession)
        .where(
            AppSession.user_id == consent.user_id,
            AppSession.project_id == consent.project_id,
            AppSession.revoked_at.is_(None),
        )
        .values(revoked_at=_now())
    )
    project = db.get(BuilderProject, consent.project_id)
    name = project.name if project else f"#{consent.project_id}"
    audit.record(
        db,
        actor=user,
        action=AuditAction.APP_CONSENT_REVOKED,
        target_type="app",
        target_id=consent.project_id,
        target_label=name,
        summary=f"{user.username}이(가) 앱 '{name}'의 연결을 끊었습니다.",
        detail={},
    )


# -------------------------------------------------------------- the code


def issue_code(db: Session, user: User, project: BuilderProject, state: str) -> str:
    """A one-time code for the callback. 60 seconds, single use."""
    code = secrets.token_urlsafe(32)
    db.add(
        AppLoginCode(
            code_hash=digest(code),
            state_hash=digest(state),
            user_id=user.id,
            project_id=project.id,
            expires_at=_now() + timedelta(seconds=CODE_SECONDS),
        )
    )
    db.flush()
    return code


def exchange(db: Session, project: BuilderProject, code: str, state: str, state_cookie: str) -> str | None:
    """Spend a code; return a new app session token, or None.

    None when: the code is unknown, used, expired or for another app; the
    state does not match the one this browser started with; the member
    cannot sign in any more; or the consent was revoked meanwhile.
    """
    if not code or not state or not state_cookie or not secrets.compare_digest(state, state_cookie):
        return None
    row = db.scalar(select(AppLoginCode).where(AppLoginCode.code_hash == digest(code)).with_for_update())
    if row is None or row.project_id != project.id or row.used_at is not None:
        return None
    if _aware(row.expires_at) <= _now() or not secrets.compare_digest(row.state_hash, digest(state)):
        return None
    row.used_at = _now()
    user = db.get(User, row.user_id)
    if user is None or user.account_status is AccountStatus.FORMER:
        return None
    if active_consent(db, user.id, project.id) is None:
        return None
    token = secrets.token_urlsafe(32)
    db.add(
        AppSession(
            token_hash=digest(token),
            user_id=user.id,
            project_id=project.id,
            expires_at=_now() + timedelta(days=SESSION_DAYS),
        )
    )
    db.flush()
    return token


# ------------------------------------------------------------ who is calling


@dataclass(frozen=True)
class Visitor:
    user: User
    consent: AppConsent
    session: AppSession


def visitor(db: Session, project: BuilderProject, token: str | None) -> Visitor | None:
    """The signed-in member behind an app cookie, or None (signed out)."""
    if not token:
        return None
    session = db.scalar(select(AppSession).where(AppSession.token_hash == digest(token)))
    if session is None or session.project_id != project.id or session.revoked_at is not None:
        return None
    if _aware(session.expires_at) <= _now():
        return None
    user = db.get(User, session.user_id)
    if user is None or user.account_status is AccountStatus.FORMER:
        return None
    consent = active_consent(db, user.id, project.id)
    if consent is None:
        return None
    return Visitor(user=user, consent=consent, session=session)


def sign_out(db: Session, found: Visitor) -> None:
    found.session.revoked_at = _now()
    db.flush()


def profile(found: Visitor) -> dict:
    """What `ctrlai.user()` returns: a name and a per-app id, nothing else."""
    return {"displayName": found.user.display_name, "appUserId": found.consent.app_user_id}
