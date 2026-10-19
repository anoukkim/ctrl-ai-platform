"""Database engine and session management.

Two concepts that are easy to mix up:

* The **engine** is the long-lived connection pool. One per process.
* A **session** is a short-lived unit of work. One per HTTP request.
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

# How long to wait for a TCP connection to PostgreSQL before giving up.
# Without this, a stopped database makes every request hang until the
# operating system times out, so `/api/health` would never answer
# "degraded" — it would simply never respond at all.
CONNECT_TIMEOUT_SECONDS = 5


def _connect_args(database_url: str) -> dict[str, object]:
    """Driver-specific connection options.

    `connect_timeout` is a PostgreSQL option, so it is only applied to
    PostgreSQL URLs. SQLite (used by the tests) does not accept it.
    """
    if database_url.startswith("postgresql"):
        return {"connect_timeout": CONNECT_TIMEOUT_SECONDS}
    return {}


def _pool_args(database_url: str) -> dict[str, object]:
    """Pool sizes from the environment (DB_POOL_SIZE, DB_MAX_OVERFLOW).

    SQLite's pool takes neither option, so it is left alone.
    """
    if database_url.startswith("postgresql"):
        return {"pool_size": settings.db_pool_size, "max_overflow": settings.db_max_overflow}
    return {}


engine = create_engine(
    settings.database_url,
    # Check that a pooled connection is still alive before reusing it.
    # Without this, a restarted database leaves stale connections behind.
    pool_pre_ping=True,
    connect_args=_connect_args(settings.database_url),
    echo=False,
    **_pool_args(settings.database_url),
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that provides a database session per request.

    Used in routes as `db: Session = Depends(get_db)`. The `finally`
    block guarantees the connection returns to the pool even if the
    request raises.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def release_before_stream(db: Session, request) -> None:
    """End the request's transaction — and hand its connection back — before
    a long Server-Sent Events stream starts (fix-stream-db-sessions,
    2026-10-19).

    FastAPI runs `get_db`'s clean-up only after a StreamingResponse
    finishes, so a route that read anything kept a transaction "idle in
    transaction" for the whole stream: its read locks blocked a deploy's
    ALTER TABLE, and every query behind that queued — the site stopped for
    ten minutes. The streams do their own work in sessions of their own.

    The tests hand every caller one shared session (`dependency_overrides`);
    that one is only committed, never closed under them.
    """
    if get_db in request.app.dependency_overrides:
        db.commit()
    else:
        db.close()
