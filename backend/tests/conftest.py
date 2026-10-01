"""Shared pytest fixtures.

The tests run against a temporary in-memory SQLite database rather than
PostgreSQL, so `pytest` works even when Docker is not running. The
production code is unchanged: FastAPI's dependency override system swaps
the `get_db` dependency for a test session.
"""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app

# Importing the models registers the tables on `Base.metadata`.
# Note the `from app import models` form: writing `import app.models`
# here would rebind the name `app` to the package and shadow the
# FastAPI instance imported above.
from app import models  # noqa: F401


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
        yield session

    Base.metadata.drop_all(bind=engine)
    engine.dispose()


DEV_PASSWORD = "devpassword"
MEMBER_PASSWORD = "memberpassword"


@pytest.fixture
def anon_client(db_session: Session) -> Generator[TestClient, None, None]:
    """A client with no session cookie — a logged-out visitor."""

    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
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
def other_client(anon_client: TestClient, other_user) -> TestClient:
    """A client signed in as the second member, who is NOT an admin."""
    response = anon_client.post(
        "/api/auth/login",
        json={"username": other_user.username, "password": MEMBER_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return anon_client


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
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
