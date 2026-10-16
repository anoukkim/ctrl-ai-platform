"""feat-notifications — a member's own notification list (owner-polish 2)

`notifications`: one row per event that concerns the member (게시 완료,
참여 신청 승인, 지원금 사용 요약, 앱 게시 내림), written by the server when
it happens, read and marked read by the member. `dedupe_key` is unique per
member so a daily summary is written once; rows older than 90 days are
removed when the member next reads the list.

Revision ID: c4e8a2d6f0b3
Revises: b2d4f6a8c0e1
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4e8a2d6f0b3"
down_revision: str | None = "b2d4f6a8c0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.String(length=600), nullable=False, server_default=""),
        sa.Column("link", sa.String(length=300), nullable=True),
        sa.Column("dedupe_key", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "dedupe_key", name="uq_notification_dedupe"),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_notifications_user_created", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
