"""feat-auto-continue: a reply written in several calls lists its usage events

`chat_messages.segment_event_ids` — the usage event of every call the
server made to finish one long reply (owner-polish 11). `usage_event_id`
keeps the first; the receipt adds them all up. Null for a one-call reply.
`chat_messages.stop_note` — why the server stopped continuing, for the
screen after a reload. Null for a reply that ended by itself.

Revision ID: a8c4e2f6b1d9
Revises: c4e8a2d6f0b3
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8c4e2f6b1d9"
down_revision: str | None = "c4e8a2d6f0b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("segment_event_ids", sa.JSON(), nullable=True))
    op.add_column("chat_messages", sa.Column("stop_note", sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "stop_note")
    op.drop_column("chat_messages", "segment_event_ids")
