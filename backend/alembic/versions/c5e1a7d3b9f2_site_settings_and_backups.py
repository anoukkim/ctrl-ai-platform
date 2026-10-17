"""admin-consolidation v3 (4): site_settings and backup_runs

`site_settings` holds the top strip (공지 띠) and the Dashboard's alert
thresholds as history — the newest row per key is in force, no row
means the code's default. `backup_runs` records each finished backup the
deploy scripts report, so Admin › System can show the last one.

Revision ID: c5e1a7d3b9f2
Revises: a4c8e2b6d1f3
Create Date: 2026-10-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c5e1a7d3b9f2"
down_revision: str | None = "a4c8e2b6d1f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "site_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("value", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("set_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_site_settings_key", "site_settings", ["key"])
    op.create_table(
        "backup_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("file_name", sa.String(length=200), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_backup_runs_kind", "backup_runs", ["kind"])


def downgrade() -> None:
    op.drop_index("ix_backup_runs_kind", table_name="backup_runs")
    op.drop_table("backup_runs")
    op.drop_index("ix_site_settings_key", table_name="site_settings")
    op.drop_table("site_settings")
