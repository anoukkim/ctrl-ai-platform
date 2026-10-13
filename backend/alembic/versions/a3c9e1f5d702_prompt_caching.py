"""prompt caching: cache-read prices and cache token counts

`prompt-caching` (2026-10-13). Chat marks its prompt as cacheable, and the
ledger then prices three kinds of input separately — uncached input, cache
writes and cache reads — instead of adding cache tokens to input at the
full price.

* `chat_models.cache_read_usd_per_mtok` — nullable; null means a tenth of
  the input price. Seeded for the three default models at Anthropic's list
  prices (Haiku 4.5 $0.10, Sonnet 5.5 $0.20, Opus 5.5 $0.20). A row an
  admin added keeps null.
* `usage_events.cache_write_tokens` / `cache_read_tokens` — nullable;
  older rows had no caching, so null is the truth for them.

Revision ID: a3c9e1f5d702
Revises: e8a4c2f6b1d7
Create Date: 2026-10-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3c9e1f5d702"
down_revision: str | None = "e8a4c2f6b1d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Anthropic's cache-read list prices, dollars per million tokens.
CACHE_READ_LIST_PRICES = {
    "claude-haiku-4-5": "0.10",
    "claude-sonnet-5-5": "0.20",
    "claude-opus-5-5": "0.20",
}


def upgrade() -> None:
    with op.batch_alter_table("chat_models") as batch:
        batch.add_column(sa.Column("cache_read_usd_per_mtok", sa.Numeric(10, 4), nullable=True))
    with op.batch_alter_table("usage_events") as batch:
        batch.add_column(sa.Column("cache_write_tokens", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("cache_read_tokens", sa.Integer(), nullable=True))

    bind = op.get_bind()
    for model_id, price in CACHE_READ_LIST_PRICES.items():
        bind.execute(
            sa.text(
                "UPDATE chat_models SET cache_read_usd_per_mtok = :price"
                " WHERE model_id = :model_id AND provider = 'anthropic'"
            ),
            {"price": price, "model_id": model_id},
        )


def downgrade() -> None:
    # Before this revision `input_tokens` was the whole prompt; fold the
    # cache tokens back in so those rows still add up.
    op.execute(
        "UPDATE usage_events SET input_tokens = COALESCE(input_tokens, 0)"
        " + COALESCE(cache_write_tokens, 0) + COALESCE(cache_read_tokens, 0)"
        " WHERE cache_write_tokens IS NOT NULL OR cache_read_tokens IS NOT NULL"
    )
    with op.batch_alter_table("usage_events") as batch:
        batch.drop_column("cache_read_tokens")
        batch.drop_column("cache_write_tokens")
    with op.batch_alter_table("chat_models") as batch:
        batch.drop_column("cache_read_usd_per_mtok")
