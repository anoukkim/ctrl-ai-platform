"""google login: connected accounts, OAuth states, pending sign-ups, login attempts

google-login (owner decision 2026-10-13: Google is the main way to sign
in). `connected_accounts` is the table CLAUDE.md section 14 describes; a
Google account is linked by its `sub`. The other two tables hold the
short-lived rows of one sign-in.

Revision ID: f2c8a6d4e1b3
Revises: e1a7c3d9b2f4
Create Date: 2026-10-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2c8a6d4e1b3"
down_revision: str | None = "e1a7c3d9b2f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "connected_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("provider_account_id", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("scopes", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("encrypted_credential", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("provider", "provider_account_id", name="uq_connected_provider_account"),
        sa.UniqueConstraint("user_id", "provider", name="uq_connected_user_provider"),
    )
    op.create_index("ix_connected_accounts_user_id", "connected_accounts", ["user_id"])

    op.create_table(
        "oauth_states",
        sa.Column("state", sa.String(length=100), primary_key=True),
        sa.Column("code_verifier", sa.String(length=200), nullable=False),
        sa.Column("purpose", sa.String(length=20), nullable=False),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "pending_google_signups",
        sa.Column("token", sa.String(length=100), primary_key=True),
        sa.Column("sub", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Failed password sign-ins: the admin's emergency door is rate-limited.
    op.create_table(
        "login_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("address", sa.String(length=64), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_login_attempts_address", "login_attempts", ["address"])
    op.create_index("ix_login_attempts_username", "login_attempts", ["username"])
    op.create_index("ix_login_attempts_created_at", "login_attempts", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_login_attempts_created_at", table_name="login_attempts")
    op.drop_index("ix_login_attempts_username", table_name="login_attempts")
    op.drop_index("ix_login_attempts_address", table_name="login_attempts")
    op.drop_table("login_attempts")
    op.drop_table("pending_google_signups")
    op.drop_table("oauth_states")
    op.drop_index("ix_connected_accounts_user_id", table_name="connected_accounts")
    op.drop_table("connected_accounts")
