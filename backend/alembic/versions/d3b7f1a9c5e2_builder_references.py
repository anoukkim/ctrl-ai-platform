"""builder-images: reference pictures (1) and app pictures (2)

`builder_references` — a picture uploaded from the Builder's request box
(📎 or paste), waiting (`generation_id` NULL) until the next plan takes it
and keeps it for that run's file calls. Claude sees it; it is never a
file of the app. Bytes in storage (`builder-ref/<project_id>/<id>`),
re-encoded without metadata.

`builder_assets` (2) — a picture that is part of the app, at a path
under `images/`, served beside the app's files and packed into the ZIP;
one per (project, path); bytes in storage (`builder-asset/<project>/<id>`).

Revision ID: d3b7f1a9c5e2
Revises: c5a8e1f3b7d9
Create Date: 2026-10-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d3b7f1a9c5e2"
down_revision: str | None = "c5a8e1f3b7d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "builder_references",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("builder_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "generation_id", sa.Integer(), sa.ForeignKey("builder_generations.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("media_type", sa.String(80), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("stored_size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_builder_references_project_id", "builder_references", ["project_id"])
    op.create_index("ix_builder_references_user_id", "builder_references", ["user_id"])
    op.create_index("ix_builder_references_generation_id", "builder_references", ["generation_id"])
    op.create_table(
        "builder_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("builder_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("path", sa.String(200), nullable=False),
        sa.Column("media_type", sa.String(80), nullable=False),
        sa.Column("stored_size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "path", name="uq_builder_assets_project_path"),
    )
    op.create_index("ix_builder_assets_project_id", "builder_assets", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_builder_assets_project_id", table_name="builder_assets")
    op.drop_table("builder_assets")
    op.drop_index("ix_builder_references_generation_id", table_name="builder_references")
    op.drop_index("ix_builder_references_user_id", table_name="builder_references")
    op.drop_index("ix_builder_references_project_id", table_name="builder_references")
    op.drop_table("builder_references")
