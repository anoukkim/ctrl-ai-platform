"""project files, so a Builder project can be downloaded as a ZIP

Nothing writes these rows yet — Phase 3 does, when Claude starts
generating project files and the editor saves them. The table arrives now
because "코드 다운로드 (ZIP)" has to read files from somewhere, and a
download route built against a store that does not exist cannot be
tested.

A project made before Phase 3 therefore downloads as a ZIP holding only
the guide file. That is the truth about the project rather than a gap in
the download.

The unique constraint matters: without it two saves of the same path
leave two rows and the file appears twice in the archive.

Revision ID: f3b8d41c9e27
Revises: e5c2a1f73b84
Create Date: 2026-10-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3b8d41c9e27"
down_revision: str | None = "e5c2a1f73b84"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "builder_project_files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("path", sa.String(length=400), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["builder_projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "path", name="uq_builder_project_files_path"),
    )
    op.create_index("ix_builder_project_files_project_id", "builder_project_files", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_builder_project_files_project_id", table_name="builder_project_files")
    op.drop_table("builder_project_files")
