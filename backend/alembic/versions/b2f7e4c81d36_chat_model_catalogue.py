"""chat model catalogue

chat-model-choice. Members pick the Claude model per conversation.

* `chat_models` replaces `claude_model_prices`: one row per provider +
  model, with its prices, a Korean label and description, who may pick
  it (`members` / `admin` / `disabled`), the default flag and an order.
  Seeded with Haiku 4.5 and Sonnet 5.5 open to members, Opus 5.5 for
  admins only, Sonnet 5.5 the default. **Prices an admin already set in
  `claude_model_prices` are kept**; any other model found there is copied
  in closed (`disabled`), for an admin to open.
* `conversations.chat_model_id` — the model a conversation's next reply
  uses. Existing conversations get NULL, which means the default.

The downgrade rebuilds `claude_model_prices` from the catalogue's prices
and drops the rest.

Revision ID: b2f7e4c81d36
Revises: 7c1d5e93a4b2
Create Date: 2026-10-07

"""

from collections.abc import Sequence
from decimal import Decimal

import sqlalchemy as sa
from alembic import op

revision: str = "b2f7e4c81d36"
down_revision: str | None = "7c1d5e93a4b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: model_id, label, description, input $, output $, visibility, default, order.
#: The same rows as `app.services.chat_models.DEFAULT_CATALOGUE` — copied,
#: not imported, so this migration keeps its meaning if that list changes.
_SEED = [
    (
        "claude-haiku-4-5",
        "빠른 답변 (Haiku 4.5)",
        "가장 빠르고 저렴합니다. 짧은 질문이나 간단한 정리에 알맞습니다.",
        Decimal("1"),
        Decimal("5"),
        "members",
        False,
        10,
    ),
    (
        "claude-sonnet-5-5",
        "균형 잡힌 답변 (Sonnet 5.5)",
        "속도와 품질이 고르게 좋습니다. 대부분의 대화에 알맞습니다.",
        Decimal("2"),
        Decimal("10"),
        "members",
        True,
        20,
    ),
    (
        "claude-opus-5-5",
        "깊이 있는 답변 (Opus 5.5)",
        "가장 깊이 생각합니다. 어려운 설계나 긴 글에 알맞지만 가장 비쌉니다.",
        Decimal("4"),
        Decimal("20"),
        "admin",
        False,
        30,
    ),
]


def upgrade() -> None:
    op.create_table(
        "chat_models",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model_id", sa.String(length=120), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=False),
        sa.Column("description", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("input_usd_per_mtok", sa.Numeric(10, 4), nullable=False),
        sa.Column("output_usd_per_mtok", sa.Numeric(10, 4), nullable=False),
        sa.Column(
            "visibility",
            sa.Enum(
                "members",
                "admin",
                "disabled",
                name="chatmodelvisibility",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            nullable=False,
            server_default="disabled",
        ),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "model_id", name="uq_chat_models_provider_model"),
    )
    op.create_index("ix_chat_models_provider", "chat_models", ["provider"])

    bind = op.get_bind()
    existing = {
        row.model_id: row
        for row in bind.execute(
            sa.text(
                "SELECT model_id, display_name, input_usd_per_mtok, output_usd_per_mtok "
                "FROM claude_model_prices"
            )
        )
    }

    rows = []
    for model_id, label, description, input_usd, output_usd, visibility, default, order in _SEED:
        kept = existing.pop(model_id, None)
        rows.append(
            {
                "provider": "anthropic",
                "model_id": model_id,
                "label": label,
                "description": description,
                "input_usd_per_mtok": kept.input_usd_per_mtok if kept else input_usd,
                "output_usd_per_mtok": kept.output_usd_per_mtok if kept else output_usd,
                "visibility": visibility,
                "is_default": default,
                "sort_order": order,
            }
        )
    for order, (model_id, row) in enumerate(sorted(existing.items()), start=100):
        rows.append(
            {
                "provider": "anthropic",
                "model_id": model_id,
                "label": (row.display_name or model_id)[:60],
                "description": "",
                "input_usd_per_mtok": row.input_usd_per_mtok,
                "output_usd_per_mtok": row.output_usd_per_mtok,
                "visibility": "disabled",
                "is_default": False,
                "sort_order": order,
            }
        )

    catalogue = sa.table(
        "chat_models",
        sa.column("provider", sa.String),
        sa.column("model_id", sa.String),
        sa.column("label", sa.String),
        sa.column("description", sa.String),
        sa.column("input_usd_per_mtok", sa.Numeric),
        sa.column("output_usd_per_mtok", sa.Numeric),
        sa.column("visibility", sa.String),
        sa.column("is_default", sa.Boolean),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(catalogue, rows)

    with op.batch_alter_table("conversations") as batch:
        batch.add_column(sa.Column("chat_model_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_conversations_chat_model_id",
            "chat_models",
            ["chat_model_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.drop_table("claude_model_prices")


def downgrade() -> None:
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
    op.execute(
        "INSERT INTO claude_model_prices "
        "(model_id, display_name, input_usd_per_mtok, output_usd_per_mtok) "
        "SELECT model_id, label, input_usd_per_mtok, output_usd_per_mtok "
        "FROM chat_models WHERE provider = 'anthropic'"
    )

    with op.batch_alter_table("conversations") as batch:
        batch.drop_constraint("fk_conversations_chat_model_id", type_="foreignkey")
        batch.drop_column("chat_model_id")

    op.drop_index("ix_chat_models_provider", table_name="chat_models")
    op.drop_table("chat_models")
