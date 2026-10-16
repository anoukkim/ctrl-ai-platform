"""ui-improvements — pins, favourites and thumbnail timestamps

Project Builder and Video Generator lists get 고정 (`pinned_at` on the
owner's own rows); CtrlAIApps gets per-member 즐겨찾기 (`app_favorites`);
and the thumbnails of owner-polish 4·5 get their timestamps — the
working copy's on the project, a published version's on the version.
The bytes live in asset storage, never in the database.

Revision ID: a3f7c1d9e2b4
Revises: d7e1f3a9b5c2
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3f7c1d9e2b4"
down_revision: str | None = "d7e1f3a9b5c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("builder_projects", sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("builder_projects", sa.Column("draft_thumbnail_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("builder_project_versions", sa.Column("thumbnail_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("video_projects", sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "app_favorites",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "project_id", sa.Integer(), sa.ForeignKey("builder_projects.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "project_id", name="uq_app_favorites_user_project"),
    )
    op.create_index("ix_app_favorites_user_id", "app_favorites", ["user_id"])
    op.create_index("ix_app_favorites_project_id", "app_favorites", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_app_favorites_project_id", table_name="app_favorites")
    op.drop_index("ix_app_favorites_user_id", table_name="app_favorites")
    op.drop_table("app_favorites")
    op.drop_column("video_projects", "pinned_at")
    op.drop_column("builder_project_versions", "thumbnail_at")
    op.drop_column("builder_projects", "draft_thumbnail_at")
    op.drop_column("builder_projects", "pinned_at")
