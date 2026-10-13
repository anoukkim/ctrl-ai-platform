"""Per-address rate limits for signing up (invite-only-signup).

Two limits, both counted per client address:

* **attempts** — every `POST /api/auth/register`, successful or not;
* **failed codes** — attempts whose invite code was missing or unusable.
  Tighter, because guessing codes is the thing to slow down.

**Counted in the database** (`signup_attempts`), not in memory: the
server runs two API workers, and a count kept in one process's memory
would let each of them allow the full limit. Rows older than a day are
deleted as new ones are written.

**Which address.** Requests arrive through Next.js's `/api` rewrite (and,
on the server, Caddy in front of it), so the peer address is a proxy's.
`client_address` believes `X-Forwarded-For` only when the peer is in
`TRUSTED_PROXIES`, and then takes the **rightmost** entry — the address
the nearest trusted proxy saw, which a visitor cannot forge. On the
server, uvicorn (`--proxy-headers`) has already replaced the peer with
the client Caddy saw, so that peer is used as it is.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from ipaddress import ip_address, ip_network

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import LoginAttempt, SignupAttempt

ATTEMPT_WINDOW = timedelta(hours=1)
FAILURE_WINDOW = timedelta(minutes=15)
#: How long attempts are kept at all.
RETENTION = timedelta(days=1)


def _count(db: Session, address: str, since: datetime, *, failed_only: bool) -> int:
    query = select(func.count(SignupAttempt.id)).where(
        SignupAttempt.address == address, SignupAttempt.created_at >= since
    )
    if failed_only:
        query = query.where(SignupAttempt.failed.is_(True))
    return db.scalar(query) or 0


def blocked(db: Session, address: str, settings: Settings) -> bool:
    """True when this address has used up either limit. Records nothing."""
    now = datetime.now(timezone.utc)
    failures = settings.invite_failures_per_15_minutes
    if failures > 0 and _count(db, address, now - FAILURE_WINDOW, failed_only=True) >= failures:
        return True
    attempts = settings.signup_attempts_per_hour
    return attempts > 0 and _count(db, address, now - ATTEMPT_WINDOW, failed_only=False) >= attempts


def record(db: Session, address: str) -> SignupAttempt:
    """Write one attempt and commit it on its own.

    Committed straight away, so it counts even when the sign-up is then
    refused and the rest rolled back. Rows past `RETENTION` are pruned.
    """
    now = datetime.now(timezone.utc)
    db.execute(delete(SignupAttempt).where(SignupAttempt.created_at < now - RETENTION))
    attempt = SignupAttempt(address=address[:64], failed=False, created_at=now)
    db.add(attempt)
    db.commit()
    return attempt


def mark_failed(db: Session, attempt: SignupAttempt) -> None:
    """The attempt's invite code was missing or unusable."""
    attempt.failed = True
    db.commit()


LOGIN_WINDOW = timedelta(minutes=15)


def login_blocked(db: Session, address: str, username: str, settings: Settings) -> bool:
    """Too many failed password sign-ins.

    Three ceilings, so that guessing is slow but nobody can lock someone
    else out from another address:

    * this address, this username — the limit itself;
    * this address, any username — three times it (one address guessing
      many accounts);
    * this username, any address — ten times it, only as a backstop
      against a distributed guess. Reaching it takes many addresses.
    """
    limit = settings.login_failures_per_15_minutes
    if limit <= 0:
        return False
    since = datetime.now(timezone.utc) - LOGIN_WINDOW
    name = username.strip().lower()[:64]

    def failures(*conditions) -> int:
        return db.scalar(
            select(func.count(LoginAttempt.id)).where(LoginAttempt.created_at >= since, *conditions)
        ) or 0

    return (
        failures(LoginAttempt.address == address, LoginAttempt.username == name) >= limit
        or failures(LoginAttempt.address == address) >= 3 * limit
        or failures(LoginAttempt.username == name) >= 10 * limit
    )


def record_login_failure(db: Session, address: str, username: str) -> None:
    now = datetime.now(timezone.utc)
    db.execute(delete(LoginAttempt).where(LoginAttempt.created_at < now - RETENTION))
    db.add(
        LoginAttempt(address=address[:64], username=username.strip().lower()[:64], created_at=now)
    )
    db.commit()


def _in(address: str, networks: list) -> bool:
    try:
        ip = ip_address(address)
    except ValueError:
        return False
    return any(ip in network for network in networks)


def _bucket(address: str) -> str:
    """The key an address is counted under.

    IPv6 clients are counted by their /64 network: one household or one
    attacker usually holds a whole /64, and counting single addresses would
    let them step around every per-address limit.
    """
    try:
        ip = ip_address(address)
    except ValueError:
        return address
    if ip.version == 6 and ip.ipv4_mapped is None:
        return str(ip_network(f"{ip}/64", strict=False))
    if ip.version == 6 and ip.ipv4_mapped is not None:
        return str(ip.ipv4_mapped)
    return address


def client_address(request: Request, settings: Settings) -> str:
    return _bucket(_client_address(request, settings))


def _client_address(request: Request, settings: Settings) -> str:
    peer = request.client.host if request.client else ""
    networks = []
    for part in settings.trusted_proxies.split(","):
        part = part.strip()
        if part:
            try:
                networks.append(ip_network(part, strict=False))
            except ValueError:
                continue
    if not _in(peer, networks):
        return peer or "unknown"
    forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",")]
    forwarded = [p for p in forwarded if p]
    return forwarded[-1] if forwarded else peer or "unknown"
