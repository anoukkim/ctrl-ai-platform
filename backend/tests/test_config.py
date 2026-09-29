"""Tests for configuration parsing and engine options."""

from app.core.config import Settings
from app.db.session import CONNECT_TIMEOUT_SECONDS, _connect_args


def test_cors_origins_are_split_and_trimmed() -> None:
    settings = Settings(cors_allow_origins="http://a.test, http://b.test ,")

    assert settings.cors_origins == ["http://a.test", "http://b.test"]


def test_is_development_flag() -> None:
    assert Settings(app_env="development").is_development is True
    assert Settings(app_env="production").is_development is False


def test_database_url_defaults_to_local_postgres() -> None:
    assert Settings().database_url.startswith("postgresql+psycopg://")


def test_postgres_urls_get_a_connect_timeout() -> None:
    """A stopped database must fail fast, not hang the health endpoint."""
    args = _connect_args("postgresql+psycopg://user:pw@localhost:5432/db")

    assert args == {"connect_timeout": CONNECT_TIMEOUT_SECONDS}


def test_sqlite_urls_get_no_postgres_options() -> None:
    """`connect_timeout` is not a valid SQLite option."""
    assert _connect_args("sqlite://") == {}
