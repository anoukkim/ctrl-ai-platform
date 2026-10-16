"""chat-pins: 맨 위에 고정 for conversations

`conversations.pinned_at` — when the member pinned the conversation
(NULL = not pinned), the same 고정 Project Builder and Video Generator
got in ui-improvements (`a3f7c1d9e2b4`). The Chat list shows pinned
conversations first under 고정됨, newest pin first; a pin is not an
edit, so `updated_at` and `last_message_at` are left alone.

Revision ID: b9d2e4f6a8c1
Revises: c3e5a7b9d1f3
Create Date: 2026-10-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b9d2e4f6a8c1"
down_revision: str | None = "c3e5a7b9d1f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("conversations", "pinned_at")
