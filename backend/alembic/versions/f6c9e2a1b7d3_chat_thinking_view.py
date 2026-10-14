"""chat-thinking-view: 생각 과정 보기 per conversation, the reply's summary

* `conversations.show_thinking` — off by default.
* `chat_messages.thinking` — the summarized thinking, display only.
* `usage_events.thinking_shown` — so calibration tells the two kinds of
  reply apart.

Revision ID: f6c9e2a1b7d3
Revises: a7c3e9d1f5b2
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f6c9e2a1b7d3"
down_revision: str | None = "a7c3e9d1f5b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("show_thinking", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column("chat_messages", sa.Column("thinking", sa.Text(), nullable=True))
    op.add_column("usage_events", sa.Column("thinking_shown", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("usage_events", "thinking_shown")
    op.drop_column("chat_messages", "thinking")
    op.drop_column("conversations", "show_thinking")
