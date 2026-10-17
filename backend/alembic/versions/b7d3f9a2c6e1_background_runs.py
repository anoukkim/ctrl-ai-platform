"""background-runs: chat_runs, and a heartbeat on builder generations

A Chat reply keeps going on the server when the member leaves; `chat_runs`
is what other pages and worker processes see of it (the text so far, a
heartbeat, 중지), with at most one running reply per member.

Revision ID: b7d3f9a2c6e1
Revises: a4c8e2b6d1f3
Create Date: 2026-10-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d3f9a2c6e1"
down_revision: str | None = "a4c8e2b6d1f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "conversation_id", sa.Integer(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "user_message_id", sa.Integer(), sa.ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(10), nullable=False, server_default="running"),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("thinking", sa.Text(), nullable=False, server_default=""),
        sa.Column("stop_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("error", sa.String(300), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_chat_runs_user_id", "chat_runs", ["user_id"])
    op.create_index("ix_chat_runs_conversation_id", "chat_runs", ["conversation_id"])
    op.create_index(
        "uq_chat_runs_running_user",
        "chat_runs",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'running'"),
    )
    op.add_column("builder_generations", sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("builder_generations", "heartbeat_at")
    op.drop_index("uq_chat_runs_running_user", table_name="chat_runs")
    op.drop_index("ix_chat_runs_conversation_id", table_name="chat_runs")
    op.drop_index("ix_chat_runs_user_id", table_name="chat_runs")
    op.drop_table("chat_runs")
