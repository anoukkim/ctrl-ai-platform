"""invite codes

invite-only-signup. Signing up needs an invite code in every environment.

* `invite_codes`: code (normalised: trimmed, upper case; unique), label,
  max uses, uses so far, optional expiry, active flag, who created it.
* `users.invite_code_id`: the code an account signed up with.

**Existing accounts are unaffected**: the new column is nullable and
nothing is backfilled — accounts from before invite codes simply have
none.

Revision ID: c8e1f4a29d57
Revises: d4f7a1c9e2b5
Create Date: 2026-10-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8e1f4a29d57"
down_revision: str | None = "d4f7a1c9e2b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "invite_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("max_uses", sa.Integer(), nullable=False),
        sa.Column("uses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_invite_codes_code", "invite_codes", ["code"], unique=True)

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("invite_code_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_users_invite_code_id",
            "invite_codes",
            ["invite_code_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index("ix_users_invite_code_id", ["invite_code_id"])


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_invite_code_id")
        batch.drop_constraint("fk_users_invite_code_id", type_="foreignkey")
        batch.drop_column("invite_code_id")
    op.drop_index("ix_invite_codes_code", table_name="invite_codes")
    op.drop_table("invite_codes")
