"""chat conversations and Claude pricing

Phase 2 — Chat.

* `conversations` and `chat_messages`: a member's private chats.
* `claude_model_prices`: dollars per million input/output tokens, per
  model, editable in Admin › System. Seeded with Anthropic's list prices
  on 2026-10-07 for the three models the club may switch between.
* `exchange_rates`: won per dollar, one row per change. Seeded at 1,400.
* `usage_events.provider_cost` widens to six decimal places of a dollar.
* `usage_events` gains `input_tokens`, `output_tokens`,
  `exchange_rate_krw` and `conversation_id`, so a chat charge records
  everything `budget-by-provider` and `usage-analytics` will need. Older
  rows leave them NULL: what they would have held was never recorded.

Revision ID: 5e9a3c71d2b8
Revises: 4b8e2d6f1a90
Create Date: 2026-10-07

"""

from collections.abc import Sequence
from decimal import Decimal

import sqlalchemy as sa
from alembic import op

revision: str = "5e9a3c71d2b8"
down_revision: str | None = "4b8e2d6f1a90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True, length=20)


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=False, server_default=""),
        sa.Column(
            "last_message_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_conversations_user_id", "conversations", ["user_id"])

    op.create_table(
        "claude_model_prices",
        sa.Column("model_id", sa.String(length=120), nullable=False),
        sa.Column("display_name", sa.String(length=60), nullable=False, server_default=""),
        sa.Column("input_usd_per_mtok", sa.Numeric(10, 4), nullable=False),
        sa.Column("output_usd_per_mtok", sa.Numeric(10, 4), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("model_id"),
    )

    op.create_table(
        "exchange_rates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="USD"),
        sa.Column("krw_per_unit", sa.Numeric(10, 2), nullable=False),
        sa.Column("set_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["set_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_exchange_rates_currency", "exchange_rates", ["currency"])

    with op.batch_alter_table("usage_events") as batch:
        # A chat reply costs around a cent; four decimal places of a dollar
        # would round each one by up to 0.14원 and the sums would drift.
        batch.alter_column(
            "provider_cost",
            existing_type=sa.Numeric(12, 4),
            type_=sa.Numeric(14, 6),
            existing_nullable=True,
        )
        batch.add_column(sa.Column("input_tokens", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("output_tokens", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("exchange_rate_krw", sa.Numeric(10, 2), nullable=True))
        batch.add_column(sa.Column("conversation_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_usage_events_conversation_id",
            "conversations",
            ["conversation_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index("ix_usage_events_conversation_id", ["conversation_id"])

    # chat_messages points at both conversations and usage_events, so it
    # is created last.
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", _enum("chatrole", "user", "assistant"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "status",
            _enum("chatmessagestatus", "complete", "stopped", "truncated", "refused"),
            nullable=False,
            server_default="complete",
        ),
        sa.Column("action", _enum("chataction", "builder", "video"), nullable=True),
        sa.Column("action_title", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("model_id", sa.String(length=120), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("usage_event_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["usage_event_id"], ["usage_events.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_conversation_id", "chat_messages", ["conversation_id"])
    op.create_index("ix_chat_messages_user_id", "chat_messages", ["user_id"])
    op.create_index("ix_chat_messages_created_at", "chat_messages", ["created_at"])

    # Seed data belongs in the migration, not the dev seed: production needs
    # prices before its first message, and the dev seed refuses to run there.
    prices = sa.table(
        "claude_model_prices",
        sa.column("model_id", sa.String),
        sa.column("display_name", sa.String),
        sa.column("input_usd_per_mtok", sa.Numeric),
        sa.column("output_usd_per_mtok", sa.Numeric),
    )
    op.bulk_insert(
        prices,
        [
            {
                "model_id": "claude-sonnet-5-5",
                "display_name": "Claude Sonnet 5.5",
                "input_usd_per_mtok": Decimal("2"),
                "output_usd_per_mtok": Decimal("10"),
            },
            {
                "model_id": "claude-opus-5-5",
                "display_name": "Claude Opus 5.5",
                "input_usd_per_mtok": Decimal("4"),
                "output_usd_per_mtok": Decimal("20"),
            },
            {
                "model_id": "claude-haiku-4-5",
                "display_name": "Claude Haiku 4.5",
                "input_usd_per_mtok": Decimal("1"),
                "output_usd_per_mtok": Decimal("5"),
            },
        ],
    )
    rates = sa.table(
        "exchange_rates",
        sa.column("currency", sa.String),
        sa.column("krw_per_unit", sa.Numeric),
    )
    op.bulk_insert(rates, [{"currency": "USD", "krw_per_unit": Decimal("1400")}])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_created_at", table_name="chat_messages")
    op.drop_index("ix_chat_messages_user_id", table_name="chat_messages")
    op.drop_index("ix_chat_messages_conversation_id", table_name="chat_messages")
    op.drop_table("chat_messages")

    with op.batch_alter_table("usage_events") as batch:
        batch.drop_index("ix_usage_events_conversation_id")
        batch.drop_constraint("fk_usage_events_conversation_id", type_="foreignkey")
        batch.drop_column("conversation_id")
        batch.drop_column("exchange_rate_krw")
        batch.drop_column("output_tokens")
        batch.drop_column("input_tokens")
        batch.alter_column(
            "provider_cost",
            existing_type=sa.Numeric(14, 6),
            type_=sa.Numeric(12, 4),
            existing_nullable=True,
        )

    op.drop_index("ix_exchange_rates_currency", table_name="exchange_rates")
    op.drop_table("exchange_rates")
    op.drop_table("claude_model_prices")
    op.drop_index("ix_conversations_user_id", table_name="conversations")
    op.drop_table("conversations")
