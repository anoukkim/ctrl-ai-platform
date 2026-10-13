"""privacy-and-terms: when an account agreed to the terms at sign-up

New accounts store the moment they ticked the consent box
(privacy-and-terms, 2026-10-14). Existing rows stay NULL on purpose: they
predate the terms, and whether they must consent again is the owner's
decision, not a migration's.

Revision ID: b9e6a3d1f4c7
Revises: c9f2e6a8d4b1
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b9e6a3d1f4c7"
down_revision: str | None = "c9f2e6a8d4b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "terms_accepted_at")
