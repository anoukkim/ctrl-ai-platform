"""feedback images: screenshots attached to a 의견 보내기 note

feedback-screenshots. One row per picture; the bytes live in storage
(`feedback/<user_id>/<id>`). `feedback_id` is NULL while the picture waits
in the dialog, and the note's deletion cascades to its rows.

Revision ID: c2d9e4f7a1b6
Revises: d4e7a1b2c9f0
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c2d9e4f7a1b6"
down_revision: str | None = "d4e7a1b2c9f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feedback_images",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "feedback_id", sa.Integer(), sa.ForeignKey("feedback.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column("media_type", sa.String(length=80), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("stored_size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_feedback_images_user_id", "feedback_images", ["user_id"])
    op.create_index("ix_feedback_images_feedback_id", "feedback_images", ["feedback_id"])


def downgrade() -> None:
    op.drop_index("ix_feedback_images_feedback_id", table_name="feedback_images")
    op.drop_index("ix_feedback_images_user_id", table_name="feedback_images")
    op.drop_table("feedback_images")
