"""chat_limits.provider_concurrency — outgoing provider calls at once

audit-caching-and-distribution (PART F, 2026-10-14): one more guard on
the club's single Anthropic key — how many provider calls one server
process may have in flight. Default 3; the admin sets it beside the
other chat limits. server_default so any existing history rows read 3.

Revision ID: a8d4f1c7e9b3
Revises: f7c3a9e1d5b2
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8d4f1c7e9b3"
down_revision: str | None = "f7c3a9e1d5b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_limits",
        sa.Column("provider_concurrency", sa.Integer(), nullable=False, server_default="3"),
    )


def downgrade() -> None:
    op.drop_column("chat_limits", "provider_concurrency")
