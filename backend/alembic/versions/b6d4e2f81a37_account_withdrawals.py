"""account withdrawals

One row per member leaving CTRL+AI: when, who did it, what 동아리 지원
was released, whether personal money is still owed back (환불 대기), and
whether the account was later restored or anonymised.

`reversal` keeps the state withdrawing replaced — memberships,
allocations, applications, publishing — so an admin's 복구 within the
30-day grace period puts back exactly what was taken away.

No backfill. A member who is `former` today became so through Admin's
participation setting, before this table existed; they have no
withdrawal row, so the anonymisation job never touches them.

Revision ID: b6d4e2f81a37
Revises: a71f5c38d904
Create Date: 2026-10-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b6d4e2f81a37"
down_revision: str | None = "a71f5c38d904"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "account_withdrawals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("grace_ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("initiated_by", sa.Integer(), nullable=True),
        sa.Column(
            "published_work",
            sa.Enum(
                "keep",
                "unpublish",
                name="publishedworkchoice",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("released_krw", sa.Integer(), nullable=False),
        sa.Column(
            "refund_status",
            sa.Enum(
                "none",
                "pending",
                "recorded",
                name="refundstatus",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("refund_amount_krw", sa.Integer(), nullable=False),
        sa.Column("refund_recorded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refund_recorded_by", sa.Integer(), nullable=True),
        sa.Column("refund_reference", sa.String(length=200), nullable=False),
        sa.Column("restored_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("restored_by", sa.Integer(), nullable=True),
        sa.Column("anonymised_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "reversal",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["initiated_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["refund_recorded_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["restored_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_account_withdrawals_user_id", "account_withdrawals", ["user_id"])
    op.create_index(
        "ix_account_withdrawals_grace_ends_at", "account_withdrawals", ["grace_ends_at"]
    )


def downgrade() -> None:
    # Dropping the table forgets who withdrew and which refunds are owed.
    # Their accounts stay `former`; only the record of the event is lost.
    op.drop_index("ix_account_withdrawals_grace_ends_at", table_name="account_withdrawals")
    op.drop_index("ix_account_withdrawals_user_id", table_name="account_withdrawals")
    op.drop_table("account_withdrawals")
