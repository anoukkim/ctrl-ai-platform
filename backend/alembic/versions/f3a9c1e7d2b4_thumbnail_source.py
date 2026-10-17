"""fix-draft-thumbs: who made a stored thumbnail

`builder_projects.draft_thumbnail_source` and
`builder_project_versions.thumbnail_source` — "server" (the thumbnail
worker) or "browser" (the in-browser capture). While THUMBNAIL_RENDERER is
`server`, a browser picture never replaces a current server one. NULL for
pictures stored before this (treated as the browser's).

Revision ID: f3a9c1e7d2b4
Revises: e7c2a4d8f1b6
Create Date: 2026-10-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3a9c1e7d2b4"
down_revision: str | None = "e7c2a4d8f1b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("builder_projects", sa.Column("draft_thumbnail_source", sa.String(8), nullable=True))
    op.add_column("builder_project_versions", sa.Column("thumbnail_source", sa.String(8), nullable=True))


def downgrade() -> None:
    op.drop_column("builder_project_versions", "thumbnail_source")
    op.drop_column("builder_projects", "draft_thumbnail_source")
