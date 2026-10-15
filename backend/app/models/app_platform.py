"""CTRL+AI 기능 상자 — sign-in for member apps (app-platform P2).

Three tables, all scoped to one member and one app (a Builder project):

* `AppConsent` — what the member allowed this app ("이 앱이 할 수 있는
  일"), and the stable pseudonymous id the app sees for them
  (`app_user_id`; never their email, username or balance). Revoking keeps
  the row (`revoked_at`) so the history stays.
* `AppLoginCode` — the one-time code (60 s, single use) that carries a
  sign-in from ctrlai.my back to the app's shell. Only its hash is stored.
* `AppSession` — the app-scoped sign-in behind the `ctrlai_app_<slug>`
  cookie. Only its hash is stored. Never the site's session: an app's
  sign-in cannot be used on ctrlai.my, nor the site's on an app.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AppConsent(Base):
    __tablename__ = "app_consents"
    __table_args__ = (
        UniqueConstraint("user_id", "project_id", name="uq_app_consents_user_project"),
        UniqueConstraint("app_user_id", name="uq_app_consents_app_user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: What was allowed: "profile", "ai" (P3 adds "data").
    scopes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    #: The id this app sees for the member — random, stable per app.
    app_user_id: Mapped[str] = mapped_column(String(32), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AppLoginCode(Base):
    __tablename__ = "app_login_codes"
    __table_args__ = (UniqueConstraint("code_hash", name="uq_app_login_codes_code_hash"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    #: The `state` the shell started with; the callback must bring it back
    #: in the browser's own state cookie (login CSRF).
    state_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AppSession(Base):
    __tablename__ = "app_sessions"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_app_sessions_token_hash"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
