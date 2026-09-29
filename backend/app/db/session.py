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


engine = create_engine(
    settings.database_url,
    # Check that a pooled connection is still alive before reusing it.
    # Without this, a restarted database leaves stale connections behind.
    pool_pre_ping=True,
    connect_args=_connect_args(settings.database_url),
    echo=False,
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
