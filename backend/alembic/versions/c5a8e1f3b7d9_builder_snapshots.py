"""builder-snapshots: 작업 steps between saved versions

`builder_project_steps` — the short rolling history (실행 취소 / 다시 실행)
between saved versions; `builder_projects.step_seq` (where the working copy
stands in it) and `base_version_number` (the saved version the member
loaded); `builder_generations.step_id` (the step a 만들기 / 고치기 made).
Existing versions v1…vN are untouched — they simply are the saved
snapshots now. Steps start empty and fill as the member works.

Revision ID: c5a8e1f3b7d9
Revises: b9d2e4f6a8c1
Create Date: 2026-10-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5a8e1f3b7d9"
down_revision: str | None = "b9d2e4f6a8c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "builder_project_steps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("builder_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(200), nullable=False, server_default=""),
        sa.Column("files", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "seq", name="uq_builder_project_steps_seq"),
    )
    op.create_index("ix_builder_project_steps_project_id", "builder_project_steps", ["project_id"])
    op.add_column("builder_projects", sa.Column("step_seq", sa.Integer(), nullable=True))
    op.add_column("builder_projects", sa.Column("base_version_number", sa.Integer(), nullable=True))
    op.add_column("builder_generations", sa.Column("step_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_builder_generations_step_id",
        "builder_generations",
        "builder_project_steps",
        ["step_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_builder_generations_step_id", "builder_generations", type_="foreignkey")
    op.drop_column("builder_generations", "step_id")
    op.drop_column("builder_projects", "base_version_number")
    op.drop_column("builder_projects", "step_seq")
    op.drop_index("ix_builder_project_steps_project_id", table_name="builder_project_steps")
    op.drop_table("builder_project_steps")
