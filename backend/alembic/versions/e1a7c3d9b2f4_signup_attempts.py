"""signup attempts: the sign-up limits counted in the database

invite-only-signup. The limits were first kept in memory; the server runs
two API workers, so each would have allowed the full limit. Rows older
than a day are pruned by the application.

Revision ID: e1a7c3d9b2f4
Revises: c8e1f4a29d57
Create Date: 2026-10-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e1a7c3d9b2f4"
down_revision: str | None = "c8e1f4a29d57"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "signup_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("address", sa.String(length=64), nullable=False),
        sa.Column("failed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_signup_attempts_address", "signup_attempts", ["address"])
    op.create_index("ix_signup_attempts_created_at", "signup_attempts", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_signup_attempts_created_at", table_name="signup_attempts")
    op.drop_index("ix_signup_attempts_address", table_name="signup_attempts")
    op.drop_table("signup_attempts")
