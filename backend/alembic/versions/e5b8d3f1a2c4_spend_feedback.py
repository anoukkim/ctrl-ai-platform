"""feat-spend-feedback: milestones shown once per quarter, and the member's switch

* `spend_milestones` — which milestone (first / used_25 / used_50 /
  used_75 / low / empty) a member has been shown in a quarter; unique per
  member, quarter and kind.
* `users.spend_notifications` — Profile › 알림 › 사용 알림 표시, on by
  default for every existing account too.

Revision ID: e5b8d3f1a2c4
Revises: d4a7c2e9f1b6
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5b8d3f1a2c4"
down_revision: str | None = "d4a7c2e9f1b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "spend_milestones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "quarter_id",
            sa.Integer(),
            sa.ForeignKey("quarters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id", "quarter_id", "kind", name="uq_spend_milestone"),
    )
    op.create_index("ix_spend_milestones_user_id", "spend_milestones", ["user_id"])
    op.create_index("ix_spend_milestones_quarter_id", "spend_milestones", ["quarter_id"])
    op.add_column(
        "users",
        sa.Column("spend_notifications", sa.Boolean(), server_default=sa.true(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "spend_notifications")
    op.drop_table("spend_milestones")
