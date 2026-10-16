"""app-platform P3: ctrlai.db — the per-app database

* `app_data_collections` — an app's lists, each a (name, kind) pair —
  private or shared — per space ("app" / "preview").
* `app_data_items` — the JSON items (≤ 4 KB each), with their author and
  an admin's hiding.
* `app_data_writes` — one row per write, for the per-visitor rate limit.
* `app_reports.data_item_id`, `app_reports.item_excerpt` — a report of one
  shared item (`ctrlai.db.report`).

Revision ID: 1cc00c092902
Revises: a7d2e5f9c3b1
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "1cc00c092902"
down_revision: str | None = "a7d2e5f9c3b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_data_collections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("builder_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("space", sa.String(length=8), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "project_id", "space", "name", "kind", name="uq_app_data_collections_project_space_name_kind"
        ),
    )
    op.create_index("ix_app_data_collections_project_id", "app_data_collections", ["project_id"])

    op.create_table(
        "app_data_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(length=16), nullable=False),
        sa.Column(
            "collection_id",
            sa.Integer(),
            sa.ForeignKey("app_data_collections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("builder_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("space", sa.String(length=8), nullable=False),
        sa.Column("author_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hidden_reason", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("public_id", name="uq_app_data_items_public_id"),
    )
    op.create_index("ix_app_data_items_collection_id", "app_data_items", ["collection_id"])
    op.create_index("ix_app_data_items_author_user_id", "app_data_items", ["author_user_id"])
    op.create_index("ix_app_data_items_project_space", "app_data_items", ["project_id", "space"])

    op.create_table(
        "app_data_writes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("builder_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_app_data_writes_user_project_at", "app_data_writes", ["user_id", "project_id", "created_at"]
    )

    with op.batch_alter_table("app_reports") as batch:
        batch.add_column(sa.Column("data_item_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("item_excerpt", sa.Text(), nullable=False, server_default=""))
        batch.create_foreign_key(
            "fk_app_reports_data_item_id", "app_data_items", ["data_item_id"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    with op.batch_alter_table("app_reports") as batch:
        batch.drop_constraint("fk_app_reports_data_item_id", type_="foreignkey")
        batch.drop_column("item_excerpt")
        batch.drop_column("data_item_id")
    op.drop_index("ix_app_data_writes_user_project_at", table_name="app_data_writes")
    op.drop_table("app_data_writes")
    op.drop_index("ix_app_data_items_project_space", table_name="app_data_items")
    op.drop_index("ix_app_data_items_author_user_id", table_name="app_data_items")
    op.drop_index("ix_app_data_items_collection_id", table_name="app_data_items")
    op.drop_table("app_data_items")
    op.drop_index("ix_app_data_collections_project_id", table_name="app_data_collections")
    op.drop_table("app_data_collections")
