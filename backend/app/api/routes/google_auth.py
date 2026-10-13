"""Google로 계속하기 — signing in, signing up and linking with Google.

google-login (owner decision 2026-10-13: Google is the main way in). The
backend does the whole exchange; the browser only ever follows redirects
and receives the same HttpOnly session cookie as a password sign-in.

The flow:

1. `GET /api/auth/google/start` (or `/api/account/google/link/start` for a
   signed-in member) makes a single-use `OAuthState` — the `state` value
   and a PKCE verifier — puts `state` in an HttpOnly cookie, and redirects
   to Google (or, in development, the mock's stand-in page).
2. Google sends the browser back to `GET /api/auth/google/callback`. The
   `state` must match the cookie *and* an unexpired row, which is deleted
   on first use; the code is exchanged with the verifier.
3. The identity is matched **by Google's `sub` only** — never by email:
   * a linked account signs in;
   * a link request attaches the `sub` to the member who asked;
   * an unknown `sub` becomes a `PendingGoogleSignup`, and the member
     finishes on the setup screen (username, display name, invite code).

Accounts made this way have no usable password. Username and password
remain only as the administrator's emergency sign-in.
"""

from __future__ import annotations

import html
import logging
import re
import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.auth import _as_current_user, _start_session
from app.core.config import Settings, get_settings
from app.core.security import UNUSABLE_PASSWORD_HASH
from app.db.session import get_db
from app.models import (
    AccountStatus,
    AuditAction,
    ConnectedAccount,
    OAuthState,
    PendingGoogleSignup,
    User,
    UserRole,
)
from app.schemas.auth import CurrentUser
from app.services import audit, invites, rate_limit
from app.services.google_login import (
    MOCK_CONSENT_PATH,
    SIGN_IN_SCOPES,
    GoogleIdentity,
    GoogleLoginError,
    MockGoogleLogin,
    challenge,
    get_google_login,
    new_verifier,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])

STATE_COOKIE = "ctrlai_oauth_state"
SIGNUP_COOKIE = "ctrlai_google_signup"
STATE_LIFETIME = timedelta(minutes=10)
PENDING_LIFETIME = timedelta(minutes=30)

#: The username rule the password sign-up uses (schemas/auth.py).
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,50}$")


def _provider_or_404(settings: Settings):
    provider = get_google_login(settings)
    if provider is None:
        # Same answer as an unknown path: where Google sign-in is not
        # offered, these routes do not appear to exist.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return provider


def _cookie(response: Response, settings: Settings, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        key=name,
        value=value,
        max_age=max_age,
        httponly=True,
        secure=settings.session_cookie_secure,
        # Lax: sent when Google sends the browser back with a top-level GET.
        samesite="lax",
        domain=settings.cookie_domain,
        path="/api/auth/google",
    )


def _clear(response: Response, settings: Settings, name: str) -> None:
    response.delete_cookie(
        key=name,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        domain=settings.cookie_domain,
        path="/api/auth/google",
    )


def _begin(db: Session, settings: Settings, purpose: str, user_id: int | None) -> RedirectResponse:
    provider = _provider_or_404(settings)
    now = datetime.now(timezone.utc)
    db.execute(delete(OAuthState).where(OAuthState.created_at < now - STATE_LIFETIME))
    state = secrets.token_urlsafe(32)
    verifier = new_verifier()
    db.add(
        OAuthState(
            state=state, code_verifier=verifier, purpose=purpose, user_id=user_id, created_at=now
        )
    )
    db.commit()
    response = RedirectResponse(provider.authorization_url(state, challenge(verifier)), status_code=302)
    _cookie(response, settings, STATE_COOKIE, state, int(STATE_LIFETIME.total_seconds()))
    return response


@router.get("/auth/google/start", summary="Google로 계속하기 — sign in or sign up")
def google_start(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    return _begin(db, settings, "signin", None)


@router.get("/account/google/link/start", summary="Link Google to the signed-in account")
def google_link_start(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    return _begin(db, settings, "link", user.id)


def _to(path: str, **query: str) -> RedirectResponse:
    target = path + ("?" + urllib.parse.urlencode(query) if query else "")
    return RedirectResponse(target, status_code=302)


@router.get("/auth/google/callback", summary="Where Google sends the browser back")
def google_callback(
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    provider = _provider_or_404(settings)
    cookie_state = request.cookies.get(STATE_COOKIE, "")

    row = db.get(OAuthState, state) if state else None
    if row is not None:
        # Single use, whatever happens next.
        db.delete(row)
        db.commit()

    def fail(reason: str) -> RedirectResponse:
        target = "/profile" if row is not None and row.purpose == "link" else "/login"
        response = _to(target, google=reason)
        _clear(response, settings, STATE_COOKIE)
        return response

    if error:
        return fail("cancelled")
    if row is None or not cookie_state or not secrets.compare_digest(cookie_state, state):
        return fail("expired")
    created = row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - created > STATE_LIFETIME:
        return fail("expired")

    try:
        identity = provider.exchange(code, row.code_verifier)
    except GoogleLoginError as problem:
        logger.warning("Google sign-in exchange failed: %s", problem)
        return fail("failed")

    linked = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.provider == "google",
            ConnectedAccount.provider_account_id == identity.sub,
        )
    )

    if row.purpose == "link":
        member = db.get(User, row.user_id) if row.user_id else None
        if member is None or not member.can_sign_in:
            return fail("failed")
        if linked is not None:
            return fail("taken" if linked.user_id != member.id else "already")
        if db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == member.id, ConnectedAccount.provider == "google"
            )
        ):
            return fail("other")
        db.add(
            ConnectedAccount(
                user_id=member.id,
                provider="google",
                provider_account_id=identity.sub,
                email=identity.email,
                scopes=" ".join(SIGN_IN_SCOPES),
            )
        )
        db.commit()
        response = _to("/profile", google="linked")
        _clear(response, settings, STATE_COOKIE)
        return response

    # Sign in: by `sub` only.
    if linked is not None:
        member = db.get(User, linked.user_id)
        if member is None or not member.can_sign_in:
            return fail("blocked")
        response = _to("/")
        _clear(response, settings, STATE_COOKIE)
        _start_session(db, response, member, settings)
        return response

    # A Google account we do not know: hold it for the setup screen.
    now = datetime.now(timezone.utc)
    db.execute(delete(PendingGoogleSignup).where(PendingGoogleSignup.created_at < now - PENDING_LIFETIME))
    token = secrets.token_urlsafe(32)
    db.add(
        PendingGoogleSignup(
            token=token,
            sub=identity.sub,
            email=identity.email,
            email_verified=identity.email_verified,
            name=identity.name,
            created_at=now,
        )
    )
    db.commit()
    response = _to("/signup/google")
    _clear(response, settings, STATE_COOKIE)
    _cookie(response, settings, SIGNUP_COOKIE, token, int(PENDING_LIFETIME.total_seconds()))
    return response


# ------------------------------------------------------------- setup screen


def _is_admin_email(identity_email: str, verified: bool, settings: Settings) -> bool:
    """Only a Google-verified email equal to ADMIN_EMAIL makes an admin."""
    wanted = settings.admin_email.strip().lower()
    return bool(wanted) and verified and identity_email.strip().lower() == wanted


def _pending(db: Session, request: Request) -> PendingGoogleSignup | None:
    token = request.cookies.get(SIGNUP_COOKIE, "")
    if not token:
        return None
    pending = db.get(PendingGoogleSignup, token)
    if pending is None:
        return None
    created = pending.created_at if pending.created_at.tzinfo else pending.created_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - created > PENDING_LIFETIME:
        return None
    return pending


class PendingRead(BaseModel):
    email: str
    name: str
    suggested_username: str
    needs_invite_code: bool
    #: An account with this email already exists: sign in to it and link
    #: Google from Profile instead.
    email_taken: bool


class CompleteRequest(BaseModel):
    username: str
    display_name: str
    invite_code: str = ""


def _suggest(email: str) -> str:
    local = re.sub(r"[^A-Za-z0-9_]", "_", email.split("@")[0])[:30].strip("_")
    return local if len(local) >= 3 else ""


@router.get("/auth/google/pending", response_model=PendingRead, summary="The Google sign-up waiting for setup")
def google_pending(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> PendingRead:
    _provider_or_404(settings)
    pending = _pending(db, request)
    if pending is None:
        raise HTTPException(status_code=404, detail="Google 가입 정보가 없거나 만료되었습니다. 처음부터 다시 해 주세요.")
    taken = db.scalar(select(User.id).where(User.email == pending.email)) is not None
    return PendingRead(
        email=pending.email,
        name=pending.name,
        suggested_username=_suggest(pending.email),
        needs_invite_code=not _is_admin_email(pending.email, pending.email_verified, settings),
        email_taken=taken,
    )


@router.post(
    "/auth/google/complete",
    response_model=CurrentUser,
    status_code=status.HTTP_201_CREATED,
    summary="Finish a Google sign-up: username, display name, invite code",
)
def google_complete(
    payload: CompleteRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    _provider_or_404(settings)
    pending = _pending(db, request)
    if pending is None:
        raise HTTPException(status_code=400, detail="Google 가입 정보가 없거나 만료되었습니다. 처음부터 다시 해 주세요.")

    username = payload.username.strip()
    display_name = payload.display_name.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="아이디는 영문, 숫자, 밑줄(_)로 3자 이상이어야 합니다.")
    if not display_name or len(display_name) > 100:
        raise HTTPException(status_code=400, detail="이름을 1~100자로 적어 주세요.")

    is_admin = _is_admin_email(pending.email, pending.email_verified, settings)

    invite = None
    if not is_admin:
        address = rate_limit.client_address(request, settings)
        if rate_limit.blocked(db, address, settings):
            raise HTTPException(status_code=429, detail="가입 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.")
        attempt = rate_limit.record(db, address)
        code = invites.normalise(payload.invite_code)
        if not code:
            rate_limit.mark_failed(db, attempt)
            raise HTTPException(status_code=400, detail=invites.CODE_REQUIRED)
        invite = invites.find_usable(db, code)
        if invite is None:
            rate_limit.mark_failed(db, attempt)
            raise HTTPException(status_code=400, detail=invites.CODE_UNUSABLE)

    if db.scalar(select(User.id).where(User.email == pending.email)) is not None:
        raise HTTPException(
            status_code=409,
            detail="이 이메일로 이미 가입한 계정이 있습니다. 그 계정으로 로그인한 뒤 Profile에서 Google을 연결해 주세요.",
        )
    if db.scalar(select(User.id).where(User.username == username)) is not None:
        raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다.")
    if db.scalar(
        select(ConnectedAccount.id).where(
            ConnectedAccount.provider == "google", ConnectedAccount.provider_account_id == pending.sub
        )
    ):
        raise HTTPException(status_code=409, detail="이 Google 계정은 이미 다른 계정에 연결되어 있습니다.")

    if invite is not None and not invites.claim(db, invite.id):
        db.rollback()
        raise HTTPException(status_code=400, detail=invites.CODE_UNUSABLE)

    member = User(
        username=username,
        email=pending.email,
        password_hash=UNUSABLE_PASSWORD_HASH,
        display_name=display_name,
        role=UserRole.ADMIN if is_admin else UserRole.MEMBER,
        account_status=AccountStatus.ACTIVE,
        invite_code_id=invite.id if invite is not None else None,
    )
    db.add(member)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="이미 사용 중인 아이디 또는 이메일입니다.") from None
    db.add(
        ConnectedAccount(
            user_id=member.id,
            provider="google",
            provider_account_id=pending.sub,
            email=pending.email,
            scopes=" ".join(SIGN_IN_SCOPES),
        )
    )
    if is_admin:
        audit.record(
            db,
            actor=member,
            action=AuditAction.ADMIN_BY_GOOGLE,
            target_type="user",
            target_id=member.id,
            target_label=member.username,
            summary=f"ADMIN_EMAIL과 같은 Google 계정으로 가입해 관리자가 되었습니다 ({member.username}).",
        )
    db.delete(pending)
    db.commit()
    db.refresh(member)

    _clear(response, settings, SIGNUP_COOKIE)
    _start_session(db, response, member, settings)
    return _as_current_user(member)


class GoogleConnection(BaseModel):
    available: bool
    linked: bool
    email: str


@router.get("/account/google", response_model=GoogleConnection, summary="Is Google linked to my account")
def google_connection(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> GoogleConnection:
    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.user_id == user.id, ConnectedAccount.provider == "google"
        )
    )
    return GoogleConnection(
        available=get_google_login(settings) is not None,
        linked=account is not None,
        email=account.email if account is not None else "",
    )


# ------------------------------------------------------------- mock consent


@router.get(MOCK_CONSENT_PATH.removeprefix("/api"), response_class=HTMLResponse, include_in_schema=False)
def mock_consent(
    state: str = "",
    code_challenge: str = "",
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    """Development's stand-in for Google's consent screen. 404 elsewhere."""
    provider = _provider_or_404(settings)
    if not isinstance(provider, MockGoogleLogin):
        raise HTTPException(status_code=404, detail="Not Found")
    page = f"""<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Google (개발용 목업)</title>
<body style="font-family:sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem">
<h1 style="font-size:1.2rem">Google 계정 선택 (개발용 목업)</h1>
<p>실제 Google이 아닙니다. 개발 환경에서만 보이는 화면입니다.</p>
<form method="get" action="/api/auth/google/mock-consent/approve">
<input type="hidden" name="state" value="{html.escape(state)}">
<input type="hidden" name="code_challenge" value="{html.escape(code_challenge)}">
<p><label>이메일<br><input name="email" value="member@example.com" style="width:100%"></label></p>
<p><label>Google 계정 id (sub)<br><input name="sub" value="mock-sub-member" style="width:100%"></label></p>
<p><label>이름<br><input name="name" value="목업 회원" style="width:100%"></label></p>
<p><label><input type="checkbox" name="verified" value="1" checked> 이메일 확인됨 (email_verified)</label></p>
<p><button type="submit">이 계정으로 계속</button>
<a href="/api/auth/google/callback?error=access_denied&state={html.escape(urllib.parse.quote(state))}">취소</a></p>
</form></body></html>"""
    return HTMLResponse(page)


@router.get(MOCK_CONSENT_PATH.removeprefix("/api") + "/approve", include_in_schema=False)
def mock_consent_approve(
    state: str = "",
    code_challenge: str = "",
    email: str = "",
    sub: str = "",
    name: str = "",
    verified: str = "",
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    provider = _provider_or_404(settings)
    if not isinstance(provider, MockGoogleLogin):
        raise HTTPException(status_code=404, detail="Not Found")
    code = MockGoogleLogin.make_code(
        GoogleIdentity(sub=sub.strip(), email=email.strip(), email_verified=verified == "1", name=name.strip()),
        code_challenge,
    )
    return _to("/api/auth/google/callback", code=code, state=state)
