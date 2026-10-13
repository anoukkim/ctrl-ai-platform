"""chat attachments: files a member attaches to a chat message

chat-plus-files. One row per file; the bytes live in storage. The cache
columns the spec's point 5 asked for came with `prompt-caching`, so this
migration only adds the table.

Revision ID: a7c3e9d1f5b2
Revises: f2c8a6d4e1b3
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7c3e9d1f5b2"
down_revision: str | None = "f2c8a6d4e1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_attachments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            sa.Integer(),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "kind",
            sa.Enum(
                "image", "pdf", "csv", "text",
                name="attachmentkind", native_enum=False, create_constraint=True, length=20,
            ),
            nullable=False,
        ),
        sa.Column("media_type", sa.String(length=80), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("stored_size", sa.Integer(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("estimated_tokens", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_chat_attachments_user_id", "chat_attachments", ["user_id"])
    op.create_index("ix_chat_attachments_conversation_id", "chat_attachments", ["conversation_id"])
    op.create_index("ix_chat_attachments_message_id", "chat_attachments", ["message_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_attachments_message_id", table_name="chat_attachments")
    op.drop_index("ix_chat_attachments_conversation_id", table_name="chat_attachments")
    op.drop_index("ix_chat_attachments_user_id", table_name="chat_attachments")
    op.drop_table("chat_attachments")
