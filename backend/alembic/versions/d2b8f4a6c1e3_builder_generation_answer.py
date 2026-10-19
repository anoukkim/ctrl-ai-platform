"""builder-answer-only: a Builder question gets an answer, not a build

`builder_generations.answer` holds Claude's reply when the member asked a
question ("검색은 어디서 해?", "빌드하지 말고 답만 해") instead of asking
for a change. With no suggested change the row is `answered` and nothing
runs; with one it is `planned` and the member presses 적용하기.

Revision ID: d2b8f4a6c1e3
Revises: c5e1a7d3b9f2
Create Date: 2026-10-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d2b8f4a6c1e3"
down_revision: str | None = "c5e1a7d3b9f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "builder_generations",
        sa.Column("answer", sa.Text(), server_default="", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("builder_generations", "answer")
