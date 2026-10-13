"""one 동아리 지원 wallet per member per quarter

Decided by the owner on 2026-10-08 (`single-wallet`): members no longer
split their quarter support between Build and Video. Each participating
member has one wallet per quarter, and Chat, video and every other paid
feature spend from it. What a charge was for stays on the usage event
(provider, feature, model, native units).

Upgrade, table by table:

* **quarter_allocations** — `budget_krw` = Build budget + Video budget,
  `consumed_krw` = Build consumed + Video consumed; the six per-bucket
  columns go. The original split is kept in `pricing_snapshot` under
  `split_before_single_wallet`, so the downgrade can put it back exactly.
  (A bucket that had been overspent — possible only after an admin
  lowered it — is absorbed by the other: the wallet's remaining figure is
  the true total, not the sum of two clamped figures.)
* **quarter_applications** — `requested_budget_krw` = requested Build +
  requested Video; the percentages and per-bucket figures go.
* **usage_events** — `community_build` and `community_video` both become
  `community`; `category` goes. Its value is derivable: video generation,
  edit and extension and anything charged by Higgsfield were Video, all
  else was Build — which is how the downgrade rebuilds it.
* **account_withdrawals.reversal** — a released allocation is recorded as
  one `amount` instead of `build` / `video`, so 복구 puts back one figure.

No row is created or deleted, and no won moves: every total is the sum
of what was there.

Revision ID: e8a4c2f6b1d7
Revises: b2f7e4c81d36
Create Date: 2026-10-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e8a4c2f6b1d7"
down_revision: str | None = "b2f7e4c81d36"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SNAPSHOT_KEY = "split_before_single_wallet"

#: Features that were always charged to Video before this migration.
VIDEO_FEATURES = ("video_generate", "video_edit", "video_extend")

_allocations = sa.table(
    "quarter_allocations",
    sa.column("id", sa.Integer),
    sa.column("user_id", sa.Integer),
    sa.column("quarter_id", sa.Integer),
    sa.column("application_id", sa.Integer),
    sa.column("pricing_snapshot", sa.JSON),
)
_withdrawals = sa.table(
    "account_withdrawals",
    sa.column("id", sa.Integer),
    # JSONB on PostgreSQL, as `account_withdrawals` was created.
    sa.column("reversal", sa.JSON().with_variant(postgresql.JSONB(), "postgresql")),
)


def _check(column: str, values: Sequence[str]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


# ---------------------------------------------------------------- upgrade


def upgrade() -> None:
    bind = op.get_bind()

    # --- quarter_allocations ------------------------------------------
    rows = bind.execute(
        sa.text(
            "SELECT id, pricing_snapshot, build_budget_krw, video_budget_krw,"
            " build_percentage, video_percentage, build_consumed_krw, video_consumed_krw"
            " FROM quarter_allocations"
        )
    ).all()
    for row in rows:
        snapshot = dict(_as_dict(row.pricing_snapshot))
        snapshot[SNAPSHOT_KEY] = {
            "build_budget_krw": row.build_budget_krw,
            "video_budget_krw": row.video_budget_krw,
            "build_percentage": row.build_percentage,
            "video_percentage": row.video_percentage,
        }
        bind.execute(
            sa.update(_allocations)
            .where(_allocations.c.id == row.id)
            .values(pricing_snapshot=snapshot)
        )

    with op.batch_alter_table("quarter_allocations") as batch:
        batch.add_column(sa.Column("consumed_krw", sa.Integer(), nullable=True))

    op.execute(
        "UPDATE quarter_allocations"
        " SET community_total_budget_krw = build_budget_krw + video_budget_krw,"
        "     consumed_krw = build_consumed_krw + video_consumed_krw"
    )

    with op.batch_alter_table("quarter_allocations") as batch:
        batch.alter_column(
            "community_total_budget_krw",
            new_column_name="budget_krw",
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
        batch.alter_column("consumed_krw", existing_type=sa.Integer(), nullable=False)
        for column in (
            "build_budget_krw",
            "video_budget_krw",
            "build_percentage",
            "video_percentage",
            "build_consumed_krw",
            "video_consumed_krw",
        ):
            batch.drop_column(column)

    # --- quarter_applications -----------------------------------------
    op.execute(
        "UPDATE quarter_applications"
        " SET requested_total_budget_krw = requested_build_budget_krw + requested_video_budget_krw"
    )
    with op.batch_alter_table("quarter_applications") as batch:
        batch.alter_column(
            "requested_total_budget_krw",
            new_column_name="requested_budget_krw",
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
        for column in (
            "build_percentage",
            "video_percentage",
            "requested_build_budget_krw",
            "requested_video_budget_krw",
        ):
            batch.drop_column(column)

    # --- usage_events -------------------------------------------------
    with op.batch_alter_table("usage_events") as batch:
        batch.drop_constraint("fundingsource", type_="check")
        batch.drop_constraint("budgetcategory", type_="check")
    op.execute(
        "UPDATE usage_events SET funding_source = 'community'"
        " WHERE funding_source IN ('community_build', 'community_video')"
    )
    with op.batch_alter_table("usage_events") as batch:
        batch.drop_column("category")
        batch.create_check_constraint(
            "fundingsource", _check("funding_source", ["community", "personal"])
        )

    # --- account_withdrawals.reversal ---------------------------------
    _rewrite_reversals(bind, _released_as_one_amount)


# -------------------------------------------------------------- downgrade


def downgrade() -> None:
    bind = op.get_bind()

    # --- usage_events: category back, derived; the two community pots back
    with op.batch_alter_table("usage_events") as batch:
        batch.drop_constraint("fundingsource", type_="check")
        batch.add_column(sa.Column("category", sa.String(length=20), nullable=True))
    video_features = ", ".join(f"'{feature}'" for feature in VIDEO_FEATURES)
    op.execute(
        "UPDATE usage_events SET category = CASE"
        f" WHEN feature IN ({video_features}) OR provider = 'higgsfield' THEN 'video'"
        " ELSE 'build' END"
    )
    op.execute(
        "UPDATE usage_events SET funding_source = CASE"
        " WHEN category = 'video' THEN 'community_video' ELSE 'community_build' END"
        " WHERE funding_source = 'community'"
    )
    with op.batch_alter_table("usage_events") as batch:
        batch.alter_column("category", existing_type=sa.String(length=20), nullable=False)
        batch.create_check_constraint("budgetcategory", _check("category", ["build", "video"]))
        batch.create_check_constraint(
            "fundingsource",
            _check("funding_source", ["community_build", "community_video", "personal"]),
        )

    # --- quarter_allocations: two buckets again --------------------------
    with op.batch_alter_table("quarter_allocations") as batch:
        batch.alter_column(
            "budget_krw",
            new_column_name="community_total_budget_krw",
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
        for column in (
            "build_budget_krw",
            "video_budget_krw",
            "build_percentage",
            "video_percentage",
            "build_consumed_krw",
            "video_consumed_krw",
        ):
            batch.add_column(sa.Column(column, sa.Integer(), nullable=True))

    # What each bucket spent, from the ledger (category as derived above).
    spent = {
        (row.user_id, row.quarter_id, row.category): int(row.total)
        for row in bind.execute(
            sa.text(
                "SELECT user_id, quarter_id, category, SUM(charged_krw) AS total"
                " FROM usage_events WHERE funding_source <> 'personal'"
                " AND quarter_id IS NOT NULL"
                " GROUP BY user_id, quarter_id, category"
            )
        )
    }
    #: application id -> the split its approved wallet had
    application_splits: dict[int, dict] = {}
    for row in bind.execute(
        sa.text(
            "SELECT id, user_id, quarter_id, application_id, pricing_snapshot,"
            " community_total_budget_krw AS budget, consumed_krw AS consumed"
            " FROM quarter_allocations"
        )
    ).all():
        snapshot = dict(_as_dict(row.pricing_snapshot))
        before = snapshot.pop(SNAPSHOT_KEY, None)
        video_consumed = min(row.consumed, spent.get((row.user_id, row.quarter_id, "video"), 0))
        build_consumed = row.consumed - video_consumed

        if before and before["build_budget_krw"] + before["video_budget_krw"] == row.budget:
            build_budget = before["build_budget_krw"]
            video_budget = before["video_budget_krw"]
            build_pct, video_pct = before["build_percentage"], before["video_percentage"]
        else:
            # The total moved after the upgrade (an adjustment, a release)
            # or the wallet is newer than it: give Video what it spent, the
            # rest to Build, so neither bucket starts overdrawn.
            video_budget = min(row.budget, video_consumed)
            build_budget = row.budget - video_budget
            build_pct = round(build_budget * 100 / row.budget) if row.budget else 100
            video_pct = 100 - build_pct
        if row.application_id is not None:
            application_splits[row.application_id] = {
                "build_percentage": build_pct,
                "video_percentage": video_pct,
            }

        bind.execute(
            sa.text(
                "UPDATE quarter_allocations SET"
                " build_budget_krw = :bb, video_budget_krw = :vb,"
                " build_percentage = :bp, video_percentage = :vp,"
                " build_consumed_krw = :bc, video_consumed_krw = :vc"
                " WHERE id = :id"
            ),
            {
                "bb": build_budget,
                "vb": video_budget,
                "bp": build_pct,
                "vp": video_pct,
                "bc": build_consumed,
                "vc": video_consumed,
                "id": row.id,
            },
        )
        bind.execute(
            sa.update(_allocations)
            .where(_allocations.c.id == row.id)
            .values(pricing_snapshot=snapshot)
        )

    with op.batch_alter_table("quarter_allocations") as batch:
        for column in (
            "build_budget_krw",
            "video_budget_krw",
            "build_percentage",
            "video_percentage",
            "build_consumed_krw",
            "video_consumed_krw",
        ):
            batch.alter_column(column, existing_type=sa.Integer(), nullable=False)
        batch.drop_column("consumed_krw")

    # --- quarter_applications: a split again ------------------------------
    with op.batch_alter_table("quarter_applications") as batch:
        batch.alter_column(
            "requested_budget_krw",
            new_column_name="requested_total_budget_krw",
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
        for column in (
            "build_percentage",
            "video_percentage",
            "requested_build_budget_krw",
            "requested_video_budget_krw",
        ):
            batch.add_column(sa.Column(column, sa.Integer(), nullable=True))

    for row in bind.execute(
        sa.text("SELECT id, requested_total_budget_krw AS total FROM quarter_applications")
    ).all():
        # The approved wallet's split when there is one; otherwise all Build.
        split = application_splits.get(row.id, {"build_percentage": 100, "video_percentage": 0})
        build = row.total * split["build_percentage"] // 100
        bind.execute(
            sa.text(
                "UPDATE quarter_applications SET"
                " build_percentage = :bp, video_percentage = :vp,"
                " requested_build_budget_krw = :bb, requested_video_budget_krw = :vb"
                " WHERE id = :id"
            ),
            {
                "bp": split["build_percentage"],
                "vp": split["video_percentage"],
                "bb": build,
                "vb": row.total - build,
                "id": row.id,
            },
        )

    with op.batch_alter_table("quarter_applications") as batch:
        for column in (
            "build_percentage",
            "video_percentage",
            "requested_build_budget_krw",
            "requested_video_budget_krw",
        ):
            batch.alter_column(column, existing_type=sa.Integer(), nullable=False)

    # --- account_withdrawals.reversal -------------------------------------
    _rewrite_reversals(bind, _released_as_build_and_video)


# ---------------------------------------------------------------- helpers


def _as_dict(value) -> dict:
    """A JSON column's value as a dict, whichever way the driver returns it."""
    if value is None:
        return {}
    if isinstance(value, str):
        import json

        return json.loads(value) or {}
    return value


def _released_as_one_amount(item: dict) -> dict:
    if "amount" in item:
        return item
    return {"id": item["id"], "amount": item.get("build", 0) + item.get("video", 0)}


def _released_as_build_and_video(item: dict) -> dict:
    if "amount" not in item:
        return item
    return {"id": item["id"], "build": item["amount"], "video": 0}


def _rewrite_reversals(bind, rewrite) -> None:
    for row in bind.execute(sa.text("SELECT id, reversal FROM account_withdrawals")).all():
        reversal = dict(_as_dict(row.reversal))
        allocations = reversal.get("allocations") or []
        if not allocations:
            continue
        reversal["allocations"] = [rewrite(item) for item in allocations]
        bind.execute(
            sa.update(_withdrawals)
            .where(_withdrawals.c.id == row.id)
            .values(reversal=reversal)
        )
