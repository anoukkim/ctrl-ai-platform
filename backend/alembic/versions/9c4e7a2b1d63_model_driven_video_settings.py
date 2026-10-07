"""model-driven video settings, edit and extend, usage feature tag

Three things, for `video-higgsfield-only`:

1. **The video catalogue gets a fixed shape.** `video_models.capabilities`
   was free-form JSON. Every row is rewritten into the shape
   `VideoCapabilities` validates: lengths, ratios, resolutions, sound,
   edit and extend support, defaults, and a price per second for each
   resolution. What a row already said about lengths, ratios and sound is
   kept. Resolutions, prices and edit/extend support did not exist, so
   they come from the placeholder table below — the same figures the seed
   uses, agreed as placeholders on 2026-10-07 and marked
   `prices_are_examples` so Admin shows them as 예시.

2. **A version records how it was made.** `kind` (generate / edit /
   extend), `source_version_id`, `instruction` and `resolution`. Existing
   versions were all plain generations — nothing else existed — so `kind`
   is backfilled as `generate`, which is the truth rather than a guess.
   Their resolution is genuinely unknown and stays null.

3. **A usage event records which feature spent the money** (`feature`)
   and which version it produced (`video_version_id`). Null on existing
   rows: what they were for is not recorded anywhere.

The placeholder table is copied here rather than imported from the
application: a migration is a snapshot, and must do the same thing next
year that it does today.

Revision ID: 9c4e7a2b1d63
Revises: b6d4e2f81a37
Create Date: 2026-10-07

"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9c4e7a2b1d63"
down_revision: str | None = "b6d4e2f81a37"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ASPECTS = ("9:16", "16:9", "1:1")

#: model_id -> (resolutions with price per second, supports_edit, supports_extend)
PLACEHOLDERS = {
    "kling-3.0-pro": ({"720p": 700, "1080p": 1000}, True, True),
    "seedance-2.0": ({"480p": 300, "720p": 500}, False, True),
    "wan-3.0": ({"720p": 400}, False, False),
}
#: Anything else an admin may have added by hand.
FALLBACK = ({"720p": 500}, False, False)


def _reshape(model_id: str, old: dict) -> dict:
    durations = sorted({int(d) for d in old.get("durations") or [] if 1 <= int(d) <= 60}) or [5]
    aspects = [a for a in ASPECTS if a in (old.get("aspect_ratios") or [])] or ["9:16"]
    sound = bool(old.get("sound", False))
    prices, edit, extend = PLACEHOLDERS.get(model_id, FALLBACK)
    resolutions = list(prices)
    return {
        "durations": durations,
        "aspect_ratios": aspects,
        "resolutions": resolutions,
        "sound": sound,
        "supports_edit": edit,
        "supports_extend": extend,
        "price_per_second_krw": dict(prices),
        "defaults": {
            "duration_seconds": durations[0],
            "aspect_ratio": aspects[0],
            "resolution": resolutions[0],
            "sound": sound,
        },
        "prices_are_examples": True,
    }


def upgrade() -> None:
    op.add_column("video_versions", sa.Column("resolution", sa.String(length=10), nullable=True))
    op.add_column(
        "video_versions",
        sa.Column(
            "kind",
            sa.Enum(
                "generate",
                "edit",
                "extend",
                name="videoversionkind",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            server_default="generate",
            nullable=False,
        ),
    )
    op.add_column("video_versions", sa.Column("source_version_id", sa.Integer(), nullable=True))
    op.add_column("video_versions", sa.Column("instruction", sa.Text(), nullable=True))

    op.add_column("usage_events", sa.Column("feature", sa.String(length=30), nullable=True))
    op.add_column("usage_events", sa.Column("video_version_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "usage_events_video_version_id_fkey",
        "usage_events",
        "video_versions",
        ["video_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    connection = op.get_bind()
    models = sa.table(
        "video_models",
        sa.column("id", sa.Integer),
        sa.column("model_id", sa.String),
        sa.column("capabilities", sa.JSON),
    )
    for row in connection.execute(sa.select(models.c.id, models.c.model_id, models.c.capabilities)):
        old = row.capabilities
        if isinstance(old, str):
            old = json.loads(old)
        connection.execute(
            models.update()
            .where(models.c.id == row.id)
            .values(capabilities=_reshape(row.model_id, old or {}))
        )


def downgrade() -> None:
    # The catalogue keeps its new shape: the old code read only `durations`,
    # `aspect_ratios` and `sound`, which are all still there, and ignored
    # the rest. Turning the prices back into nothing would only lose data.
    op.drop_constraint("usage_events_video_version_id_fkey", "usage_events", type_="foreignkey")
    op.drop_column("usage_events", "video_version_id")
    op.drop_column("usage_events", "feature")
    op.drop_column("video_versions", "instruction")
    op.drop_column("video_versions", "source_version_id")
    op.drop_column("video_versions", "kind")
    op.drop_column("video_versions", "resolution")
