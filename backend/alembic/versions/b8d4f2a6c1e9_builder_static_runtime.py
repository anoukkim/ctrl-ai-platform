"""builder-static-runtime: app slugs and restorable versions

* `builder_projects.app_slug` — the app's folder on apps.ctrlai.my.
* `builder_projects.app_runtime_at` — when 미리보기 갱신 last wrote it.
* `builder_project_versions` — every file after each change, last 30.

Revision ID: b8d4f2a6c1e9
Revises: f6c9e2a1b7d3
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8d4f2a6c1e9"
down_revision: str | None = "f6c9e2a1b7d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("builder_projects", sa.Column("app_slug", sa.String(length=32), nullable=True))
    op.create_unique_constraint("uq_builder_projects_app_slug", "builder_projects", ["app_slug"])
    op.add_column(
        "builder_projects",
        sa.Column("app_runtime_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "builder_project_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("builder_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("files", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("project_id", "number", name="uq_builder_project_versions_number"),
    )
    op.create_index(
        "ix_builder_project_versions_project_id", "builder_project_versions", ["project_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_builder_project_versions_project_id", table_name="builder_project_versions")
    op.drop_table("builder_project_versions")
    op.drop_column("builder_projects", "app_runtime_at")
    op.drop_constraint("uq_builder_projects_app_slug", "builder_projects", type_="unique")
    op.drop_column("builder_projects", "app_slug")
