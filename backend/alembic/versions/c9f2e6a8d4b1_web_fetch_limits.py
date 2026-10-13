"""tool-cap-defaults: 웹 페이지 읽기 limits become admin settings

Owner decision 2026-10-14 (morning): web fetch is bounded to 1 use per
reply and 10,000 tokens per fetched page, editable in Admin › System ›
채팅 한도. The columns carry server defaults, so an existing admin-written
row gains the new defaults; the per-reply cap's default (100원 → 200원)
needs no migration at all — the table is never seeded and the code's
DEFAULTS apply whenever no row exists.

Revision ID: c9f2e6a8d4b1
Revises: a8d4f1c7e9b3
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9f2e6a8d4b1"
down_revision: str | None = "a8d4f1c7e9b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_limits",
        sa.Column("web_fetch_max_uses", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "chat_limits",
        sa.Column(
            "web_fetch_max_content_tokens",
            sa.Integer(),
            nullable=False,
            server_default="10000",
        ),
    )


def downgrade() -> None:
    op.drop_column("chat_limits", "web_fetch_max_content_tokens")
    op.drop_column("chat_limits", "web_fetch_max_uses")
