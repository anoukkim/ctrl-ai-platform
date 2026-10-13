"""token-guard: the chat_limits table

A new row per change, like exchange_rates; the row in force is the
newest. No seed row — with an empty table the code's defaults apply
(reply cap 100원, warning at 8,000 tokens, daily cap off), so an admin
who never opens the screen still gets the guards.

Revision ID: b5d7f3a2c8e1
Revises: c4d8e2a6f1b9
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b5d7f3a2c8e1"
down_revision: str | None = "c4d8e2a6f1b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_limits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reply_cap_krw", sa.Integer(), nullable=False),
        sa.Column("long_history_tokens", sa.Integer(), nullable=False),
        sa.Column("daily_cap_krw", sa.Integer(), nullable=False),
        sa.Column(
            "set_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    # A capped reply is marked on the message itself, so the notice
    # survives a reload (and history shows why a reply stopped).
    op.add_column("chat_messages", sa.Column("capped_krw", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "capped_krw")
    op.drop_table("chat_limits")
