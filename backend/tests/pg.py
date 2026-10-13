"""The PostgreSQL test database (test-database-isolation).

Most tests run on in-memory SQLite. A few must prove what only PostgreSQL
does — the row lock that stops a wallet being overspent, the conditional
`UPDATE` that stops two people taking the last use of an invite code — and
those need a real server.

They used to borrow `DATABASE_URL`, the developer's own database, and run
`create_all` on it. That wrote test rows into the database the developer
was looking at, and created a branch's tables without its migrations,
after which `alembic upgrade head` failed. Now:

* the tests use **their own database**, `TEST_DATABASE_URL`;
* the run **refuses to start** if that names the same database as
  `DATABASE_URL`, however the two are spelled;
* the schema comes from **the migrations**, as in production;
* everything is dropped again at the end of the run;
* with no PostgreSQL reachable, the tests that need it skip.
"""

from __future__ import annotations

import os

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Engine, make_url

DEFAULT_TEST_DATABASE_URL = "postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai_test"

#: Names that mean "this machine" — the same server however it is written.
_LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "::1"}


def configured_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "").strip() or DEFAULT_TEST_DATABASE_URL


def shown(url: str | URL) -> str:
    """A URL fit for an error message: the password hidden."""
    return make_url(str(url) if isinstance(url, URL) else url).render_as_string(hide_password=True)


def _where(url: str) -> tuple[str, int, str]:
    parsed = make_url(url)
    host = (parsed.host or "").lower()
    if host in _LOCAL_HOSTS:
        host = "localhost"
    return host, parsed.port or 5432, (parsed.database or "").lower()


def same_database(first: str, second: str) -> bool:
    """Whether two URLs reach the same PostgreSQL database.

    Host (any spelling of this machine counts as one), port (5432 when left
    out) and database name decide it — not the driver, the user or the
    password, which change how you connect, not where you land.
    """
    try:
        a, b = make_url(first), make_url(second)
    except Exception:
        return first.strip() == second.strip()
    if a.get_backend_name() != "postgresql" or b.get_backend_name() != "postgresql":
        return False
    return _where(first) == _where(second)


def refusal(test_url: str, app_url: str) -> str | None:
    """The message that stops the run, or None when the two are separate."""
    if not same_database(test_url, app_url):
        return None
    return (
        "TEST_DATABASE_URL names the same database as DATABASE_URL — the tests "
        "would write into the database you work in.\n"
        f"  TEST_DATABASE_URL = {shown(test_url)}\n"
        f"  DATABASE_URL      = {shown(app_url)}\n"
        "Point TEST_DATABASE_URL at a separate database (default: "
        f"{shown(DEFAULT_TEST_DATABASE_URL)})."
    )


def connect(url: str, timeout: int = 2) -> Engine | None:
    """An engine for `url` if the server answers, else None."""
    if not url.startswith("postgresql"):
        return None
    engine = create_engine(url, connect_args={"connect_timeout": timeout})
    try:
        with engine.connect():
            pass
    except Exception:
        engine.dispose()
        return None
    return engine


def ensure_database(url: str) -> Engine | None:
    """Connect to the test database, creating it on the server if missing.

    Returns None when no server answers at all — the caller skips.
    """
    engine = connect(url)
    if engine is not None:
        return engine
    parsed = make_url(url)
    server = connect(parsed.set(database="postgres").render_as_string(hide_password=False))
    if server is None:
        return None
    try:
        with server.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": parsed.database},
            ).scalar()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{parsed.database}"'))
    finally:
        server.dispose()
    return connect(url)


def reset_schema(engine: Engine) -> None:
    """Drop everything in `public` — the test database only."""
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))


def migrate(url: str) -> None:
    """`alembic upgrade head` against `url`, not against DATABASE_URL."""
    from alembic import command
    from alembic.config import Config

    from app.core.config import BACKEND_DIR

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["database_url"] = url
    command.upgrade(config, "head")


def snapshot(url: str) -> tuple[tuple[str, ...], tuple[str, ...]] | None:
    """The tables in `public` and the `alembic_version` rows, or None.

    Read-only. Taken of `DATABASE_URL` before and after the run, to prove
    the suite left the developer's database as it found it.
    """
    engine = connect(url)
    if engine is None:
        return None
    try:
        with engine.connect() as conn:
            tables = tuple(
                sorted(
                    conn.execute(
                        text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                    ).scalars()
                )
            )
            versions: tuple[str, ...] = ()
            if "alembic_version" in tables:
                versions = tuple(
                    sorted(conn.execute(text("SELECT version_num FROM alembic_version")).scalars())
                )
        return tables, versions
    finally:
        engine.dispose()
