"""Accounts at other services, and the short-lived rows of a Google sign-in.

google-login (2026-10-13): Google is the main way to sign in.

* `ConnectedAccount` — one row per member per service, the table CLAUDE.md
  section 14 describes. For Google, `provider_account_id` is Google's
  stable account id (`sub`) and is **what links the account**; the email
  is kept only to show which Google account is connected. Phase 7 adds
  the YouTube scope to the same row (incremental authorization) and its
  refresh token, encrypted, in `encrypted_credential`.
* `OAuthState` — one per "Google로 계속하기" press: the `state` value, the
  PKCE verifier, and what the sign-in is for. Single-use, minutes long.
* `PendingGoogleSignup` — a Google identity that has no account yet, held
  while the member chooses a username on the setup screen.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,

    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class ConnectedAccount(TimestampMixin, Base):
    __tablename__ = "connected_accounts"
    __table_args__ = (
        # One Google account belongs to one CTRL+AI account …
        UniqueConstraint("provider", "provider_account_id", name="uq_connected_provider_account"),
        # … and a member connects one Google account.
        UniqueConstraint("user_id", "provider", name="uq_connected_user_provider"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: "google" (later "github").
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    #: Google's `sub` — stable, never reused, unlike an email address.
    provider_account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    #: For display only ("ctrlai.platform@gmail.com로 연결됨"). Never used to match.
    email: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    #: Space-separated scopes granted so far.
    scopes: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    #: Phase 7: the refresh token, encrypted at rest. Empty for sign-in only.
    encrypted_credential: Mapped[str] = mapped_column(Text, default="", nullable=False)


class OAuthState(Base):
    __tablename__ = "oauth_states"

    #: The random `state` sent to Google and kept in an HttpOnly cookie.
    state: Mapped[str] = mapped_column(String(100), primary_key=True)
    code_verifier: Mapped[str] = mapped_column(String(200), nullable=False)
    #: "signin" or "link".
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    #: For "link": the signed-in member who pressed the button.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PendingGoogleSignup(Base):
    __tablename__ = "pending_google_signups"

    #: The random value in the HttpOnly cookie that ties the setup screen to it.
    token: Mapped[str] = mapped_column(String(100), primary_key=True)
    sub: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    name: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )



