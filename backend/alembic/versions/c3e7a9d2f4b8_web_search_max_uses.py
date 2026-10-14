"""fix-real-web-search: 웹 검색 searches per reply, an admin setting

`chat_limits.web_search_max_uses` (default 5, was a constant 3) — sent
as the web search tool's `max_uses` and reserved by the per-reply cap.

Revision ID: c3e7a9d2f4b8
Revises: b8d4f2a6c1e9
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3e7a9d2f4b8"
down_revision: str | None = "b8d4f2a6c1e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_limits",
        sa.Column("web_search_max_uses", sa.Integer(), server_default="5", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("chat_limits", "web_search_max_uses")
