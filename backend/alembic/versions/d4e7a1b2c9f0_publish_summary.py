"""publish-summary: the 게시 dialog's pre-filled text, kept per version

`builder_project_versions.summary_description` / `summary_note` — what
Claude (Haiku) wrote for this version, once; `summary_base_version` — the
published version's number the note was written against (recomputed when
it changes); `summary_model` — the catalogue label it came from. All
nullable: None means not asked yet.

Revision ID: d4e7a1b2c9f0
Revises: 1cc00c092902
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e7a1b2c9f0"
down_revision: str | None = "1cc00c092902"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("builder_project_versions") as batch:
        batch.add_column(sa.Column("summary_description", sa.Text(), nullable=True))
        batch.add_column(sa.Column("summary_note", sa.Text(), nullable=True))
        batch.add_column(sa.Column("summary_base_version", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("summary_model", sa.String(length=80), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("builder_project_versions") as batch:
        batch.drop_column("summary_model")
        batch.drop_column("summary_base_version")
        batch.drop_column("summary_note")
        batch.drop_column("summary_description")
