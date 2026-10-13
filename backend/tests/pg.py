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
    """TEST_DATABASE_URL from the environment, else the root `.env`, else the default.

    The application's settings read `.env` themselves; this is a test-only
    value, so it is looked up the same way here.
    """
    from_env = os.environ.get("TEST_DATABASE_URL", "").strip()
    if from_env:
        return from_env
    from dotenv import dotenv_values

    from app.core.config import BACKEND_DIR, REPO_ROOT

    for path in (BACKEND_DIR / ".env", REPO_ROOT / ".env"):
        if path.is_file():
            value = (dotenv_values(path).get("TEST_DATABASE_URL") or "").strip()
            if value:
                return value
    return DEFAULT_TEST_DATABASE_URL


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
                name = conn.dialect.identifier_preparer.quote(parsed.database)
                conn.execute(text(f"CREATE DATABASE {name}"))
    finally:
        server.dispose()
    return connect(url)


#: Connection options that can send a connection somewhere other than
#: the host and database the URL names. Refused outright.
_REDIRECTING_QUERY_KEYS = {"dbname", "host", "hostaddr", "port", "service", "servicefile"}


class UnsafeTestDatabase(Exception):
    """The test database cannot be proved separate from DATABASE_URL's."""


def _server_identity(engine: Engine) -> tuple:
    with engine.connect() as conn:
        return tuple(
            conn.execute(
                text(
                    "SELECT current_database(), inet_server_addr()::text, "
                    "inet_server_port(), pg_postmaster_start_time()::text"
                )
            ).one()
        )


def prove_separate(test_url: str, app_url: str, engine: Engine) -> None:
    """Raise unless `engine` is certainly the test database and not the app's.

    The URL comparison (`refusal`) runs first, at session start. This runs
    again right before anything is dropped, and checks what the server
    itself reports, because a URL can reach a database it does not name:
    no database name (libpq then uses the user name), `?dbname=` in the
    query, `PGDATABASE`, or another spelling of the host.
    """
    message = refusal(test_url, app_url)
    if message:
        raise UnsafeTestDatabase(message)
    parsed = make_url(test_url)
    name = parsed.database or ""
    if not name:
        raise UnsafeTestDatabase(f"TEST_DATABASE_URL names no database: {shown(test_url)}")
    if not name.endswith("_test"):
        raise UnsafeTestDatabase(
            f"The test database's name must end in _test ({shown(test_url)}), so a "
            "mistyped URL can never empty a real database."
        )
    redirecting = _REDIRECTING_QUERY_KEYS & {key.lower() for key in parsed.query}
    if redirecting:
        raise UnsafeTestDatabase(
            f"TEST_DATABASE_URL may not set {', '.join(sorted(redirecting))} in its query: "
            f"{shown(test_url)}"
        )
    test_identity = _server_identity(engine)
    if test_identity[0] != name:
        raise UnsafeTestDatabase(
            f"Connected to {test_identity[0]!r}, not {name!r} — refusing to touch it."
        )
    app_engine = connect(app_url)
    if app_engine is not None:
        try:
            if _server_identity(app_engine) == test_identity:
                raise UnsafeTestDatabase(
                    "TEST_DATABASE_URL and DATABASE_URL reach the same database on the "
                    f"same server ({shown(test_url)} / {shown(app_url)})."
                )
        finally:
            app_engine.dispose()


def reset_schema(engine: Engine) -> None:
    """Drop everything in `public` — the test database only.

    Callers prove the engine is the test database first (`prove_separate`).
    """
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
