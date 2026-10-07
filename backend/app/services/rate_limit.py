"""Per-address rate limits for signing up (invite-only-signup).

Two limits, both counted per client address:

* **attempts** — every `POST /api/auth/register`, successful or not;
* **failed codes** — attempts whose invite code was missing or unusable.
  Tighter, because guessing codes is the thing to slow down.

**Kept in memory**, deliberately. The beta runs one backend process, and
losing the counts on a restart costs nothing worth a table. Several
processes would each count on their own — the limit would loosen, not
break — and moving the counts to the database is the fix then.

**Which address.** Requests arrive through Next.js's `/api` rewrite (and,
in production, a reverse proxy in front of it), so the peer address is a
proxy's. `client_address` believes `X-Forwarded-For` only when the peer
is in `TRUSTED_PROXIES`, and then takes the **rightmost** entry — the
address the nearest trusted proxy saw, which a visitor cannot forge.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from ipaddress import ip_address, ip_network

from fastapi import Request

from app.core.config import Settings


class SlidingWindow:
    """At most `limit` events per key in any `seconds`-long window."""

    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _trim(self, key: str, seconds: float, now: float) -> deque[float]:
        events = self._events.setdefault(key, deque())
        while events and events[0] <= now - seconds:
            events.popleft()
        return events

    def blocked(self, key: str, limit: int, seconds: float) -> bool:
        """True when `key` has already reached `limit`. Does not record."""
        if limit <= 0:
            return False
        with self._lock:
            return len(self._trim(key, seconds, time.monotonic())) >= limit

    def record(self, key: str, seconds: float) -> None:
        with self._lock:
            now = time.monotonic()
            self._trim(key, seconds, now).append(now)

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


#: One per kind of event. Module-level so every request shares them.
signup_attempts = SlidingWindow()
invite_failures = SlidingWindow()

ATTEMPT_WINDOW_SECONDS = 60 * 60
FAILURE_WINDOW_SECONDS = 15 * 60


def _in(address: str, networks: list) -> bool:
    try:
        ip = ip_address(address)
    except ValueError:
        return False
    return any(ip in network for network in networks)


def client_address(request: Request, settings: Settings) -> str:
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


def reset_all() -> None:
    """For the tests."""
    signup_attempts.reset()
    invite_failures.reset()
