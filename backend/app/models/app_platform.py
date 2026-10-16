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

P3 adds `ctrlai.db`, the per-app database (`services/app_data.py`):

* `AppDataCollection` — one list of an app, a **(name, kind)** pair:
  "private" (each visitor sees only their own items) or "shared" (everyone
  reads, members write). `posts` private and `posts` shared are two lists,
  so no visitor's first write can decide the kind for anyone else. The
  Builder's 미리보기 has its own
  `space` ("preview"), so trying an app out never writes into the live
  app's data.
* `AppDataItem` — one JSON object (≤ 4 KB) in a collection, with its
  author. An admin can hide one (`hidden_at`); hidden items are gone for
  everyone.
* `AppDataWrite` — one row per write, for the per-visitor rate limit
  (counted across API workers, so it lives in the database).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
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


class AppDataCollection(Base):
    __tablename__ = "app_data_collections"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "space", "name", "kind", name="uq_app_data_collections_project_space_name_kind"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: "app" (the published app) or "preview" (the Builder's 미리보기).
    space: Mapped[str] = mapped_column(String(8), nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    #: "private" or "shared" — part of the collection's identity.
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AppDataItem(Base):
    __tablename__ = "app_data_items"
    __table_args__ = (
        UniqueConstraint("public_id", name="uq_app_data_items_public_id"),
        Index("ix_app_data_items_project_space", "project_id", "space"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    #: The id the app sees — random, so it says nothing about other apps.
    public_id: Mapped[str] = mapped_column(String(16), nullable=False)
    collection_id: Mapped[int] = mapped_column(
        ForeignKey("app_data_collections.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: Kept beside the collection for the per-app quota.
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), nullable=False
    )
    space: Mapped[str] = mapped_column(String(8), nullable=False)
    author_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    #: Bytes of `data` as compact UTF-8 JSON.
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hidden_reason: Mapped[str] = mapped_column(Text, default="", nullable=False)


class AppDataWrite(Base):
    __tablename__ = "app_data_writes"
    __table_args__ = (Index("ix_app_data_writes_user_project_at", "user_id", "project_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
