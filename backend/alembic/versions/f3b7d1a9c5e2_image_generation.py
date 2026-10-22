"""image-generation: the image model catalogue and images made in Chat

* `image_models` — the catalogue, shaped like `video_models`, seeded with
  Google's two Gemini image models. The won prices are examples
  (`prices_are_examples`) until an admin saves the model: Google's list
  price per image (2026-10-22, ai.google.dev/gemini-api/docs/pricing) at
  about 1,400원/$, rounded up.
* `chat_messages.action_prompt` and the `image` action — a reply may
  offer an 이미지 만들기 card; the CHECK constraint the non-native enum
  carries is rebuilt with the new value.
* `chat_attachments.generated_model` / `prompt` — a picture CTRL+AI made,
  as opposed to one the member uploaded.

Revision ID: f3b7d1a9c5e2
Revises: e5a9c3d7b2f4
Create Date: 2026-10-22

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3b7d1a9c5e2"
down_revision: str | None = "e5a9c3d7b2f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"]

#: The same rows as `app.db.init_db.SEED_IMAGE_MODELS`, written here so a
#: deployed server has them after `alembic upgrade head` alone.
SEED = [
    {
        "provider": "gemini",
        "model_id": "gemini-nano-banana-2.1",
        "display_name": "Nano Banana 2.1",
        "description": "빠르고 저렴합니다. 대부분의 그림에 알맞은 기본 모델입니다.",
        "enabled": True,
        "member_visible": True,
        "sort_order": 10,
        "capabilities": {
            "sizes": ["1K", "2K", "4K"],
            "aspect_ratios": _RATIOS,
            "price_per_image_krw": {"1K": 50, "2K": 75, "4K": 160},
            "usd_per_image": {"1K": 0.0336, "2K": 0.0504, "4K": 0.113},
            "defaults": {"size": "1K", "aspect_ratio": "1:1"},
            "prices_are_examples": True,
        },
    },
    {
        "provider": "gemini",
        "model_id": "gemini-3-pro-image",
        "display_name": "Nano Banana Pro",
        "description": "글자와 세부 표현이 더 정확한 고품질 모델입니다. 가격이 약 4배입니다.",
        "enabled": True,
        "member_visible": False,
        "sort_order": 20,
        "capabilities": {
            "sizes": ["1K", "2K", "4K"],
            "aspect_ratios": _RATIOS,
            "price_per_image_krw": {"1K": 190, "2K": 190, "4K": 340},
            "usd_per_image": {"1K": 0.134, "2K": 0.134, "4K": 0.24},
            "defaults": {"size": "1K", "aspect_ratio": "1:1"},
            "prices_are_examples": True,
        },
    },
]


def _check(values: list[str]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"action IN ({quoted})"


def upgrade() -> None:
    table = op.create_table(
        "image_models",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model_id", sa.String(length=120), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("member_visible", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_image_models_provider", "image_models", ["provider"])
    op.bulk_insert(table, SEED)

    with op.batch_alter_table("chat_messages") as batch:
        batch.add_column(sa.Column("action_prompt", sa.Text(), nullable=False, server_default=""))
        batch.drop_constraint("chataction", type_="check")
        batch.create_check_constraint("chataction", _check(["builder", "video", "image"]))

    with op.batch_alter_table("chat_attachments") as batch:
        batch.add_column(sa.Column("generated_model", sa.String(length=120), nullable=True))
        batch.add_column(sa.Column("prompt", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    # Without `generated_model` the old code would send these pictures back
    # to Claude inside an assistant turn, which the API refuses — so the
    # rows go. Their stored files are left behind (orphans in var/storage).
    op.execute("DELETE FROM chat_attachments WHERE generated_model IS NOT NULL")
    with op.batch_alter_table("chat_attachments") as batch:
        batch.drop_column("prompt")
        batch.drop_column("generated_model")

    op.execute("UPDATE chat_messages SET action = NULL WHERE action = 'image'")
    with op.batch_alter_table("chat_messages") as batch:
        batch.drop_constraint("chataction", type_="check")
        batch.create_check_constraint("chataction", _check(["builder", "video"]))
        batch.drop_column("action_prompt")

    op.drop_index("ix_image_models_provider", table_name="image_models")
    op.drop_table("image_models")
