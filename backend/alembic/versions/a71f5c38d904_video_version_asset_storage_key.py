"""where CTRL+AI keeps a version's file

`asset_url` is where the *provider* keeps it. That is not good enough for
a download: a provider URL can expire, can need their credentials, and is
gone the day we stop using them. A member downloading their own video
must not depend on any of that, so the bytes are ours and this column is
the key that finds them (app/services/storage.py).

Nullable with no backfill. Versions that already exist have no file —
nothing was ever generated — and null says exactly that.

Revision ID: a71f5c38d904
Revises: f3b8d41c9e27
Create Date: 2026-10-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a71f5c38d904"
down_revision: str | None = "f3b8d41c9e27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "video_versions", sa.Column("asset_storage_key", sa.String(length=300), nullable=True)
    )


def downgrade() -> None:
    # The stored files are not removed: dropping a column should not
    # delete a member's video. They become unreferenced, which an admin
    # can clear out deliberately.
    op.drop_column("video_versions", "asset_storage_key")
