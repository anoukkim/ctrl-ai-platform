"""cost calibration: the input estimate made before each call

`cost-calibration` (2026-10-13). A Chat usage event keeps the input token
estimate the pre-check used, next to the counts the provider reported, so
the estimates can be calibrated against reality. Nullable: older rows have
no estimate, and only Chat records one.

Revision ID: c6e2d8a4f913
Revises: a3c9e1f5d702
Create Date: 2026-10-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c6e2d8a4f913"
down_revision: str | None = "a3c9e1f5d702"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("usage_events") as batch:
        batch.add_column(sa.Column("estimated_input_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("usage_events") as batch:
        batch.drop_column("estimated_input_tokens")
