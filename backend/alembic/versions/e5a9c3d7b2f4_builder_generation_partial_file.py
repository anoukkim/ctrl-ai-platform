"""builder-file-continue: a file cut at the output limit is continued

`builder_generations.partial_file` keeps the parts of a file that arrived
whole when a call was cut off ({"path", "content"}), so the next call —
in the same run, or 이어서 만들기 — writes on from there instead of
starting the file again.

Revision ID: e5a9c3d7b2f4
Revises: d2b8f4a6c1e3
Create Date: 2026-10-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5a9c3d7b2f4"
down_revision: str | None = "d2b8f4a6c1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("builder_generations", sa.Column("partial_file", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("builder_generations", "partial_file")
