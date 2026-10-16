"""feature_switches — the 관리자's run-time switches (owner-polish 6)

The first switch locks the Video Generator for members until the quarter
the owner opens it ("영상은 다음다음분기에 시작할거임"). Append-only like
chat_limits: a new row per change, newest wins, no row = the default in
services/feature_switches.py (video locked), so nothing is seeded.

Revision ID: d7e1f3a9b5c2
Revises: 1cc00c092902
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d7e1f3a9b5c2"
down_revision: str | None = "1cc00c092902"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feature_switches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("note", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("set_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_feature_switches_key", "feature_switches", ["key"])


def downgrade() -> None:
    op.drop_index("ix_feature_switches_key", table_name="feature_switches")
    op.drop_table("feature_switches")
