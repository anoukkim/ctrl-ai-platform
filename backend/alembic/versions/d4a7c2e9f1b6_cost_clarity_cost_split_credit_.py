"""cost-clarity: cost split, credit purchases, wallet adjustments, quarter close

* `usage_events` gains the dollar cost split by what it paid for (input,
  cache write, cache read, output, tools), what caching saved, and
  `club_absorbed` for a call the club paid with no member charged. Old
  rows keep NULL splits: they are read with a labelled estimate, never
  rewritten.
* `credit_purchases` — append-only purchase records per provider.
* `wallet_adjustments` — an admin's +/− with a reason, and carry-over.
* `quarters.carry_over_percent` (0 by default), `closed_at`, `closed_by`;
  `quarter_allocations.frozen_at`, `reclaimed_krw`, `carry_over_krw`,
  `carried_into_id` — 분기 마감. Nothing is deleted.

Revision ID: d4a7c2e9f1b6
Revises: b9e6a3d1f4c7
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4a7c2e9f1b6"
down_revision: str | None = "b9e6a3d1f4c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SPLIT = (
    "input_cost_usd",
    "cache_write_cost_usd",
    "cache_read_cost_usd",
    "output_cost_usd",
    "tool_cost_usd",
    "cache_saved_usd",
)


def upgrade() -> None:
    for name in _SPLIT:
        op.add_column("usage_events", sa.Column(name, sa.Numeric(14, 6), nullable=True))
    op.add_column(
        "usage_events",
        sa.Column("club_absorbed", sa.Boolean(), server_default=sa.false(), nullable=False),
    )

    op.create_table(
        "credit_purchases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("purchased_on", sa.Date(), nullable=False),
        sa.Column("amount_usd", sa.Numeric(12, 2), nullable=False),
        sa.Column("paid_krw", sa.Integer(), nullable=False),
        sa.Column("memo", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_credit_purchases_provider", "credit_purchases", ["provider"])

    op.create_table(
        "wallet_adjustments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "allocation_id",
            sa.Integer(),
            sa.ForeignKey("quarter_allocations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "quarter_id",
            sa.Integer(),
            sa.ForeignKey("quarters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount_krw", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="adjust"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("budget_before_krw", sa.Integer(), nullable=False),
        sa.Column("budget_after_krw", sa.Integer(), nullable=False),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_wallet_adjustments_allocation_id", "wallet_adjustments", ["allocation_id"])
    op.create_index("ix_wallet_adjustments_user_id", "wallet_adjustments", ["user_id"])
    op.create_index("ix_wallet_adjustments_quarter_id", "wallet_adjustments", ["quarter_id"])

    op.add_column(
        "quarters",
        sa.Column("carry_over_percent", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("quarters", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "quarters",
        sa.Column(
            "closed_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_quarters_closed_by_users"),
            nullable=True,
        ),
    )

    op.add_column(
        "quarter_allocations", sa.Column("frozen_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("quarter_allocations", sa.Column("reclaimed_krw", sa.Integer(), nullable=True))
    op.add_column("quarter_allocations", sa.Column("carry_over_krw", sa.Integer(), nullable=True))
    op.add_column(
        "quarter_allocations",
        sa.Column(
            "carried_into_id",
            sa.Integer(),
            sa.ForeignKey(
                "quarter_allocations.id",
                ondelete="SET NULL",
                name="fk_quarter_allocations_carried_into",
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_quarter_allocations_carried_into", "quarter_allocations", type_="foreignkey"
    )
    for name in ("carried_into_id", "carry_over_krw", "reclaimed_krw", "frozen_at"):
        op.drop_column("quarter_allocations", name)
    op.drop_constraint("fk_quarters_closed_by_users", "quarters", type_="foreignkey")
    for name in ("closed_by", "closed_at", "carry_over_percent"):
        op.drop_column("quarters", name)
    op.drop_table("wallet_adjustments")
    op.drop_table("credit_purchases")
    op.drop_column("usage_events", "club_absorbed")
    for name in reversed(_SPLIT):
        op.drop_column("usage_events", name)
