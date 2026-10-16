"""owner-polish-3 (b): the automatic USD→KRW rate

`exchange_rates.source` says who wrote a row — "seed" (the first
migration's default), "admin" (typed in on Admin › System), or the
provider that fetched it ("mock" / "frankfurter") — and `fetched_for`
the day the provider quoted. `fx_status` is one row: the pin switch
(`auto_enabled`), the last fetch and why it was not applied.

Revision ID: c3e5a7b9d1f3
Revises: a8c4e2f6b1d9
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3e5a7b9d1f3"
down_revision: str | None = "a8c4e2f6b1d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "exchange_rates", sa.Column("source", sa.String(length=20), nullable=False, server_default="admin")
    )
    op.add_column("exchange_rates", sa.Column("fetched_for", sa.Date(), nullable=True))
    op.execute("UPDATE exchange_rates SET source = 'seed' WHERE set_by IS NULL")
    op.create_table(
        "fx_status",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("auto_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fetched_rate", sa.Numeric(10, 2), nullable=True),
        sa.Column("fetched_for", sa.Date(), nullable=True),
        sa.Column("outcome", sa.String(length=12), nullable=False, server_default=""),
        sa.Column("note", sa.String(length=300), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("fx_status")
    op.drop_column("exchange_rates", "fetched_for")
    op.drop_column("exchange_rates", "source")
