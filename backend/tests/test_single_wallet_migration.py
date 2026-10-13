"""The single-wallet migration keeps every won where it was.

The tests build their schema from the models, which already have one
wallet, so the migration is run here against tables created in their
*old* shape — the four it touches, with the CHECK constraints the
non-native enums carried — on a throwaway SQLite database. Nothing here
reaches PostgreSQL or the developer's database.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _old_schema(metadata: sa.MetaData) -> None:
    sa.Table(
        "quarter_applications",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("quarter_id", sa.Integer, nullable=False),
        sa.Column("build_percentage", sa.Integer, nullable=False),
        sa.Column("video_percentage", sa.Integer, nullable=False),
        sa.Column("requested_total_budget_krw", sa.Integer, nullable=False),
        sa.Column("requested_build_budget_krw", sa.Integer, nullable=False),
        sa.Column("requested_video_budget_krw", sa.Integer, nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
    )
    sa.Table(
        "quarter_allocations",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("quarter_id", sa.Integer, nullable=False),
        sa.Column("application_id", sa.Integer, nullable=True),
        sa.Column("community_total_budget_krw", sa.Integer, nullable=False),
        sa.Column("build_budget_krw", sa.Integer, nullable=False),
        sa.Column("video_budget_krw", sa.Integer, nullable=False),
        sa.Column("build_percentage", sa.Integer, nullable=False),
        sa.Column("video_percentage", sa.Integer, nullable=False),
        sa.Column("build_consumed_krw", sa.Integer, nullable=False),
        sa.Column("video_consumed_krw", sa.Integer, nullable=False),
        sa.Column("pricing_snapshot", sa.JSON, nullable=False),
    )
    sa.Table(
        "usage_events",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("quarter_id", sa.Integer, nullable=True),
        sa.Column(
            "category",
            sa.Enum("build", "video", name="budgetcategory", native_enum=False,
                    create_constraint=True, length=20),
            nullable=False,
        ),
        sa.Column(
            "funding_source",
            sa.Enum("community_build", "community_video", "personal", name="fundingsource",
                    native_enum=False, create_constraint=True, length=20),
            nullable=False,
        ),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("feature", sa.String(30), nullable=True),
        sa.Column("charged_krw", sa.Integer, nullable=False),
    )
    sa.Table(
        "account_withdrawals",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("reversal", sa.JSON, nullable=False),
    )


#: Two members' old-shape rows. Member 2 overspent Build after an admin
#: lowered it (12,000 of 10,000) — the case where the old screens showed
#: 0 + 30,000 left and the wallet, correctly, shows 28,000.
ALLOCATIONS = [
    dict(id=1, user_id=1, quarter_id=1, application_id=1, community_total_budget_krw=100_000,
         build_budget_krw=70_000, video_budget_krw=30_000, build_percentage=70,
         video_percentage=30, build_consumed_krw=24_500, video_consumed_krw=12_000,
         pricing_snapshot={"captured_at": "2026-07-01T00:00:00+00:00"}),
    dict(id=2, user_id=2, quarter_id=1, application_id=2, community_total_budget_krw=40_000,
         build_budget_krw=10_000, video_budget_krw=30_000, build_percentage=25,
         video_percentage=75, build_consumed_krw=12_000, video_consumed_krw=0,
         pricing_snapshot={}),
]
APPLICATIONS = [
    dict(id=1, user_id=1, quarter_id=1, build_percentage=70, video_percentage=30,
         requested_total_budget_krw=100_000, requested_build_budget_krw=70_000,
         requested_video_budget_krw=30_000, status="approved"),
    dict(id=2, user_id=2, quarter_id=1, build_percentage=50, video_percentage=50,
         requested_total_budget_krw=100_000, requested_build_budget_krw=50_000,
         requested_video_budget_krw=50_000, status="approved"),
    dict(id=3, user_id=3, quarter_id=1, build_percentage=20, video_percentage=80,
         requested_total_budget_krw=100_000, requested_build_budget_krw=20_000,
         requested_video_budget_krw=80_000, status="submitted"),
]
EVENTS = [
    dict(id=1, user_id=1, quarter_id=1, category="build", funding_source="community_build",
         provider="claude", feature="chat", charged_krw=24_500),
    dict(id=2, user_id=1, quarter_id=1, category="video", funding_source="community_video",
         provider="higgsfield", feature="video_generate", charged_krw=12_000),
    dict(id=3, user_id=1, quarter_id=1, category="build", funding_source="personal",
         provider="claude", feature="chat", charged_krw=5_000),
    dict(id=4, user_id=2, quarter_id=1, category="build", funding_source="community_build",
         provider="claude", feature="video_prompt", charged_krw=12_000),
]


@pytest.fixture
def old_database():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    _old_schema(metadata)
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(metadata.tables["quarter_allocations"].insert(), ALLOCATIONS)
        connection.execute(metadata.tables["quarter_applications"].insert(), APPLICATIONS)
        connection.execute(metadata.tables["usage_events"].insert(), EVENTS)
        connection.execute(
            metadata.tables["account_withdrawals"].insert(),
            [{"id": 1, "reversal": {"allocations": [{"id": 2, "build": 0, "video": 30_000}],
                                     "memberships": []}}],
        )
    yield engine
    engine.dispose()


def _migration():
    path = next(Path("alembic/versions").glob("e8a4c2f6b1d7_*.py"))
    spec = importlib.util.spec_from_file_location("single_wallet_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, step: str) -> None:
    migration = _migration()
    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        getattr(migration, step)()


def _rows(engine, sql: str) -> list[dict]:
    with engine.connect() as connection:
        return [dict(row._mapping) for row in connection.execute(sa.text(sql))]


def _total(engine, sql: str) -> int:
    with engine.connect() as connection:
        return int(connection.execute(sa.text(sql)).scalar() or 0)


def test_upgrade_sums_each_wallet_and_keeps_every_total(old_database) -> None:
    budget_before = _total(old_database,
                           "SELECT SUM(build_budget_krw + video_budget_krw) FROM quarter_allocations")
    spent_before = _total(old_database,
                          "SELECT SUM(build_consumed_krw + video_consumed_krw) FROM quarter_allocations")
    charged_before = _total(old_database, "SELECT SUM(charged_krw) FROM usage_events")

    _run(old_database, "upgrade")

    wallets = _rows(old_database,
                    "SELECT id, budget_krw, consumed_krw FROM quarter_allocations ORDER BY id")
    assert wallets == [
        {"id": 1, "budget_krw": 100_000, "consumed_krw": 36_500},
        {"id": 2, "budget_krw": 40_000, "consumed_krw": 12_000},
    ]
    assert _total(old_database, "SELECT SUM(budget_krw) FROM quarter_allocations") == budget_before
    assert _total(old_database, "SELECT SUM(consumed_krw) FROM quarter_allocations") == spent_before
    assert _total(old_database, "SELECT SUM(charged_krw) FROM usage_events") == charged_before
    # The wallet's spend equals what the ledger says came out of the club's pot.
    assert _total(
        old_database, "SELECT SUM(charged_krw) FROM usage_events WHERE funding_source = 'community'"
    ) == spent_before


def test_upgrade_folds_the_two_community_pots_into_one(old_database) -> None:
    _run(old_database, "upgrade")

    sources = _rows(old_database, "SELECT id, funding_source FROM usage_events ORDER BY id")
    assert [row["funding_source"] for row in sources] == [
        "community", "community", "personal", "community"
    ]
    columns = {c["name"] for c in sa.inspect(old_database).get_columns("usage_events")}
    assert "category" not in columns
    # Provider, feature and amount are what still say where the money went.
    assert {"provider", "feature", "charged_krw"} <= columns


def test_upgrade_drops_the_split_from_applications(old_database) -> None:
    _run(old_database, "upgrade")

    columns = {c["name"] for c in sa.inspect(old_database).get_columns("quarter_applications")}
    assert "requested_budget_krw" in columns
    assert not {c for c in columns if "build" in c or "video" in c or "percentage" in c}
    assert [row["requested_budget_krw"] for row in _rows(
        old_database, "SELECT requested_budget_krw FROM quarter_applications ORDER BY id"
    )] == [100_000, 100_000, 100_000]


def test_upgrade_rewrites_a_withdrawal_release_as_one_amount(old_database) -> None:
    _run(old_database, "upgrade")

    [row] = _rows(old_database, "SELECT reversal FROM account_withdrawals")
    reversal = row["reversal"]
    reversal = reversal if isinstance(reversal, dict) else __import__("json").loads(reversal)
    assert reversal["allocations"] == [{"id": 2, "amount": 30_000}]


def test_downgrade_puts_the_original_split_back(old_database) -> None:
    before = _rows(old_database,
                   "SELECT id, build_budget_krw, video_budget_krw, build_percentage,"
                   " video_percentage, build_consumed_krw, video_consumed_krw"
                   " FROM quarter_allocations ORDER BY id")
    sources_before = _rows(old_database,
                           "SELECT id, category, funding_source FROM usage_events ORDER BY id")

    _run(old_database, "upgrade")
    _run(old_database, "downgrade")

    after = _rows(old_database,
                  "SELECT id, build_budget_krw, video_budget_krw, build_percentage,"
                  " video_percentage, build_consumed_krw, video_consumed_krw"
                  " FROM quarter_allocations ORDER BY id")
    assert after == before
    assert _rows(old_database,
                 "SELECT id, category, funding_source FROM usage_events ORDER BY id") == sources_before
    applications = _rows(old_database,
                         "SELECT id, build_percentage, requested_build_budget_krw,"
                         " requested_video_budget_krw FROM quarter_applications ORDER BY id")
    # The two approved ones take their wallet's split; the pending one,
    # which never had a wallet, comes back as all Build.
    assert applications == [
        {"id": 1, "build_percentage": 70, "requested_build_budget_krw": 70_000,
         "requested_video_budget_krw": 30_000},
        {"id": 2, "build_percentage": 25, "requested_build_budget_krw": 25_000,
         "requested_video_budget_krw": 75_000},
        {"id": 3, "build_percentage": 100, "requested_build_budget_krw": 100_000,
         "requested_video_budget_krw": 0},
    ]


def test_downgrade_of_a_changed_wallet_never_starts_a_bucket_overdrawn(old_database) -> None:
    _run(old_database, "upgrade")
    # After the upgrade the member spends 20,000 on video from the one
    # wallet and an admin raises the wallet — the old split no longer fits.
    with old_database.begin() as connection:
        connection.execute(sa.text(
            "UPDATE quarter_allocations SET budget_krw = 120000, consumed_krw = 56500 WHERE id = 1"
        ))
        connection.execute(sa.text(
            "INSERT INTO usage_events (id, user_id, quarter_id, funding_source, provider,"
            " feature, charged_krw) VALUES (5, 1, 1, 'community', 'higgsfield',"
            " 'video_generate', 20000)"
        ))

    _run(old_database, "downgrade")

    [row] = _rows(old_database,
                  "SELECT community_total_budget_krw AS total, build_budget_krw, video_budget_krw,"
                  " build_consumed_krw, video_consumed_krw FROM quarter_allocations WHERE id = 1")
    assert row["build_budget_krw"] + row["video_budget_krw"] == row["total"] == 120_000
    assert row["build_consumed_krw"] + row["video_consumed_krw"] == 56_500
    assert row["video_consumed_krw"] == 32_000
    assert row["video_budget_krw"] >= row["video_consumed_krw"]
    assert row["build_budget_krw"] >= row["build_consumed_krw"]
