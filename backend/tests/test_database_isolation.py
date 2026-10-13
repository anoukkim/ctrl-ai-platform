"""test-database-isolation: the tests never use the developer's database.

Three things are proved here:

* the guard: `TEST_DATABASE_URL` naming the same database as
  `DATABASE_URL` stops the run, however the two are spelled;
* the check after every run: a run that changes `DATABASE_URL`'s tables or
  `alembic_version` fails, and a run that does not, passes;
* the PostgreSQL test database is built by the migrations.

The row-lock test (`test_usage.py`) and the invite race (`test_invites.py`)
run on that database through the `pg_engine` fixture.
"""

import os
import subprocess
import sys
import textwrap

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.config import BACKEND_DIR
from tests import pg

# ------------------------------------------------------------------ the guard


@pytest.mark.parametrize(
    ("first", "second"),
    [
        (
            "postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai",
            "postgresql+psycopg://ctrlai:ctrlai@127.0.0.1/ctrlai",
        ),
        (
            "postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai",
            "postgresql://someone:other@[::1]:5432/CTRLAI",
        ),
        (
            "postgresql+psycopg://a:b@db.example.com:5432/club",
            "postgresql+psycopg://c:d@DB.example.com/club",
        ),
    ],
)
def test_the_same_database_written_two_ways_is_recognised(first: str, second: str) -> None:
    assert pg.same_database(first, second)
    message = pg.refusal(first, second)
    assert message is not None
    # Names both, hides both passwords.
    assert "TEST_DATABASE_URL" in message and "DATABASE_URL" in message
    for url in (first, second):
        password = make_url(url).password
        if password:
            assert f":{password}@" not in message


@pytest.mark.parametrize(
    "other",
    [
        "postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai_test",
        "postgresql+psycopg://ctrlai:ctrlai@localhost:5433/ctrlai",
        "postgresql+psycopg://ctrlai:ctrlai@db.example.com:5432/ctrlai",
        "sqlite://",
    ],
)
def test_separate_databases_pass(other: str) -> None:
    developer = "postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai"
    assert not pg.same_database(other, developer)
    assert pg.refusal(other, developer) is None


def test_the_default_test_database_is_not_the_development_one() -> None:
    assert not pg.same_database(
        pg.DEFAULT_TEST_DATABASE_URL, "postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai"
    )


def _run_pytest(args: list[str], **env: str) -> subprocess.CompletedProcess[str]:
    """pytest in a fresh process, with this suite's conftest loaded."""
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "-q", *args],
        cwd=BACKEND_DIR,
        env={**os.environ, **env},
        capture_output=True,
        text=True,
        timeout=300,
    )


def test_the_run_refuses_to_start_on_the_developer_database() -> None:
    result = _run_pytest(
        ["tests/test_health.py"],
        DATABASE_URL="postgresql+psycopg://ctrlai:secret@localhost:5432/ctrlai",
        TEST_DATABASE_URL="postgresql://ctrlai:secret@127.0.0.1/ctrlai",
    )
    assert result.returncode != 0
    output = result.stdout + result.stderr
    assert "TEST_DATABASE_URL names the same database as DATABASE_URL" in output
    assert "secret" not in output


# --------------------------------------------------- the check after every run

_PROBE_TEST = textwrap.dedent(
    """
    import os

    from sqlalchemy import create_engine, text


    def test_probe():
        if os.environ.get("PROBE_WRITE") == "1":
            engine = create_engine(os.environ["DATABASE_URL"])
            with engine.begin() as conn:
                conn.execute(text("CREATE TABLE stray_from_a_test (id integer)"))
            engine.dispose()
    """
)


@pytest.fixture
def probe_database(pg_engine):
    """A stand-in for the developer's database, on the test server.

    Its own unique name ending in `_test`, so it can never be a real
    database, and two runs never share one.
    """
    import uuid

    probe_name = f"ctrlai_isolation_probe_{uuid.uuid4().hex[:8]}_test"
    url = make_url(pg.configured_url()).set(database=probe_name)
    rendered = url.render_as_string(hide_password=False)
    engine = pg.ensure_database(rendered)
    assert engine is not None
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS stray_from_a_test"))
        conn.execute(text("CREATE TABLE IF NOT EXISTS members_were_here (id integer)"))
    engine.dispose()
    yield rendered
    server = pg.connect(url.set(database="postgres").render_as_string(hide_password=False))
    if server is not None:
        with server.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            quoted = conn.dialect.identifier_preparer.quote(probe_name)
            conn.execute(text(f"DROP DATABASE IF EXISTS {quoted} WITH (FORCE)"))
        server.dispose()


def test_a_run_that_leaves_the_developer_database_alone_passes(probe_database, tmp_path) -> None:
    probe = tmp_path / "test_probe_clean.py"
    probe.write_text(_PROBE_TEST, encoding="utf-8")

    result = _run_pytest(
        ["-c", "pyproject.toml", "--rootdir", ".", "-p", "tests.conftest", str(probe)],
        DATABASE_URL=probe_database,
        TEST_DATABASE_URL=pg.configured_url(),
        PROBE_WRITE="0",
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_a_run_that_changes_the_developer_database_fails(probe_database, tmp_path) -> None:
    probe = tmp_path / "test_probe_dirty.py"
    probe.write_text(_PROBE_TEST, encoding="utf-8")

    result = _run_pytest(
        ["-c", "pyproject.toml", "--rootdir", ".", "-p", "tests.conftest", str(probe)],
        DATABASE_URL=probe_database,
        TEST_DATABASE_URL=pg.configured_url(),
        PROBE_WRITE="1",
    )

    assert result.returncode != 0
    assert "changed DATABASE_URL's database" in result.stdout + result.stderr


# ------------------------------------------------------- the test database


def test_the_test_database_is_built_by_the_migrations(pg_engine) -> None:
    from alembic.script import ScriptDirectory
    from alembic.config import Config

    head = ScriptDirectory.from_config(Config(str(BACKEND_DIR / "alembic.ini"))).get_current_head()
    with pg_engine.connect() as conn:
        versions = conn.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
        # Seeded by a migration, not by create_all.
        models = conn.execute(text("SELECT count(*) FROM chat_models")).scalar()
    assert versions == [head]
    assert models > 0


# ------------------------------------------- the second check, before dropping


@pytest.mark.parametrize(
    ("url", "reason"),
    [
        # No database name: libpq would use the user name — often the
        # developer's database.
        ("postgresql+psycopg://ctrlai:x@127.0.0.1:55433/", "names no database"),
        ("postgresql+psycopg://ctrlai:x@127.0.0.1:55433/ctrlai", "must end in _test"),
        ("postgresql+psycopg://ctrlai:x@127.0.0.1:55433/ctrlai_test?dbname=ctrlai", "dbname"),
        ("postgresql+psycopg://ctrlai:x@127.0.0.1:55433/ctrlai_test?host=elsewhere", "host"),
    ],
)
def test_urls_that_could_reach_another_database_are_refused(url: str, reason: str) -> None:
    """Checked before any connection, so no server is needed."""

    class NeverConnects:
        def connect(self):  # pragma: no cover - must not be reached
            raise AssertionError("connected before refusing")

    with pytest.raises(pg.UnsafeTestDatabase, match=reason):
        pg.check_url(url, "postgresql+psycopg://x:x@127.0.0.1:1/none")
    with pytest.raises(pg.UnsafeTestDatabase, match=reason):
        pg.prove_separate(url, "postgresql+psycopg://x:x@127.0.0.1:1/none", NeverConnects())


def test_the_real_test_database_is_proved_separate(pg_engine) -> None:
    # Reaching here means the fixture's own check passed; run it once more
    # against a stand-in developer database on the same server.
    pg.prove_separate(
        pg.configured_url(),
        make_url(pg.configured_url()).set(database="postgres").render_as_string(hide_password=False),
        pg_engine,
    )


def test_the_server_comparison_catches_what_the_urls_hide(pg_engine) -> None:
    """A "developer" URL that names another database but reaches the test
    one through `?dbname=`: the URLs differ, the server says they match."""
    disguised = (
        make_url(pg.configured_url())
        .set(database="something_else")
        .update_query_dict({"dbname": make_url(pg.configured_url()).database})
        .render_as_string(hide_password=False)
    )
    assert pg.refusal(pg.configured_url(), disguised) is None
    with pytest.raises(pg.UnsafeTestDatabase, match="same database on the same server"):
        pg.prove_separate(pg.configured_url(), disguised, pg_engine)
