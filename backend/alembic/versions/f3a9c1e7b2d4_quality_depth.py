"""quality-tuning Q1: 생각 깊이 — per conversation, per project, per member; depth limits

* `conversations.depth`, `chat_messages.depth`, `usage_events.depth`.
* `builder_projects.chat_model_id` / `depth` — the project's last choice.
* `users.default_chat_model_id` / `default_depth` — Profile › 기본 모델.
* `chat_limits.depth_levels` (JSON), `context_tokens` (64,000),
  `timeout_seconds` (180) — admin settings.

Revision ID: f3a9c1e7b2d4
Revises: e8b2c4d6f1a3
Create Date: 2026-10-15

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3a9c1e7b2d4"
down_revision: str | None = "e8b2c4d6f1a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("depth", sa.String(length=10), nullable=True))
    op.add_column("chat_messages", sa.Column("depth", sa.String(length=10), nullable=True))
    op.add_column("usage_events", sa.Column("depth", sa.String(length=10), nullable=True))
    op.add_column("builder_projects", sa.Column("chat_model_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_builder_projects_chat_model", "builder_projects", "chat_models", ["chat_model_id"], ["id"],
        ondelete="SET NULL",
    )
    op.add_column("builder_projects", sa.Column("depth", sa.String(length=10), nullable=True))
    op.add_column("users", sa.Column("default_chat_model_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_users_default_chat_model", "users", "chat_models", ["default_chat_model_id"], ["id"],
        ondelete="SET NULL",
    )
    op.add_column("users", sa.Column("default_depth", sa.String(length=10), nullable=True))
    op.add_column("chat_limits", sa.Column("depth_levels", sa.JSON(), nullable=True))
    op.add_column(
        "chat_limits", sa.Column("context_tokens", sa.Integer(), nullable=False, server_default="64000")
    )
    op.add_column(
        "chat_limits", sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="180")
    )


def downgrade() -> None:
    op.drop_column("chat_limits", "timeout_seconds")
    op.drop_column("chat_limits", "context_tokens")
    op.drop_column("chat_limits", "depth_levels")
    op.drop_column("users", "default_depth")
    op.drop_constraint("fk_users_default_chat_model", "users", type_="foreignkey")
    op.drop_column("users", "default_chat_model_id")
    op.drop_column("builder_projects", "depth")
    op.drop_constraint("fk_builder_projects_chat_model", "builder_projects", type_="foreignkey")
    op.drop_column("builder_projects", "chat_model_id")
    op.drop_column("usage_events", "depth")
    op.drop_column("chat_messages", "depth")
    op.drop_column("conversations", "depth")
