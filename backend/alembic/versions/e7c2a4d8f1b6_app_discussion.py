"""ctrlaiapps-reactions: reactions and comments on CtrlAIApps

`app_reactions` (좋아요 · 유용해요 · 흥미로워요, one per member per kind),
`app_comments` (one level of replies; author delete, admin hide), and
`app_comment_reports` (신고 to Admin › Content) — CtrlAITube's shape
(promo-videos), hanging off the Builder project.

Revision ID: e7c2a4d8f1b6
Revises: d3b7f1a9c5e2
Create Date: 2026-10-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7c2a4d8f1b6"
down_revision: str | None = "d3b7f1a9c5e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_reactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("builder_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "user_id", "kind", name="uq_app_reactions_project_user_kind"),
    )
    op.create_index("ix_app_reactions_project_id", "app_reactions", ["project_id"])
    op.create_index("ix_app_reactions_user_id", "app_reactions", ["user_id"])
    op.create_table(
        "app_comments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("builder_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("app_comments.id", ondelete="CASCADE"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hidden_reason", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_app_comments_project_id", "app_comments", ["project_id"])
    op.create_index("ix_app_comments_user_id", "app_comments", ["user_id"])
    op.create_table(
        "app_comment_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("comment_id", sa.Integer(), sa.ForeignKey("app_comments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reporter_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("excerpt", sa.String(300), nullable=False, server_default=""),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_app_comment_reports_comment_id", "app_comment_reports", ["comment_id"])


def downgrade() -> None:
    op.drop_index("ix_app_comment_reports_comment_id", table_name="app_comment_reports")
    op.drop_table("app_comment_reports")
    op.drop_index("ix_app_comments_user_id", table_name="app_comments")
    op.drop_index("ix_app_comments_project_id", table_name="app_comments")
    op.drop_table("app_comments")
    op.drop_index("ix_app_reactions_user_id", table_name="app_reactions")
    op.drop_index("ix_app_reactions_project_id", table_name="app_reactions")
    op.drop_table("app_reactions")
