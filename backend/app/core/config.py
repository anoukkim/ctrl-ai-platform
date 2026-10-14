"""Application configuration.

All configuration comes from environment variables (or the root `.env`
file), never from hard-coded values in the code. This is what lets the
same code run locally, in CI, and later in Google Cloud without changes.

`pydantic-settings` reads the environment, validates types, and fails
loudly at startup if something is malformed.
"""

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

# backend/app/core/config.py -> parents[2] == backend/
BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent

#: What `.env.example` ships in ADMIN_PASSWORD. Refused outside development
#: together with the passwords anyone would try first.
ADMIN_PASSWORD_PLACEHOLDER = "change-me-before-deploying"

#: Known defaults: the development seed's password, the obvious guesses,
#: and the placeholder above. Compared case-insensitively.
DEFAULT_ADMIN_PASSWORDS = frozenset(
    {
        "devpassword",
        "admin",
        "password",
        "memberpassword",
        "changeme",
        "change-me",
        ADMIN_PASSWORD_PLACEHOLDER,
    }
)

#: Database passwords a deployed server refuses: the development default
#: from .env.example and docker-compose.yml, and the obvious ones.
DEFAULT_DATABASE_PASSWORDS = frozenset({"", "ctrlai", "postgres", "password"})

#: The shortest administrator password a deployed server accepts.
MIN_ADMIN_PASSWORD_LENGTH = 12


def admin_password_problem(password: str) -> str | None:
    """Why this password must not guard a deployed admin account, or None."""
    if password.strip().lower() in DEFAULT_ADMIN_PASSWORDS:
        return "is a known default"
    if len(password) < MIN_ADMIN_PASSWORD_LENGTH:
        return f"is shorter than {MIN_ADMIN_PASSWORD_LENGTH} characters"
    return None


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

    # development / beta / production. Beta and production are both
    # "deployed": no dev tools, no dev seed, no API docs. Beta adds the
    # banner and turns off personal top-ups (prep-beta-launch).
    app_env: str = "development"
    # 개인 충전. Off everywhere until the owner decides real money may
    # move (personal-topup-off, 2026-10-14); the tables and routes stay,
    # refusing with a Korean message. personal-topup-ui turns it back on.
    personal_topup_enabled: bool = False
    # Admin > Budget shows the month's Anthropic spend (USD, summed from
    # provider_cost) against this figure, warning at 80%. Empty = no bar.
    # Informational only — the real stop is the Console's own monthly
    # limit (audit-caching-and-distribution).
    anthropic_monthly_budget_usd: str = ""
    # Reconciliation (cost-clarity): an Anthropic **Admin** API key lets
    # Admin > Budget compare our recorded cost with Anthropic's own cost
    # report. Optional and never required; the mock answers with our own
    # ledger. Only read when ANTHROPIC_ADMIN_PROVIDER=anthropic.
    anthropic_admin_provider: str = "mock"
    anthropic_admin_api_key: str = ""
    backend_port: int = 8000
    frontend_port: int = 3000

    # Set to true by docker-compose.prod.yml, never by hand. A server
    # started from the production compose file with APP_ENV=development
    # (a `.env` copied from .env.example and not edited) would switch the
    # dev tools on in public; this makes that a refusal to start instead.
    deployed: bool = False

    # SQLAlchemy connection URL. The `+psycopg` part selects the psycopg 3
    # driver. Defaults to the local Docker Compose database.
    database_url: str = "postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai"

    # Connections each API worker keeps open, and how many more it may open
    # under load. Chosen for the beta's e2-medium (2 vCPU, 4 GB) and about
    # 40 members: 2 workers x (5 + 5) = 20 at most, well under PostgreSQL's
    # max_connections=50 in docker-compose.prod.yml, leaving room for
    # migrations, the cron job and a psql session.
    db_pool_size: int = 5
    db_max_overflow: int = 5

    # Stored as a plain comma-separated string to keep the `.env` file
    # simple (a list-typed field would require JSON syntax there).
    cors_allow_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Default 동아리 지원 per participating member per quarter, in KRW —
    # the one wallet every paid feature spends from (single-wallet). Each
    # quarter stores its own amount, copied from this when it is created,
    # so an admin can change it for a future quarter without touching
    # code and without altering quarters that already ran.
    quarterly_subsidy_limit_krw: int = 80_000

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
    # Blank means a host-only cookie: sent to ctrlai.my and nowhere else,
    # not even to a subdomain. That is what the beta wants — the browser
    # only ever talks to the main domain. Set it only if a subdomain must
    # share the sign-in.
    session_cookie_domain: str = ""

    # ---------- Site ----------
    # Shown on the sign-up screen: where members' data is kept. Editable
    # here, so moving the database to another region is a `.env` change
    # and not a code change.
    data_location_notice: str = (
        "회원님의 정보는 Google Cloud 서울 리전(asia-northeast3)에 저장됩니다."
    )

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
    # catalogue in Admin › AI Models; with any row there, this decides
    # nothing — so it is not required to start.
    anthropic_model: str = ""
    hf_credentials: str = ""
    github_client_secret: str = ""
    google_client_secret: str = ""

    # ---------- Google sign-in (google-login) ----------
    # "mock" (the default) or "google". The mock is offered in development
    # only: anywhere else it would let a visitor claim any Google account,
    # so on a server Google sign-in stays hidden until this is "google".
    google_login_provider: str = "mock"
    # From the Google Cloud console's OAuth client (docs/deployment.md).
    # The secret above (GOOGLE_CLIENT_SECRET) is shared with Phase 7.
    google_client_id: str = ""
    # Must match a redirect URI registered on that client exactly, e.g.
    # https://ctrlai.my/api/auth/google/callback.
    google_redirect_uri: str = ""

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
    # input tokens. The oldest messages are dropped first — at fixed cut
    # points, so the cached prefix stays the same for many turns.
    chat_context_tokens: int = 16_000
    # Seconds to wait for Claude before giving up on a reply.
    chat_timeout_seconds: float = 60.0

    # Chat attachments (chat-plus-files). Limits are refused, never
    # truncated: a silently cut table gives a confident wrong answer.
    chat_attachments_per_message: int = 5
    chat_attachment_image_max_mb: int = 10
    chat_attachment_pdf_max_mb: int = 10
    chat_attachment_pdf_max_pages: int = 30
    chat_attachment_text_max_mb: int = 1
    # Per member, all their attachments together.
    chat_attachment_member_quota_mb: int = 200
    # Every attachment on this server together. The beta VM has a 30 GB
    # disk; uploads are refused past this, and Admin's dashboard shows it.
    chat_attachment_total_limit_gb: int = 5
    # The most attachment tokens one request may carry (they are resent
    # every turn while in the history). Older messages with files drop out
    # of the context first; one message's files must fit on their own.
    chat_attachment_context_tokens: int = 150_000
    # The mock provider's pause between streamed chunks, so the typing
    # effect is visible locally. Tests set it to 0.
    chat_mock_delay_ms: int = 25

    # Prompt caching (prompt-caching, 2026-10-13). Each Chat request marks
    # the system prompt and the conversation so far as cacheable; the next
    # turn re-reads them at the cache-read price (about a tenth of the
    # input price) instead of paying for them again. Off sends no marker.
    chat_prompt_cache: bool = True
    # "5m" (writes cost 1.25x the input price) or "1h" (2x). A cache read
    # refreshes the timer, so 5m stays warm while a member keeps chatting;
    # 1h only pays off for pauses of 5-60 minutes.
    chat_cache_ttl: str = "5m"

    # Project Builder's generations (예시 앱, and 만들기 / 고치기 since
    # builder-static-runtime): the most one generation may write, and how
    # long to wait for it. 16,000 tokens is a whole small app rewritten
    # (≈ 230원 on Sonnet); the pre-check reserves all of it.
    builder_max_output_tokens: int = 16000
    builder_timeout_seconds: float = 180.0

    # ---------- Member apps (builder-static-runtime) ----------
    # Where 미리보기 갱신 writes each project's files, one folder per app
    # slug. Relative paths are resolved against `backend/`. On the server
    # it is the `apps_data` volume, which Caddy serves read-only.
    apps_dir: str = "var/apps"
    # The origin that serves that folder: https://apps.ctrlai.my on the
    # server (docker-compose.prod.yml sets it), http://localhost:8300 with
    # `python -m app.dev_apps_server` locally. Blank turns the runtime off:
    # the preview then runs the files inside the page (srcdoc) as before.
    apps_base_url: str = ""
    # All apps together may use this much of the disk (spec: ≤ 2 GB).
    apps_max_total_mb: int = 2048

    # Messages one member may send per minute, across all conversations.
    # Protects the budget from a stuck key or a runaway script.
    chat_rate_limit_per_minute: int = 10

    # ---------- Sign-up (invite-only-signup) ----------
    # Per client address, counted in the database (`services/rate_limit.py`).
    # Generous enough for a club signing up together from one office
    # network, which shares one public address; tight on failed codes,
    # because guessing codes is what the limit is for.
    signup_attempts_per_hour: int = 30
    invite_failures_per_15_minutes: int = 10
    # Failed password sign-ins per address, and per username, in 15 minutes.
    # Password sign-in is the admin's emergency door (google-login).
    login_failures_per_15_minutes: int = 10
    # Peers whose X-Forwarded-For is believed: the Next.js server (and, in
    # production, the reverse proxy). Comma-separated addresses or networks.
    trusted_proxies: str = "127.0.0.1,::1"

    # ---------- Seed administrator ----------
    # Read by `python -m app.db.init_db` only. Blank means "no admin to
    # seed", which is why there is no default password anywhere in the code.
    admin_username: str = ""
    admin_email: str = ""
    admin_password: str = ""

    @property
    def cache_ttl(self) -> str | None:
        """The TTL to send ("5m" / "1h"), or None when caching is off."""
        if not self.chat_prompt_cache:
            return None
        return "1h" if self.chat_cache_ttl.strip().lower() == "1h" else "5m"

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() in {"development", "dev", "local"}

    @property
    def is_beta(self) -> bool:
        """The invite-only beta: a deployed site with a banner on every page."""
        return self.app_env.strip().lower() == "beta"

    @property
    def monthly_budget_usd(self) -> "Decimal | None":
        """ANTHROPIC_MONTHLY_BUDGET_USD as a number, or None when unset."""
        from decimal import Decimal, InvalidOperation

        raw = self.anthropic_monthly_budget_usd.strip()
        if not raw:
            return None
        try:
            value = Decimal(raw)
        except InvalidOperation:
            return None
        return value if value > 0 else None

    @property
    def top_ups_enabled(self) -> bool:
        """Whether members may add or spend personal money.

        An explicit setting, **off by default in every environment**
        (personal-topup-off, owner 2026-10-14): members see only the
        동아리 지원 wallet until the owner turns this on
        (personal-topup-ui). The beta forces it off besides — no real
        money moves while the site is a test.
        """
        return self.personal_topup_enabled and not self.is_beta

    @property
    def apps_origin(self) -> str | None:
        """The member apps' origin, or None while the runtime is off."""
        base = self.apps_base_url.strip().rstrip("/")
        if not base:
            return None
        parts = urlsplit(base)
        return f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else None

    @property
    def cookie_domain(self) -> str | None:
        """The session cookie's Domain attribute, or None for host-only."""
        return self.session_cookie_domain.strip() or None

    def startup_problems(self) -> list[str]:
        """Reasons this configuration must not serve requests.

        Checked by `app.main` at import, so a misconfigured server refuses
        to start instead of running in public with a default password or
        the dev tools switched on.
        """
        problems = [
            "A real provider is selected but this setting is missing: " + name
            for name in self.missing_provider_settings()
        ]
        if self.is_development:
            if self.deployed:
                problems.append(
                    "APP_ENV is development on a deployed server. Set APP_ENV=beta "
                    "(or production) in .env."
                )
            return problems

        url = make_url(self.database_url)
        if url.get_backend_name() == "postgresql" and (url.password or "") in DEFAULT_DATABASE_PASSWORDS:
            problems.append(
                "POSTGRES_PASSWORD is the development default. Set a long random one in .env."
            )

        # apps.ctrlai.my is same-site with ctrlai.my (CLAUDE.md §2): a
        # Domain cookie would be sent to every member app.
        if self.session_cookie_domain.strip():
            problems.append(
                "SESSION_COOKIE_DOMAIN must stay empty: the session cookie is host-only, "
                "so member apps on apps.<domain> never receive it."
            )
        if self.apps_origin and self.apps_origin in self.cors_origins:
            problems.append(
                "CORS_ALLOW_ORIGINS must not list the member apps' origin (APPS_BASE_URL)."
            )

        if self.admin_password:
            problem = admin_password_problem(self.admin_password)
            if problem:
                problems.append(f"ADMIN_PASSWORD {problem}. Choose a real password in .env.")
        return problems

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
        admin_report = self.anthropic_admin_provider.strip().lower()
        if admin_report not in {"mock", "anthropic"}:
            missing.append("ANTHROPIC_ADMIN_PROVIDER (mock 또는 anthropic)")
        elif admin_report == "anthropic" and not self.anthropic_admin_api_key.strip():
            missing.append("ANTHROPIC_ADMIN_API_KEY")
        google = self.google_login_provider.strip().lower()
        if google not in {"mock", "google"}:
            missing.append("GOOGLE_LOGIN_PROVIDER (mock 또는 google)")
        elif google == "google":
            for name, value in (
                ("GOOGLE_CLIENT_ID", self.google_client_id),
                ("GOOGLE_CLIENT_SECRET", self.google_client_secret),
                ("GOOGLE_REDIRECT_URI", self.google_redirect_uri),
            ):
                if not value.strip():
                    missing.append(name)
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
