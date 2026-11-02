"""signup-google-first: password reset grants

`password_reset_grants` — one row per "비밀번호를 잊었어요": a fresh Google
sign-in proves who the member is, and the row lets them set a new
password within ten minutes, once (`used_at`). Nothing else changes:
sign-up becoming Google-only and the setup screen asking for a password
are route changes, not schema ones.

Revision ID: a1c4e7b9d2f6
Revises: f3b7d1a9c5e2
Create Date: 2026-11-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c4e7b9d2f6"
down_revision: str | None = "f3b7d1a9c5e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "password_reset_grants",
        sa.Column("token", sa.String(length=100), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token"),
    )
    op.create_index(
        op.f("ix_password_reset_grants_user_id"), "password_reset_grants", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_password_reset_grants_user_id"), table_name="password_reset_grants")
    op.drop_table("password_reset_grants")
