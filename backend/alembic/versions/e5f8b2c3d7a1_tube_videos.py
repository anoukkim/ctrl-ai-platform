"""CtrlAITube: videos, reactions, comments, reports (promo-videos)

* `tube_videos` — the feed's rows: `kind` hosted (a file CTRL+AI serves —
  the club's promo video) or youtube (Phase 8); `official` shown first.
* `tube_reactions` — one member, one kind, one video (a toggle).
* `tube_comments` — comments and one level of replies; the author's
  `deleted_at`, an admin's `hidden_at` + reason.
* `tube_reports` — 신고 of one comment for Admin › Content.

Revision ID: e5f8b2c3d7a1
Revises: c2d9e4f7a1b6
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5f8b2c3d7a1"
down_revision: str | None = "c2d9e4f7a1b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tube_videos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=40), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("official", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("creator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("hosted_desktop_src", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("hosted_mobile_src", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("poster_desktop_src", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("poster_mobile_src", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("youtube_video_id", sa.String(length=40), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("published_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("slug", name="uq_tube_videos_slug"),
    )
    op.create_table(
        "tube_reactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("video_id", sa.Integer(), sa.ForeignKey("tube_videos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("video_id", "user_id", "kind", name="uq_tube_reactions_video_user_kind"),
    )
    op.create_index("ix_tube_reactions_video_id", "tube_reactions", ["video_id"])
    op.create_index("ix_tube_reactions_user_id", "tube_reactions", ["user_id"])
    op.create_table(
        "tube_comments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("video_id", sa.Integer(), sa.ForeignKey("tube_videos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("tube_comments.id", ondelete="CASCADE"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hidden_reason", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_tube_comments_video_id", "tube_comments", ["video_id"])
    op.create_index("ix_tube_comments_user_id", "tube_comments", ["user_id"])
    op.create_table(
        "tube_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        # SET NULL, not CASCADE: an admin's hard delete of the comment keeps
        # the report row (with its excerpt) as the record of what was reported.
        sa.Column("comment_id", sa.Integer(), sa.ForeignKey("tube_comments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reporter_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("excerpt", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_tube_reports_comment_id", "tube_reports", ["comment_id"])


def downgrade() -> None:
    op.drop_index("ix_tube_reports_comment_id", table_name="tube_reports")
    op.drop_table("tube_reports")
    op.drop_index("ix_tube_comments_user_id", table_name="tube_comments")
    op.drop_index("ix_tube_comments_video_id", table_name="tube_comments")
    op.drop_table("tube_comments")
    op.drop_index("ix_tube_reactions_user_id", table_name="tube_reactions")
    op.drop_index("ix_tube_reactions_video_id", table_name="tube_reactions")
    op.drop_table("tube_reactions")
    op.drop_table("tube_videos")
