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

    # ---------- Storage ----------
    # Where generated files live. `local` keeps them in a folder on this
    # machine; Phase 9 adds a cloud backend and flips this, with no route
    # changing (see app/services/storage.py).
    storage_backend: str = "local"
    # Relative paths are resolved against `backend/`, so the server finds
    # the same folder whichever directory it was started from.
    storage_dir: str = "var/storage"

    # ---------- Providers ----------
    # Every external provider sits behind an interface with a mock
    # implementation, and the implementation is chosen here (CLAUDE.md
    # section 20). **Mock is the default**, so the whole platform runs
    # with no keys and no network.
    claude_provider: str = "mock"
    video_provider: str = "mock"
    github_provider: str = "mock"
    youtube_provider: str = "mock"

    # The credentials themselves. An empty value is not an error while the
    # matching provider above is `mock`; it only matters once a real
    # implementation is selected.
    #
    # Nothing reads these to show them. The Admin screen asks only whether
    # a key is *present* — the value never leaves the backend.
    anthropic_api_key: str = ""
    # Only the fallback when the chat model catalogue is empty
    # (chat-model-choice). Members pick the model per conversation from the
    # catalogue in Admin › Claude Models; with any row there, this decides
    # nothing — so it is not required to start.
    anthropic_model: str = ""
    hf_credentials: str = ""
    github_client_secret: str = ""
    google_client_secret: str = ""

    # ---------- Claude ----------
    # How Chat (and the Video prompt helper) call Claude. The model itself
    # comes from the chat model catalogue and is never written into the
    # code; these are the limits around it. Agreed 2026-10-07.
    #
    # "off" turns thinking off where the model allows it (Sonnet 5.5 via
    # `between_tools`; Haiku 4.5 does not think unless asked). Opus 5.5
    # cannot turn it off, so there "off" means adaptive thinking at the
    # effort below. "on" asks for adaptive thinking on every model.
    chat_thinking: str = "off"
    # low / medium / high. Lower effort means fewer tokens per reply.
    chat_effort: str = "low"
    # The most a single reply may produce, thinking included.
    chat_max_output_tokens: int = 4096
    # The most conversation history sent with one message, in (estimated)
    # input tokens. The oldest messages are dropped first.
    chat_context_tokens: int = 16_000
    # Seconds to wait for Claude before giving up on a reply.
    chat_timeout_seconds: float = 60.0
    # The mock provider's pause between streamed chunks, so the typing
    # effect is visible locally. Tests set it to 0.
    chat_mock_delay_ms: int = 25

    # Messages one member may send per minute, across all conversations.
    # Protects the budget from a stuck key or a runaway script.
    chat_rate_limit_per_minute: int = 10

    # ---------- Seed administrator ----------
    # Read by `python -m app.db.init_db` only. Blank means "no admin to
    # seed", which is why there is no default password anywhere in the code.
    admin_username: str = ""
    admin_email: str = ""
    admin_password: str = ""

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() in {"development", "dev", "local"}

    def provider_mode(self, provider: str) -> str:
        """`mock` or the name of the real implementation, for one provider."""
        return {
            "claude": self.claude_provider,
            "video": self.video_provider,
            "github": self.github_provider,
            "youtube": self.youtube_provider,
        }[provider].strip().lower()

    def provider_is_mock(self, provider: str) -> bool:
        return self.provider_mode(provider) == "mock"

    def provider_has_key(self, provider: str) -> bool:
        """Whether a credential is configured — never what it is.

        Returned to the Admin screen as a yes/no. The key itself is not
        exposed by any route, logged, or put in an audit row.
        """
        return bool(
            {
                "claude": self.anthropic_api_key,
                "video": self.hf_credentials,
                "github": self.github_client_secret,
                "youtube": self.google_client_secret,
            }[provider].strip()
        )

    def missing_provider_settings(self) -> list[str]:
        """Settings a selected *real* provider cannot run without.

        Empty while every provider is mock — an empty key is not an error
        then (CLAUDE.md section 19). Checked at startup by `app.main`, so
        a misconfigured server refuses to start instead of failing on the
        first member's message.
        """
        missing: list[str] = []
        if not self.provider_is_mock("claude"):
            if self.provider_mode("claude") != "anthropic":
                missing.append("CLAUDE_PROVIDER (mock 또는 anthropic)")
            if not self.anthropic_api_key.strip():
                missing.append("ANTHROPIC_API_KEY")
        return missing

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
