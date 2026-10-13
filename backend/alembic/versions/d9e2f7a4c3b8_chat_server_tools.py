"""chat-plus-tools: per-model tool switches, per-conversation toggles, fees

Three Anthropic server tools (웹 검색, 웹 페이지 읽기, 코드 실행) — mock
only until Phase 9. An admin opens each tool per catalogue model; a member
turns it on per conversation (per conversation, not per message, because
the tool list breaks the prompt cache). The ledger records how many
searches a reply used and the won the fee added, so Budget still adds up.
A reply's sources (web search citations) are stored with it.

Everything defaults to off/empty, so existing rows and old code paths are
untouched.

Revision ID: d9e2f7a4c3b8
Revises: b5d7f3a2c8e1
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9e2f7a4c3b8"
down_revision: str | None = "b5d7f3a2c8e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_models",
        sa.Column("tools_web_search", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "chat_models",
        sa.Column("tools_web_fetch", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "chat_models",
        sa.Column(
            "tools_code_execution", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    # $ per web search ($10 per 1,000 → 0.01). A catalogue value so the
    # admin can follow a price change without a deploy.
    op.add_column(
        "chat_models",
        sa.Column(
            "web_search_usd_per_call",
            sa.Numeric(10, 6),
            nullable=False,
            server_default="0.01",
        ),
    )

    op.add_column(
        "conversations",
        sa.Column("use_web_search", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "conversations",
        sa.Column("use_web_fetch", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "conversations",
        sa.Column(
            "use_code_execution", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )

    op.add_column("chat_messages", sa.Column("sources", sa.JSON(), nullable=True))

    op.add_column("usage_events", sa.Column("web_search_count", sa.Integer(), nullable=True))
    op.add_column("usage_events", sa.Column("tool_fee_krw", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("usage_events", "tool_fee_krw")
    op.drop_column("usage_events", "web_search_count")
    op.drop_column("chat_messages", "sources")
    op.drop_column("conversations", "use_code_execution")
    op.drop_column("conversations", "use_web_fetch")
    op.drop_column("conversations", "use_web_search")
    op.drop_column("chat_models", "web_search_usd_per_call")
    op.drop_column("chat_models", "tools_code_execution")
    op.drop_column("chat_models", "tools_web_fetch")
    op.drop_column("chat_models", "tools_web_search")
