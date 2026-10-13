"""deepseek: a catalogue row for a provider not connected yet

admin-and-nav-cleanup (owner, 2026-10-14). Admin › AI Models groups the
catalogue by provider; DeepSeek is listed as 연결 준비 중 with the model
docs/research/deepseek-research.md recommends (V4.1 Flash through US
hosts, never DeepSeek's own API) at the research's prices. Closed: the
backend refuses to open it or make it the default until an adapter exists
(more-chat-providers). Inserted only if absent, so a re-run or an admin's
own row is left alone.

Revision ID: c4d8e2a6f1b9
Revises: f2c8a6d4e1b3
Create Date: 2026-10-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4d8e2a6f1b9"
down_revision: str | None = "f2c8a6d4e1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROVIDER = "deepseek"
MODEL_ID = "deepseek/deepseek-v4.1-flash"


def upgrade() -> None:
    connection = op.get_bind()
    exists = connection.execute(
        sa.text("SELECT 1 FROM chat_models WHERE provider = :p AND model_id = :m"),
        {"p": PROVIDER, "m": MODEL_ID},
    ).first()
    if exists is not None:
        return
    connection.execute(
        sa.text(
            "INSERT INTO chat_models (provider, model_id, label, description, "
            "input_usd_per_mtok, output_usd_per_mtok, visibility, is_default, sort_order, "
            "created_at, updated_at) VALUES (:p, :m, :label, :description, 0.30, 1.20, "
            "'disabled', false, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {
            "p": PROVIDER,
            "m": MODEL_ID,
            "label": "DeepSeek V4.1 Flash",
            "description": "아주 저렴한 모델. 미국 서버에서만 쓸 예정이며 아직 연결되지 않았습니다.",
        },
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM chat_models WHERE provider = :p AND model_id = :m").bindparams(
            p=PROVIDER, m=MODEL_ID
        )
    )
