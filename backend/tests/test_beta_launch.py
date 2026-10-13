"""prep-beta-launch: what changes when APP_ENV is beta (or production).

Point 5 of the spec asks for tests of: the beta banner and test-mode
labels, disabled top-ups, dev tools unavailable outside development,
feedback saved, and production refusing default admin passwords. The
Launch data rules add: the dev seed refuses outside development, the
server starts empty but for the admin, and the local reset script never
touches anything but a local development database.

The banner and labels are drawn by the frontend from `GET /api/site`;
these tests prove the backend's answer, and the frontend tests prove the
screens follow it.
"""

import os
import subprocess
import sys
from collections.abc import Generator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import (
    ADMIN_PASSWORD_PLACEHOLDER,
    BACKEND_DIR,
    Settings,
    get_settings,
)
from app.db.base import Base
from app.main import app
from app.models import (
    FEEDBACK_PER_HOUR,
    Feedback,
    PersonalTopUp,
    TopUpStatus,
    User,
    VideoModel,
)

STRONG_PASSWORD = "a-real-admin-passphrase-2026"


@pytest.fixture
def as_env():
    """Run requests under different settings: `as_env(app_env="beta")`."""

    def apply(**overrides) -> None:
        app.dependency_overrides[get_settings] = lambda: Settings(**overrides)

    yield apply
    app.dependency_overrides.pop(get_settings, None)


# --------------------------------------------------------------------- /api/site


def test_site_in_development_shows_no_banner_and_no_labels(anon_client: TestClient) -> None:
    body = anon_client.get("/api/site").json()

    assert body["is_development"] is True
    assert body["is_beta"] is False
    assert body["top_ups_enabled"] is True
    # Everything is a mock locally and everyone knows it — no labels.
    assert body["test_mode"] == {
        "chat": False,
        "builder": False,
        "video": False,
        "community": False,
    }


def test_site_in_beta_turns_on_banner_and_labels_for_every_mock(
    anon_client: TestClient, as_env
) -> None:
    as_env(app_env="beta")
    body = anon_client.get("/api/site").json()

    assert body["is_beta"] is True
    assert body["is_development"] is False
    assert body["top_ups_enabled"] is False
    assert body["test_mode"] == {
        "chat": True,
        "builder": True,
        "video": True,
        "community": True,
    }


def test_real_claude_takes_the_label_off_chat_only(anon_client: TestClient, as_env) -> None:
    as_env(app_env="beta", claude_provider="anthropic", anthropic_api_key="sk-test")
    test_mode = anon_client.get("/api/site").json()["test_mode"]

    assert test_mode["chat"] is False
    assert test_mode["builder"] is False
    # Video is still a mock, and must still say so.
    assert test_mode["video"] is True


def test_data_location_notice_defaults_to_seoul_and_is_editable(
    anon_client: TestClient, as_env
) -> None:
    assert "asia-northeast3" in Settings().data_location_notice

    as_env(data_location_notice="  다른 곳에 저장됩니다.  ")
    assert anon_client.get("/api/site").json()["data_location_notice"] == "다른 곳에 저장됩니다."


def test_site_needs_no_sign_in(anon_client: TestClient) -> None:
    """The sign-up screen reads the notice before anyone has an account."""
    assert anon_client.get("/api/site").status_code == 200


# ----------------------------------------------------------------- top-ups off


def test_top_ups_are_refused_in_beta(client: TestClient, as_env, db_session: Session) -> None:
    as_env(app_env="beta")

    response = client.post("/api/quarters/me/top-ups", json={"amount_krw": 10_000})

    assert response.status_code == 403
    assert "베타" in response.json()["detail"]
    assert db_session.scalar(select(PersonalTopUp)) is None


def test_top_ups_still_work_in_development(client: TestClient) -> None:
    response = client.post("/api/quarters/me/top-ups", json={"amount_krw": 10_000})
    assert response.status_code == 201, response.text


def test_personal_spending_cannot_be_switched_on_in_beta(client: TestClient, as_env) -> None:
    as_env(app_env="beta")

    on = client.patch("/api/quarters/me/wallet", json={"overage_enabled": True})
    assert on.status_code == 403

    # Switching it off is always allowed.
    off = client.patch("/api/quarters/me/wallet", json={"overage_enabled": False})
    assert off.status_code == 200, off.text


def test_admin_cannot_confirm_a_top_up_in_beta(
    client: TestClient, as_env, db_session: Session, dev_user
) -> None:
    top_up = PersonalTopUp(
        user_id=dev_user.id,
        amount_krw=10_000,
        status=TopUpStatus.REQUESTED,
        requested_at=datetime.now(timezone.utc),
    )
    db_session.add(top_up)
    db_session.commit()

    as_env(app_env="beta")
    confirmed = client.post(f"/api/admin/top-ups/{top_up.id}/confirm", json={"confirm": True})
    assert confirmed.status_code == 403

    # A request made before the beta can still be turned down.
    rejected = client.post(f"/api/admin/top-ups/{top_up.id}/confirm", json={"confirm": False})
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "rejected"


# ------------------------------------------------------- dev tools unavailable


def test_simulator_is_gone_in_beta(client: TestClient, as_env) -> None:
    as_env(app_env="beta")
    assert client.post("/api/admin/simulate-usage", json={"amount_krw": 1000}).status_code == 404


def test_dashboard_tells_the_frontend_to_hide_dev_tools_in_beta(
    client: TestClient, as_env
) -> None:
    as_env(app_env="beta")
    assert client.get("/api/admin/dashboard").json()["is_development"] is False


def test_dev_seed_refuses_outside_development(monkeypatch) -> None:
    from app.db import init_db

    for env in ("beta", "production"):
        monkeypatch.setattr(init_db, "get_settings", lambda env=env: Settings(app_env=env))
        with pytest.raises(SystemExit) as stopped:
            init_db.main()
        assert "Refusing to run" in str(stopped.value)


def test_reset_script_refuses_anything_but_a_local_development_database() -> None:
    from app.db import reset_dev

    def refusal(**overrides) -> str | None:
        reset_dev.get_settings = lambda: Settings(**overrides)
        try:
            return reset_dev.refusal()
        finally:
            reset_dev.get_settings = get_settings

    assert refusal(app_env="beta") is not None
    assert refusal(app_env="production") is not None
    assert (
        refusal(
            app_env="development",
            database_url="postgresql+psycopg://ctrlai:pw@db.example.com:5432/ctrlai",
        )
        is not None
    )
    assert refusal(app_env="development", database_url="sqlite://") is not None
    assert (
        refusal(
            app_env="development",
            database_url="postgresql+psycopg://ctrlai:ctrlai@127.0.0.1:5432/ctrlai",
        )
        is None
    )


def _import_app(**env: str) -> subprocess.CompletedProcess[str]:
    """Import `app.main` in a fresh interpreter under these variables.

    The checks run once, at import, so they can only be seen from a new
    process. Variables given here outrank the developer's `.env`.
    """
    clean = {
        **os.environ,
        "CLAUDE_PROVIDER": "mock",
        "ANTHROPIC_API_KEY": "",
        "ADMIN_PASSWORD": "",
        "DEPLOYED": "false",
        **env,
    }
    return subprocess.run(
        [
            sys.executable,
            "-c",
            "import app.main as m; print('docs', m.app.docs_url, m.app.openapi_url)",
        ],
        cwd=BACKEND_DIR,
        env=clean,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_api_docs_exist_only_in_development() -> None:
    development = _import_app(APP_ENV="development")
    assert development.returncode == 0, development.stderr
    assert "docs /docs /openapi.json" in development.stdout

    beta = _import_app(APP_ENV="beta")
    assert beta.returncode == 0, beta.stderr
    assert "docs None None" in beta.stdout


# ----------------------------------------------------- default admin passwords


@pytest.mark.parametrize(
    "password",
    ["devpassword", "admin", "password", "PASSWORD", ADMIN_PASSWORD_PLACEHOLDER, "short-pw"],
)
def test_deployed_settings_refuse_a_default_admin_password(password: str) -> None:
    for env in ("beta", "production"):
        problems = Settings(app_env=env, admin_password=password).startup_problems()
        assert any("ADMIN_PASSWORD" in problem for problem in problems), (env, password)


def test_a_real_admin_password_is_accepted() -> None:
    assert Settings(app_env="beta", admin_password=STRONG_PASSWORD).startup_problems() == []
    # Blank is fine: the admin was created earlier and the line removed.
    assert Settings(app_env="beta", admin_password="").startup_problems() == []


def test_development_keeps_its_development_password() -> None:
    assert Settings(app_env="development", admin_password="devpassword").startup_problems() == []


def test_a_deployed_server_left_in_development_mode_is_refused() -> None:
    problems = Settings(app_env="development", deployed=True).startup_problems()
    assert any("development" in problem for problem in problems)


def test_the_server_really_refuses_to_start_with_a_default_password() -> None:
    result = _import_app(APP_ENV="production", ADMIN_PASSWORD="devpassword")

    assert result.returncode != 0
    assert "Refusing to start" in result.stderr
    assert "ADMIN_PASSWORD" in result.stderr


# ------------------------------------------------------------------- bootstrap


@pytest.fixture
def bootstrap_db(monkeypatch) -> Generator[sessionmaker, None, None]:
    """The bootstrap script pointed at a throwaway database.

    The script uses the application's own engine; here that engine is
    swapped for an in-memory one so the test can never reach the
    developer's database.
    """
    from app.db import bootstrap, init_db
    from app.services.pricing import seed_defaults

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as session:
        seed_defaults(session)
        session.commit()

    monkeypatch.setattr(bootstrap, "engine", engine)
    monkeypatch.setattr(bootstrap, "SessionLocal", factory)

    def use(**overrides) -> None:
        settings = Settings(**overrides)
        monkeypatch.setattr(bootstrap, "get_settings", lambda: settings)
        monkeypatch.setattr(init_db, "get_settings", lambda: settings)

    factory.use = use  # type: ignore[attr-defined]
    yield factory
    engine.dispose()


def test_bootstrap_creates_the_admin_and_nothing_else(bootstrap_db) -> None:
    from app.db import bootstrap

    bootstrap_db.use(
        app_env="beta",
        admin_username="clubadmin",
        admin_email="admin@ctrlai.my",
        admin_password=STRONG_PASSWORD,
    )
    assert bootstrap.main() == 0
    # Twice is safe.
    assert bootstrap.main() == 0

    with bootstrap_db() as db:
        users = list(db.scalars(select(User)))
        assert [user.username for user in users] == ["clubadmin"]
        assert users[0].role.value == "admin"
        # The catalogue Admin › Video Models edits — reference data, not work.
        assert db.scalar(select(VideoModel).limit(1)) is not None
        assert db.scalar(select(Feedback)) is None


def test_bootstrap_refuses_a_default_password(bootstrap_db) -> None:
    from app.db import bootstrap

    bootstrap_db.use(
        app_env="beta",
        admin_username="clubadmin",
        admin_email="admin@ctrlai.my",
        admin_password="devpassword",
    )
    assert bootstrap.main() == 1
    with bootstrap_db() as db:
        assert db.scalar(select(User)) is None


def test_bootstrap_refuses_a_copied_local_database(bootstrap_db) -> None:
    from app.db import bootstrap
    from app.db.init_db import seed_dev_user

    with bootstrap_db() as db:
        seed_dev_user(db)

    bootstrap_db.use(
        app_env="beta",
        admin_username="clubadmin",
        admin_email="admin@ctrlai.my",
        admin_password=STRONG_PASSWORD,
    )
    assert bootstrap.main() == 1
    with bootstrap_db() as db:
        assert db.scalar(select(User).where(User.username == "clubadmin")) is None


# -------------------------------------------------------------------- feedback


def test_feedback_is_saved_and_listed_for_admin(
    client: TestClient, db_session: Session, dev_user
) -> None:
    sent = client.post("/api/feedback", json={"body": "  영상 화면이 느려요.  ", "page": "/video"})
    assert sent.status_code == 201, sent.text

    row = db_session.scalar(select(Feedback))
    assert row is not None
    assert row.body == "영상 화면이 느려요."
    assert row.page == "/video"
    assert row.user_id == dev_user.id

    listed = client.get("/api/admin/feedback").json()
    assert listed[0]["body"] == "영상 화면이 느려요."
    assert listed[0]["username"] == dev_user.username


def test_a_member_who_is_not_participating_can_still_send_feedback(
    other_client: TestClient,
) -> None:
    """`other_user` has no membership row this quarter."""
    sent = other_client.post("/api/feedback", json={"body": "참여 신청은 어디서 하나요?"})
    assert sent.status_code == 201, sent.text


def test_only_admins_read_feedback(other_client: TestClient) -> None:
    assert other_client.get("/api/admin/feedback").status_code == 403


def test_feedback_needs_sign_in(anon_client: TestClient) -> None:
    assert anon_client.post("/api/feedback", json={"body": "안녕"}).status_code == 401


def test_empty_or_long_feedback_is_refused_in_korean(client: TestClient) -> None:
    empty = client.post("/api/feedback", json={"body": "   "})
    assert empty.status_code == 400
    assert empty.json()["detail"] == "내용을 적어 주세요."

    long = client.post("/api/feedback", json={"body": "가" * 2001})
    assert long.status_code == 400


def test_feedback_is_rate_limited(client: TestClient, db_session: Session, dev_user) -> None:
    now = datetime.now(timezone.utc)
    db_session.add_all(
        Feedback(user_id=dev_user.id, body="x", page="", created_at=now - timedelta(minutes=1))
        for _ in range(FEEDBACK_PER_HOUR)
    )
    db_session.commit()

    assert client.post("/api/feedback", json={"body": "한 번 더"}).status_code == 429


# ---------------------------------------------------------------- cookie domain


def test_session_cookie_is_host_only_unless_a_domain_is_set(
    anon_client: TestClient, dev_user, as_env
) -> None:
    from tests.conftest import DEV_PASSWORD

    login = {"username": dev_user.username, "password": DEV_PASSWORD}

    host_only = anon_client.post("/api/auth/login", json=login)
    assert "domain=" not in host_only.headers["set-cookie"].lower()

    as_env(session_cookie_domain="ctrlai.my")
    scoped = anon_client.post("/api/auth/login", json=login)
    assert "domain=ctrlai.my" in scoped.headers["set-cookie"].lower()
