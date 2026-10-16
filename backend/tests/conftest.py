"""Shared pytest fixtures.

The tests run against a temporary in-memory SQLite database rather than
PostgreSQL, so `pytest` works even when Docker is not running. The
production code is unchanged: FastAPI's dependency override system swaps
the `get_db` dependency for a test session.
"""

import os
from collections.abc import Generator

# The mock Claude pauses between streamed pieces so the typing effect shows
# locally. Tests have no one watching. Set before the settings are built.
os.environ.setdefault("CHAT_MOCK_DELAY_MS", "0")

# The tests never see a real credential. Settings also read the developer's
# `.env`, and once a real key is there, a test that switches a provider to
# its real implementation without handing in a fake transport would call
# the paid API. An environment variable outranks `.env`, so blanking them
# here is enough — and a test that needs a key sets its own fake one.
for _secret in (
    "ANTHROPIC_API_KEY",
    "HF_CREDENTIALS",
    "GITHUB_CLIENT_SECRET",
    "GOOGLE_CLIENT_SECRET",
):
    os.environ[_secret] = ""
for _provider in ("CLAUDE_PROVIDER", "VIDEO_PROVIDER", "GITHUB_PROVIDER", "YOUTUBE_PROVIDER"):
    os.environ[_provider] = "mock"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402

# Importing the models registers the tables on `Base.metadata`.
# Note the `from app import models` form: writing `import app.models`
# here would rebind the name `app` to the package and shadow the
# FastAPI instance imported above.
from app import models  # noqa: F401, E402


# ---------------------------------------------------------------------
# PostgreSQL (test-database-isolation): a separate test database, never
# the developer's. See tests/pg.py.
# ---------------------------------------------------------------------

_DEVELOPER_DATABASE_BEFORE = None
_REAL_STORAGE_BEFORE: set[str] | None = None



#: Every test client sends JSON by default, as the frontend does: a POST
#: without a non-simple Content-Type is refused (`JsonOnlyMiddleware`,
#: CLAUDE.md §2). Tests of that refusal use a client without this header.
JSON_HEADERS = {"content-type": "application/json"}

def _real_storage_files() -> set[str] | None:
    """Every file under the real storage dir, or None when it is absent.

    The *real* dir: the one the developer's settings point at
    (`backend/var/storage` by default) — exactly what no test may touch.
    """
    from app.core.config import get_settings
    from app.services.storage import storage_root

    root = storage_root(get_settings())
    if not root.exists():
        return None
    return {str(path.relative_to(root)) for path in root.rglob("*") if path.is_file()}


def pytest_sessionstart(session) -> None:
    """Refuse to run against the developer's database; note how it looks."""
    global _DEVELOPER_DATABASE_BEFORE, _REAL_STORAGE_BEFORE
    from app.core.config import get_settings
    from tests import pg

    message = pg.refusal(pg.configured_url(), get_settings().database_url)
    if message:
        raise pytest.UsageError(message)
    _DEVELOPER_DATABASE_BEFORE = pg.snapshot(get_settings().database_url)
    _REAL_STORAGE_BEFORE = _real_storage_files()


def pytest_sessionfinish(session, exitstatus) -> None:
    """The developer's database and storage dir must look as they did before."""
    from app.core.config import get_settings
    from tests import pg

    if _DEVELOPER_DATABASE_BEFORE is not None:
        after = pg.snapshot(get_settings().database_url)
        if after is not None and after != _DEVELOPER_DATABASE_BEFORE:
            session.config.get_terminal_writer().line(
                "The test run changed DATABASE_URL's database "
                f"({pg.shown(get_settings().database_url)}): tables or alembic_version "
                f"before {_DEVELOPER_DATABASE_BEFORE}, after {after}.",
                red=True,
            )
            session.exitstatus = pytest.ExitCode.TESTS_FAILED

    # The same promise for files (fix-beta-blockers 3): no test writes
    # into the real storage dir. `isolated_storage` redirects every test,
    # so a difference here means a new code path resolved the settings
    # some other way — fix that path, never this guard.
    storage_after = _real_storage_files()
    if storage_after != _REAL_STORAGE_BEFORE:
        before = _REAL_STORAGE_BEFORE or set()
        after_files = storage_after or set()
        session.config.get_terminal_writer().line(
            "The test run changed the real storage dir (STORAGE_DIR): "
            f"added {sorted(after_files - before) or '[]'}, "
            f"removed {sorted(before - after_files) or '[]'}.",
            red=True,
        )
        session.exitstatus = pytest.ExitCode.TESTS_FAILED


@pytest.fixture(scope="session")
def pg_engine():
    """The PostgreSQL test database, migrated to head; skips without one.

    Created on the server if missing, emptied and migrated at the start of
    the run, and emptied again at the end.
    """
    from app.core.config import get_settings
    from tests import pg

    url = pg.configured_url()
    app_url = get_settings().database_url
    # The URL checks first — before anything is created on any server.
    # (refusal() also ran at session start; it is part of check_url.)
    try:
        pg.check_url(url, app_url)
    except pg.UnsafeTestDatabase as problem:
        pytest.fail(str(problem), pytrace=False)
    engine = pg.ensure_database(url)
    if engine is None:
        pytest.skip(f"No PostgreSQL test database reachable at {pg.shown(url)}")
    try:
        pg.prove_separate(url, app_url, engine)
    except pg.UnsafeTestDatabase as problem:
        engine.dispose()
        pytest.fail(str(problem), pytrace=False)
    pg.reset_schema(engine)
    pg.migrate(url)
    yield engine
    pg.reset_schema(engine)
    engine.dispose()


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path) -> Generator[None, None, None]:
    """Every test's storage writes land in a throwaway directory.

    Routes resolve settings through `Depends(get_settings)`, so a default
    override here redirects `storage_dir` for every request — tests that
    wrote the mock GIF used to leave it in the real `backend/var/storage`
    (fix-beta-blockers 3). A test file's own `get_settings` override
    (e.g. test_video_download.py) replaces this one for its tests, which
    is fine: those point at their own tmp dir. The session guard in
    `pytest_sessionfinish` proves the real dir stayed untouched.
    """
    from app.core.config import get_settings

    def override() -> object:
        # Copied per request, not once: tests that monkeypatch attributes
        # on the cached settings object (e.g. app_env) must keep working.
        return get_settings().model_copy(update={"storage_dir": str(tmp_path / "test-storage")})

    app.dependency_overrides[get_settings] = override
    yield
    if app.dependency_overrides.get(get_settings) is override:
        app.dependency_overrides.pop(get_settings, None)


@pytest.fixture(autouse=True)
def empty_mock_prompt_cache() -> Generator[None, None, None]:
    """Each test starts with the mock's prompt cache empty.

    It is one cache per process, as Anthropic's is per organisation, so
    without this a test would read what an earlier test wrote.
    """
    from app.services.claude_provider import MOCK_PROMPT_CACHE

    MOCK_PROMPT_CACHE.clear()
    yield
    MOCK_PROMPT_CACHE.clear()


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """A fresh, empty database for a single test."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        # An in-memory SQLite database lives inside one connection, so all
        # sessions must share that single connection.
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    with testing_session() as session:
        # The migration seeds Claude's prices and the exchange rate; the
        # tests build their schema without migrations, so seed them here.
        from app.services.pricing import seed_defaults

        seed_defaults(session)
        session.commit()
        yield session

    Base.metadata.drop_all(bind=engine)
    engine.dispose()


DEV_PASSWORD = "devpassword"
MEMBER_PASSWORD = "memberpassword"
#: A usable invite code (`invite_code` fixture) — signing up needs one.
INVITE_CODE = "TEST-CODE-0001"


@pytest.fixture
def invite_code(db_session: Session):
    """A code good for 50 signups, so tests can sign members up."""
    from app.models import InviteCode

    invite = InviteCode(code=INVITE_CODE, label="테스트", max_uses=50, is_active=True)
    db_session.add(invite)
    db_session.commit()
    db_session.refresh(invite)
    return invite


@pytest.fixture
def anon_client(db_session: Session) -> Generator[TestClient, None, None]:
    """A client with no session cookie — a logged-out visitor."""

    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, headers=JSON_HEADERS) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def client(anon_client: TestClient, dev_user) -> TestClient:
    """A client signed in as the seeded development admin.

    Before Phase 1a, `get_current_user` always resolved this user, so the
    existing tests assumed it. Logging in here keeps that assumption true
    now that authentication is real — the cookie is stored on the client
    and sent with every later request.
    """
    response = anon_client.post(
        "/api/auth/login",
        json={"username": dev_user.username, "password": DEV_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return anon_client


@pytest.fixture
def dev_user(db_session: Session):
    """The seeded development user: an admin, with a known password."""
    from app.db.init_db import seed_dev_user

    return seed_dev_user(db_session, password=DEV_PASSWORD)


@pytest.fixture
def other_user(db_session: Session):
    """A second member, used to prove one member cannot reach another's rows."""
    from app.core.security import hash_password
    from app.models import AccountStatus, User, UserRole

    user = User(
        username="other",
        email="other@ctrl.ai",
        password_hash=hash_password(MEMBER_PASSWORD),
        display_name="Other Member",
        role=UserRole.MEMBER,
        account_status=AccountStatus.ACTIVE,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def participating(db_session: Session, dev_user):
    """Make the development user an active participant in the current quarter.

    Phase 1b gates every paid creation endpoint behind
    `require_active_member`, so a test that creates a project or a version
    must ask for this fixture. Requiring it explicitly is the point: it
    keeps the rule visible in the tests that depend on it rather than
    hiding it inside `client`.
    """
    from datetime import date

    from app.models import MembershipStatus, Quarter, QuarterStatus
    from app.services.quarters import current_quarter, set_membership

    # Attach to whatever quarter the application would consider current,
    # so this never disagrees with require_active_member.
    quarter = current_quarter(db_session)
    if quarter is None:
        quarter = Quarter(
            code="2026-TEST",
            display_name="2026 테스트",
            starts_at=date(2026, 1, 1),
            ends_at=date(2026, 12, 31),
            status=QuarterStatus.ACTIVE,
            subsidy_limit_krw=100_000,
        )
        db_session.add(quarter)
        db_session.flush()

    set_membership(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)
    db_session.commit()
    return quarter


@pytest.fixture
def budgeted(db_session: Session, dev_user, participating):
    """`participating`, plus a 100,000원 동아리 지원 wallet to spend.

    Chat, video generation, editing, extension and the prompt helper all
    spend from this one wallet, so a test that does any of them needs money
    as well as membership. Enough for a dozen placeholder-priced
    generations.
    """
    from app.models import QuarterAllocation

    allocation = QuarterAllocation(
        user_id=dev_user.id,
        quarter_id=participating.id,
        budget_krw=100_000,
    )
    db_session.add(allocation)
    db_session.commit()
    return allocation


@pytest.fixture
def other_participating(db_session: Session, other_user, participating):
    """Make the *second* member an active participant too.

    Needed by any test where `other_user` is the one making the request
    and the route is guarded. Depends on `participating` so both members
    join the same quarter rather than creating a second one.
    """
    from app.models import MembershipStatus
    from app.services.quarters import set_membership

    set_membership(db_session, other_user.id, participating.id, MembershipStatus.ACTIVE)
    db_session.commit()
    return participating


@pytest.fixture
def other_client(anon_client: TestClient, other_user) -> TestClient:
    """A client signed in as the second member, who is NOT an admin."""
    response = anon_client.post(
        "/api/auth/login",
        json={"username": other_user.username, "password": MEMBER_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return anon_client


@pytest.fixture
def video_open(db_session: Session, dev_user):
    """owner-polish 6: the Video Generator opened to members. Locked by
    default — a test where a *member* (not the admin) creates or edits a
    video needs this, exactly as production will."""
    from app.services import feature_switches

    feature_switches.set_open(db_session, dev_user, feature_switches.VIDEO, True, "test")
    db_session.commit()


@pytest.fixture
def video_models(db_session: Session):
    """The seeded video catalogue: two member-visible, one hidden."""
    from app.db.init_db import seed_video_models
    from app.models import VideoModel

    seed_video_models(db_session)
    return list(db_session.query(VideoModel).order_by(VideoModel.sort_order))


@pytest.fixture
def client_without_database() -> Generator[TestClient, None, None]:
    """An HTTP client whose database session always fails.

    Simulates PostgreSQL being down, which is how the `degraded` health
    response is verified.
    """

    class BrokenSession:
        def execute(self, *args: object, **kwargs: object) -> None:
            from sqlalchemy.exc import OperationalError

            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    def override_get_db() -> Generator[BrokenSession, None, None]:
        yield BrokenSession()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, headers=JSON_HEADERS) as test_client:
        yield test_client
    app.dependency_overrides.clear()
