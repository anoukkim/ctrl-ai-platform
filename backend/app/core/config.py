"""Application configuration.

All configuration comes from environment variables (or the root `.env`
file), never from hard-coded values in the code. This is what lets the
same code run locally, in CI, and later in Google Cloud without changes.

`pydantic-settings` reads the environment, validates types, and fails
loudly at startup if something is malformed.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> parents[2] == backend/
BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    """Typed view of the environment.

    Field names map to upper-case environment variables, so `app_env`
    is read from `APP_ENV`.
    """

    model_config = SettingsConfigDict(
        # Absolute paths, so it does not matter which directory the server
        # is started from. The repository root `.env` is the main file; a
        # `backend/.env` may override it if one ever exists.
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        # Ignore variables that belong to other parts of the stack
        # (for example NEXT_PUBLIC_API_BASE_URL) instead of erroring.
        extra="ignore",
    )

    app_env: str = "development"
    backend_port: int = 8000
    frontend_port: int = 3000

    # SQLAlchemy connection URL. The `+psycopg` part selects the psycopg 3
    # driver. Defaults to the local Docker Compose database.
    database_url: str = "postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai"

    # Stored as a plain comma-separated string to keep the `.env` file
    # simple (a list-typed field would require JSON syntax there).
    cors_allow_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Default community subsidy per member per quarter, in KRW. Each
    # quarter stores its own limit, copied from this when it is created,
    # so an admin can change it for a future quarter without touching
    # code and without altering quarters that already ran.
    quarterly_subsidy_limit_krw: int = 100_000

    # ---------- Session cookie ----------
    # Every flag comes from the environment so production can tighten them
    # without a code change (Phase 9).
    session_cookie_name: str = "ctrlai_session"
    # False locally because local development is plain HTTP and a Secure
    # cookie would never be sent. Production sets SESSION_COOKIE_SECURE=true.
    session_cookie_secure: bool = False
    # "lax" keeps the cookie on ordinary navigation while still refusing it
    # on cross-site form posts.
    session_cookie_samesite: str = "lax"
    session_max_age_seconds: int = 60 * 60 * 24 * 14  # two weeks

    # ---------- Seed administrator ----------
    # Read by `python -m app.db.init_db` only. Blank means "no admin to
    # seed", which is why there is no default password anywhere in the code.
    admin_username: str = ""
    admin_email: str = ""
    admin_password: str = ""

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() in {"development", "dev", "local"}

    @property
    def cors_origins(self) -> list[str]:
        """The CORS setting parsed into a list of origins."""
        return [origin.strip() for origin in self.cors_allow_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return the settings, building them only once per process.

    Caching means the `.env` file is read a single time, and every part of
    the application sees exactly the same configuration.
    """
    return Settings()
