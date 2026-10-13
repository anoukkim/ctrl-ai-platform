"""Sonnet 5.5's cache-read price: 0.20 → 0.10 $/MTok

The official prompt-caching page prices Sonnet 5.5 cache hits at
$0.10/MTok (0.05× its $2 input), not the $0.20 the first seed wrote —
members were charged cache reads at twice the list price
(audit-caching-and-distribution, 2026-10-14; source:
https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching).

Only a row still holding the old seeded value is touched, so a price an
admin set on purpose stays exactly as they set it. Past usage events are
history and stay as recorded.

Revision ID: f7c3a9e1d5b2
Revises: d9e2f7a4c3b8
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f7c3a9e1d5b2"
down_revision: str | None = "d9e2f7a4c3b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MODEL_ID = "claude-sonnet-5-5"


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE chat_models SET cache_read_usd_per_mtok = 0.10 "
            "WHERE provider = 'anthropic' AND model_id = :m "
            "AND cache_read_usd_per_mtok = 0.20"
        ),
        {"m": MODEL_ID},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE chat_models SET cache_read_usd_per_mtok = 0.20 "
            "WHERE provider = 'anthropic' AND model_id = :m "
            "AND cache_read_usd_per_mtok = 0.10"
        ),
        {"m": MODEL_ID},
    )
