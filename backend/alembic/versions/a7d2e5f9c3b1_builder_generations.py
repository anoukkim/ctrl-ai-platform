"""quality-tuning Q2: Builder generation in stages; 빌더 점검 reports

* `builder_generations` — one 만들기 / 고치기: its plan, the files saved so
  far, the self-check, what it cost and how it ended.
* `builder_eval_reports` — the owner's real-provider evaluation runs.

Revision ID: a7d2e5f9c3b1
Revises: f3a9c1e7b2d4
Create Date: 2026-10-15

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7d2e5f9c3b1"
down_revision: str | None = "f3a9c1e7b2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "builder_generations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("builder_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("request", sa.Text(), nullable=False),
        sa.Column("style", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("plan", sa.JSON(), nullable=False),
        sa.Column("files_done", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("check_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("check_fixed", sa.JSON(), nullable=False),
        sa.Column("charged_krw", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "version_id",
            sa.Integer(),
            sa.ForeignKey("builder_project_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        *_timestamps(),
    )
    op.create_index("ix_builder_generations_project_id", "builder_generations", ["project_id"])
    op.create_table(
        "builder_eval_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("ideas", sa.Integer(), nullable=False),
        sa.Column("succeeded", sa.Integer(), nullable=False),
        sa.Column("total_krw", sa.Integer(), nullable=False),
        sa.Column("markdown", sa.Text(), nullable=False),
        *_timestamps(),
    )


def downgrade() -> None:
    op.drop_table("builder_eval_reports")
    op.drop_index("ix_builder_generations_project_id", table_name="builder_generations")
    op.drop_table("builder_generations")
