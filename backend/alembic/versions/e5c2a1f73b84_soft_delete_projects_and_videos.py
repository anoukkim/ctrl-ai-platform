"""soft delete for builder projects and video projects

Deleting a member's project used to remove the row: `DELETE /builder/
projects/{id}` ran `db.delete(project)`, and Video had no delete at all.

Both now mark the row instead. The member stops seeing it on the next
request; an admin can restore it from Admin › Deleted Items.

Nullable with no default and no backfill: every row that exists today is
not deleted, which is exactly what NULL says.

Indexed because every member-facing query now carries
`deleted_at IS NULL`, alongside an `owner_user_id` that is already indexed.

Revision ID: e5c2a1f73b84
Revises: d7e1b4a9c052
Create Date: 2026-10-02

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5c2a1f73b84"
down_revision: str | None = "d7e1b4a9c052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("builder_projects", "video_projects")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index(f"ix_{table}_deleted_at", table, ["deleted_at"])


def downgrade() -> None:
    # Dropping the column discards which rows were deleted, so anything
    # soft-deleted becomes visible again. There is no honest alternative:
    # the information has nowhere else to live.
    for table in TABLES:
        op.drop_index(f"ix_{table}_deleted_at", table_name=table)
        op.drop_column(table, "deleted_at")
