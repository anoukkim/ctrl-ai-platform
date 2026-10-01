"""phase 1a auth: username, password hash, account status, sessions

Revision ID: 6d2a45cc2666
Revises: fb7604f60412
Create Date: 2026-10-01 10:28:26.691286

Hand-edited after autogenerate. Alembic proposed adding three NOT NULL
columns to `users` in one step, which fails the moment the table has a
row — and it does. Each column is therefore added nullable, backfilled,
and only then made NOT NULL.

Backfill rules:

* `username`  — the local part of the email, with anything outside
  [a-zA-Z0-9_] replaced by an underscore. Collisions get `_<id>`
  appended, so the unique index can be created safely.
* `password_hash` — '!', the unusable-password sentinel from
  `app.core.security`. It is not a valid Argon2 hash, so these accounts
  cannot be signed into until a password is set. Nobody's password is
  invented, and no account is silently left open.
* `account_status` — 'active' where `is_active` was true, 'inactive'
  otherwise. The boolean is dropped afterwards.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6d2a45cc2666'
down_revision: Union[str, Sequence[str], None] = 'fb7604f60412'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Mirrors app.core.security.UNUSABLE_PASSWORD_HASH. Duplicated on purpose:
# a migration must keep working even if that constant is changed later.
UNUSABLE_PASSWORD_HASH = "!"


def upgrade() -> None:
    """Upgrade schema."""
    # ---------- sessions ----------
    op.create_table(
        'user_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_user_sessions_token'), 'user_sessions', ['token'], unique=True)
    op.create_index(op.f('ix_user_sessions_user_id'), 'user_sessions', ['user_id'], unique=False)

    # ---------- users: add nullable ----------
    op.add_column('users', sa.Column('username', sa.String(length=50), nullable=True))
    op.add_column('users', sa.Column('password_hash', sa.String(length=255), nullable=True))
    op.add_column(
        'users',
        sa.Column(
            'account_status',
            sa.Enum(
                'active', 'inactive', 'former',
                name='account_status',
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            nullable=True,
        ),
    )

    # ---------- users: backfill existing rows ----------
    op.execute(
        """
        UPDATE users
           SET username = regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9_]', '_', 'g')
         WHERE username IS NULL
        """
    )
    # Two members whose addresses differ only after the @ would collide.
    op.execute(
        """
        UPDATE users AS u
           SET username = u.username || '_' || u.id
          FROM users AS other
         WHERE other.username = u.username
           AND other.id < u.id
        """
    )
    op.execute(
        f"""
        UPDATE users
           SET password_hash = '{UNUSABLE_PASSWORD_HASH}'
         WHERE password_hash IS NULL
        """
    )
    op.execute(
        """
        UPDATE users
           SET account_status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END
         WHERE account_status IS NULL
        """
    )

    # ---------- users: enforce ----------
    op.alter_column('users', 'username', existing_type=sa.String(length=50), nullable=False)
    op.alter_column('users', 'password_hash', existing_type=sa.String(length=255), nullable=False)
    op.alter_column(
        'users',
        'account_status',
        existing_type=sa.String(length=20),
        nullable=False,
    )
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
    op.drop_column('users', 'is_active')


def downgrade() -> None:
    """Downgrade schema."""
    # Restores the boolean from account_status, so going back does not
    # silently deactivate everyone.
    op.add_column(
        'users',
        sa.Column('is_active', sa.BOOLEAN(), autoincrement=False, nullable=True),
    )
    op.execute("UPDATE users SET is_active = (account_status = 'active')")
    op.alter_column('users', 'is_active', existing_type=sa.BOOLEAN(), nullable=False)

    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_column('users', 'account_status')
    op.drop_column('users', 'password_hash')
    op.drop_column('users', 'username')

    op.drop_index(op.f('ix_user_sessions_user_id'), table_name='user_sessions')
    op.drop_index(op.f('ix_user_sessions_token'), table_name='user_sessions')
    op.drop_table('user_sessions')
