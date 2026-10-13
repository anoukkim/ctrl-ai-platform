"""How many provider calls one server process may have in flight.

audit-caching-and-distribution (PART F): the club has **one** Anthropic
key. Nothing else stops ten members (or one member with ten tabs) from
opening ten streams at once and eating the key's rate limit for everyone
— the per-minute message limit counts per member, not per server. This
counter does: a call waits briefly for a slot, then is refused with a
Korean sentence and nothing spent.

Deliberately per **process**. The beta VM runs two uvicorn workers, so
the real ceiling is the setting × 2; `docs/api-distribution.md` says so
in plain words. A cross-process limiter would need shared state
(PostgreSQL advisory locks or Redis) for a club of a few dozen — not
worth it yet.

The limit itself lives with the other chat limits (`chat_limits` rows,
Admin › System) and is read fresh on every acquire, so an admin's change
applies to the next call without a restart. A plain lock-and-condition
counter rather than `threading.Semaphore`, because a semaphore's size
cannot change while it is in use.
"""

from __future__ import annotations

import threading

_lock = threading.Lock()
_free = threading.Condition(_lock)
_active = 0

#: How long a call may wait for a slot before the member is told to try
#: again. Long enough to ride out a burst of short replies, short enough
#: that the member is not staring at a silent screen.
WAIT_SECONDS = 10.0


def acquire(limit: int, wait_seconds: float | None = None) -> bool:
    """Take a slot, waiting up to `wait_seconds` (module default). False = refused."""
    global _active
    with _free:
        remaining = WAIT_SECONDS if wait_seconds is None else wait_seconds
        while _active >= max(1, limit):
            if remaining <= 0:
                return False
            # wait() returns on notify or timeout; re-check both.
            before = _monotonic()
            _free.wait(timeout=remaining)
            remaining -= _monotonic() - before
        _active += 1
        return True


def release() -> None:
    global _active
    with _free:
        if _active > 0:
            _active -= 1
        _free.notify()


def active_calls() -> int:
    with _lock:
        return _active


def _monotonic() -> float:
    import time

    return time.monotonic()
