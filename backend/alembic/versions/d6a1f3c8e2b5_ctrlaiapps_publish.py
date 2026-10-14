"""ctrlaiapps-publish: published versions, draft folders, named versions, reports

* `builder_projects.draft_slug` — the working copy's preview folder.
* `builder_projects.published_version_id` / `published_at` /
  `publish_note` — what CtrlAIApps and `app_slug` serve.
* `builder_project_versions.label` / `pinned` — 버전 저장.
* `app_reports` — 신고.

Revision ID: d6a1f3c8e2b5
Revises: c3e7a9d2f4b8
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d6a1f3c8e2b5"
down_revision: str | None = "c3e7a9d2f4b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("builder_projects", sa.Column("draft_slug", sa.String(length=32), nullable=True))
    op.create_unique_constraint("uq_builder_projects_draft_slug", "builder_projects", ["draft_slug"])
    op.add_column(
        "builder_projects", sa.Column("published_version_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        "fk_builder_projects_published_version",
        "builder_projects",
        "builder_project_versions",
        ["published_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "builder_projects", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "builder_projects",
        sa.Column("publish_note", sa.String(length=200), nullable=False, server_default=""),
    )
    op.add_column(
        "builder_project_versions",
        sa.Column("label", sa.String(length=80), nullable=False, server_default=""),
    )
    op.add_column(
        "builder_project_versions",
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "app_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("builder_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reporter_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_app_reports_project_id", "app_reports", ["project_id"])
    # An app that was "published" before this item has no published
    # version and nothing on the public folder: it goes back to ready, so
    # every listing row has a version to serve.
    op.execute(
        "UPDATE builder_projects SET status = 'ready' "
        "WHERE status = 'published' AND published_version_id IS NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_app_reports_project_id", table_name="app_reports")
    op.drop_table("app_reports")
    op.drop_column("builder_project_versions", "pinned")
    op.drop_column("builder_project_versions", "label")
    op.drop_column("builder_projects", "publish_note")
    op.drop_column("builder_projects", "published_at")
    op.drop_constraint("fk_builder_projects_published_version", "builder_projects", type_="foreignkey")
    op.drop_column("builder_projects", "published_version_id")
    op.drop_constraint("uq_builder_projects_draft_slug", "builder_projects", type_="unique")
    op.drop_column("builder_projects", "draft_slug")
