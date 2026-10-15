"""app-platform P2: sign-in for member apps, the AI daily cap, the kill switch

* `app_consents` — what a member allowed an app, and the pseudonymous id
  the app sees for them.
* `app_login_codes` — one-time sign-in codes (hashes only).
* `app_sessions` — app-scoped sign-ins behind `ctrlai_app_<slug>` (hashes).
* `builder_projects.sdk_disabled_at` / `sdk_disabled_reason` — an admin
  stopped the app's 기능 상자.
* `chat_limits.app_ai_daily_cap_krw` — AI inside apps, per visitor per KST
  day (2,000원 unless set; 0 = off).

Revision ID: e8b2c4d6f1a3
Revises: d6a1f3c8e2b5
Create Date: 2026-10-15

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e8b2c4d6f1a3"
down_revision: str | None = "d6a1f3c8e2b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_consents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("builder_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("app_user_id", sa.String(length=32), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "project_id", name="uq_app_consents_user_project"),
        sa.UniqueConstraint("app_user_id", name="uq_app_consents_app_user_id"),
    )
    op.create_index("ix_app_consents_user_id", "app_consents", ["user_id"])
    op.create_index("ix_app_consents_project_id", "app_consents", ["project_id"])

    op.create_table(
        "app_login_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("state_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("builder_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("code_hash", name="uq_app_login_codes_code_hash"),
    )
    op.create_index("ix_app_login_codes_user_id", "app_login_codes", ["user_id"])

    op.create_table(
        "app_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("builder_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_app_sessions_token_hash"),
    )
    op.create_index("ix_app_sessions_token_hash", "app_sessions", ["token_hash"])
    op.create_index("ix_app_sessions_user_id", "app_sessions", ["user_id"])
    op.create_index("ix_app_sessions_project_id", "app_sessions", ["project_id"])

    op.add_column(
        "builder_projects", sa.Column("sdk_disabled_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "builder_projects",
        sa.Column("sdk_disabled_reason", sa.String(length=200), nullable=False, server_default=""),
    )
    op.add_column(
        "chat_limits",
        sa.Column("app_ai_daily_cap_krw", sa.Integer(), nullable=False, server_default="2000"),
    )


def downgrade() -> None:
    op.drop_column("chat_limits", "app_ai_daily_cap_krw")
    op.drop_column("builder_projects", "sdk_disabled_reason")
    op.drop_column("builder_projects", "sdk_disabled_at")
    op.drop_index("ix_app_sessions_project_id", table_name="app_sessions")
    op.drop_index("ix_app_sessions_user_id", table_name="app_sessions")
    op.drop_index("ix_app_sessions_token_hash", table_name="app_sessions")
    op.drop_table("app_sessions")
    op.drop_index("ix_app_login_codes_user_id", table_name="app_login_codes")
    op.drop_table("app_login_codes")
    op.drop_index("ix_app_consents_project_id", table_name="app_consents")
    op.drop_index("ix_app_consents_user_id", table_name="app_consents")
    op.drop_table("app_consents")
