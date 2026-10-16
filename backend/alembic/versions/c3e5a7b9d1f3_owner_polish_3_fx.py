"""owner-polish-3: the automatic USD→KRW rate (b) and the chosen thumbnail (a2)

`exchange_rates.source` says who wrote a row — "seed" (the first
migration's default), "admin" (typed in on Admin › System), or the
provider that fetched it ("mock" / "frankfurter") — and `fetched_for`
the day the provider quoted. `fx_status` is one row: the pin switch
(`auto_enabled`), the last fetch and why it was not applied.

`builder_projects.thumbnail_chosen_at` (a2): when the maker picked the
published thumbnail — the Builder card then shows that picture, and the
automatic draft captures stop replacing it.

`notifications.counted` (c): what a 반응을 얻었어요 row has counted — one
token per member per day for reactions, one per comment — so the count
never comes out of the title and a 좋아요 pressed on and off stays one.

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
    op.add_column("builder_projects", sa.Column("thumbnail_chosen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("notifications", sa.Column("counted", sa.JSON(), nullable=True))
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
    op.drop_column("notifications", "counted")
    op.drop_column("builder_projects", "thumbnail_chosen_at")
    op.drop_table("fx_status")
    op.drop_column("exchange_rates", "fetched_for")
    op.drop_column("exchange_rates", "source")
