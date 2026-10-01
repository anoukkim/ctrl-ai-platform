"""admin-restructure: provider status board

Revision ID: c3a81f5d7e24
Revises: b904516416bf
Create Date: 2026-10-01 17:40:00.000000

One row per external provider, holding the outcome of the last call. The
Admin 시스템 screen reads it to answer "is this working?", which
configuration alone cannot answer — a key can be present and rejected.

A table rather than process memory because "last successful call" is
useless if it resets every time the server restarts, which during
development is constantly.

The provider's credential is **not** in this table and must never be put
in it. Only whether a call succeeded, and why it failed.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3a81f5d7e24"
down_revision: Union[str, Sequence[str], None] = "b904516416bf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "provider_status",
        # The settings key ("claude", "video", "github", "youtube") is the
        # primary key, so configuration and status cannot drift apart and
        # a provider cannot end up with two rows.
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_label", sa.String(length=80), nullable=False),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_kind", sa.String(length=30), nullable=False),
        sa.Column("last_error_detail", sa.String(length=300), nullable=False),
        sa.PrimaryKeyConstraint("provider"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("provider_status")
