"""usage_events.work_label — the project's name, kept when the project goes

ui-improvements B (3): an admin may purge a deleted project or video for
good, and 분기 마감 purges everything still in Deleted Items. Money rows
are never deleted — `builder_project_id` / `video_project_id` are
ON DELETE SET NULL already — but Usage names a charge after its project,
so the name is copied here just before the row is removed. Null on every
row whose project still exists (the live name is read instead).

Revision ID: a3c7e9b1d5f2
Revises: a3f7c1d9e2b4
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3c7e9b1d5f2"
down_revision: str | None = "a3f7c1d9e2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("usage_events", sa.Column("work_label", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("usage_events", "work_label")
