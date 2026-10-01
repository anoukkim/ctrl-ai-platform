"""video version generation settings

Records what each generation attempt was actually made with: length,
aspect ratio, sound, and whether the model was Auto's choice.

Before this, a version only kept its prompt and model. The workspace had
no way to know a version's length, so the mock player showed a hard-coded
15 seconds for every version — including ones made at 10. The model was
shown as the raw provider id (`kling-3.0-pro`) for the same reason: there
was nothing recorded to turn it into a name.

All four columns are nullable on purpose. Versions that already exist were
generated before anything recorded this, and there is no honest value to
backfill them with: the member's settings at that moment are simply not
known. The workspace treats a missing figure as unknown rather than
inventing one.

Revision ID: d7e1b4a9c052
Revises: c3a81f5d7e24
Create Date: 2026-10-01

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d7e1b4a9c052"
down_revision: str | None = "c3a81f5d7e24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("video_versions", sa.Column("duration_seconds", sa.Integer(), nullable=True))
    op.add_column("video_versions", sa.Column("aspect_ratio", sa.String(length=10), nullable=True))
    op.add_column("video_versions", sa.Column("sound", sa.Boolean(), nullable=True))
    op.add_column("video_versions", sa.Column("auto_selected", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("video_versions", "auto_selected")
    op.drop_column("video_versions", "sound")
    op.drop_column("video_versions", "aspect_ratio")
    op.drop_column("video_versions", "duration_seconds")
