"""thumbnail-choice: clear the retired picker's stamps

owner-polish-3 (a2)'s picker set `builder_projects.thumbnail_chosen_at`
and was removed without clearing it. thumbnail-choice gives the column a
new meaning (a picture under `thumbnails/<id>/chosen.webp`, which nothing
has written yet), so an old stamp would show "직접 지정" and freeze the
thumbnails' cache-busting time. Data only; the downgrade cannot bring the
old stamps back and does nothing.

Revision ID: a4c8e2b6d1f3
Revises: f3a9c1e7d2b4
Create Date: 2026-10-17

"""

from collections.abc import Sequence

from alembic import op

revision: str = "a4c8e2b6d1f3"
down_revision: str | None = "f3a9c1e7d2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE builder_projects SET thumbnail_chosen_at = NULL WHERE thumbnail_chosen_at IS NOT NULL")


def downgrade() -> None:
    pass
