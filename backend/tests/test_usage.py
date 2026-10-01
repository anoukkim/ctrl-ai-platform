"""Charging a budget, and the audit trail behind admin changes.

The interesting test here is `test_concurrent_charges_cannot_overspend`.
Everything else checks a rule; that one checks that the rule survives two
requests arriving at once, which is the failure a single-threaded test
cannot see.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    BudgetCategory,
    FundingSource,
    MembershipStatus,
    Quarter,
    QuarterAllocation,
    QuarterStatus,
    UsageEvent,
)
from app.services import usage as usage_service
from app.services.quarters import set_membership
from app.services.wallet import get_or_create_balance
from tests.conftest import DEV_PASSWORD


@pytest.fixture
def funded(db_session: Session, dev_user):
    """An active quarter, active membership, and an approved allocation.

    Build 70,000원 and Video 30,000원 — the split used throughout the docs.
    """
    quarter = Quarter(
        code="2026-Q4",
        display_name="2026 Q4",
        starts_at=date(2026, 10, 1),
        ends_at=date(2026, 12, 31),
        status=QuarterStatus.ACTIVE,
        subsidy_limit_krw=100_000,
    )
    db_session.add(quarter)
    db_session.flush()

    set_membership(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)
    allocation = QuarterAllocation(
        user_id=dev_user.id,
        quarter_id=quarter.id,
        community_total_budget_krw=100_000,
        build_budget_krw=70_000,
        video_budget_krw=30_000,
        build_percentage=70,
        video_percentage=30,
    )
    db_session.add(allocation)
    db_session.commit()
    return quarter


# ------------------------------------------------------------- deduction


def test_a_charge_deducts_and_records_one_event(
    db_session: Session, dev_user, funded
) -> None:
    result = usage_service.charge(
        db_session,
        user=dev_user,
        category=BudgetCategory.BUILD,
        amount_krw=24_500,
        provider="claude",
    )

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.build_consumed_krw == 24_500
    assert allocation.build_remaining_krw == 45_500
    # The Video budget is untouched: a Build charge never crosses over.
    assert allocation.video_consumed_krw == 0

    events = db_session.query(UsageEvent).all()
    assert len(events) == 1
    assert events[0].charged_krw == 24_500
    assert events[0].funding_source is FundingSource.COMMUNITY_BUILD
    assert result.community_remaining_krw == 45_500


def test_charges_accumulate(db_session: Session, dev_user, funded) -> None:
    for _ in range(3):
        usage_service.charge(
            db_session,
            user=dev_user,
            category=BudgetCategory.VIDEO,
            amount_krw=10_000,
            provider="higgsfield",
        )

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.video_consumed_krw == 30_000
    assert allocation.video_remaining_krw == 0
    assert db_session.query(UsageEvent).count() == 3


# --------------------------------------------------- insufficient budget


def test_a_charge_larger_than_the_budget_is_refused(
    db_session: Session, dev_user, funded
) -> None:
    with pytest.raises(usage_service.InsufficientBudgetError):
        usage_service.charge(
            db_session,
            user=dev_user,
            category=BudgetCategory.VIDEO,
            amount_krw=30_001,
            provider="higgsfield",
        )

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.video_consumed_krw == 0
    # Nothing is written when nothing is charged.
    assert db_session.query(UsageEvent).count() == 0


def test_the_budget_cannot_be_driven_negative(
    db_session: Session, dev_user, funded
) -> None:
    usage_service.charge(
        db_session, user=dev_user, category=BudgetCategory.VIDEO,
        amount_krw=30_000, provider="higgsfield",
    )

    with pytest.raises(usage_service.InsufficientBudgetError):
        usage_service.charge(
            db_session, user=dev_user, category=BudgetCategory.VIDEO,
            amount_krw=1, provider="higgsfield",
        )

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.video_remaining_krw == 0
    assert allocation.video_consumed_krw == 30_000


# ----------------------------------------------------- personal overage


def test_personal_money_is_not_touched_unless_the_member_opted_in(
    db_session: Session, dev_user, funded
) -> None:
    balance = get_or_create_balance(db_session, dev_user.id)
    balance.balance_krw = 50_000
    db_session.commit()

    with pytest.raises(usage_service.InsufficientBudgetError) as caught:
        usage_service.charge(
            db_session, user=dev_user, category=BudgetCategory.VIDEO,
            amount_krw=40_000, provider="higgsfield",
        )

    assert "개인 사용을 켜" in str(caught.value)
    db_session.refresh(balance)
    assert balance.consumed_krw == 0


def test_personal_money_is_used_once_opted_in(
    db_session: Session, dev_user, funded
) -> None:
    balance = get_or_create_balance(db_session, dev_user.id)
    balance.balance_krw = 50_000
    balance.overage_enabled = True
    db_session.commit()

    result = usage_service.charge(
        db_session, user=dev_user, category=BudgetCategory.VIDEO,
        amount_krw=40_000, provider="higgsfield",
    )

    assert result.funding_source is FundingSource.PERSONAL
    db_session.refresh(balance)
    assert balance.consumed_krw == 40_000
    # The community budget is untouched — the two pots never mix.
    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.video_consumed_krw == 0


# ------------------------------------------------------ inactive member


def test_an_inactive_member_is_refused_at_the_endpoint(
    client: TestClient, dev_user, funded, db_session: Session
) -> None:
    """The guard is on the route, so creation is refused before any charge."""
    set_membership(db_session, dev_user.id, funded.id, MembershipStatus.INACTIVE)
    db_session.commit()

    response = client.post("/api/builder/projects", json={"name": "막혀야 함"})

    assert response.status_code == 403
    assert db_session.query(UsageEvent).count() == 0


# -------------------------------------------------------------- the API


def test_usage_me_reports_budgets_and_events(
    client: TestClient, dev_user, funded, db_session: Session
) -> None:
    usage_service.charge(
        db_session, user=dev_user, category=BudgetCategory.BUILD,
        amount_krw=1_200, provider="claude",
    )

    body = client.get("/api/usage/me").json()

    assert body["quarter_name"] == "2026 Q4"
    assert body["total_budget_krw"] == 100_000
    build = next(c for c in body["categories"] if c["category"] == "build")
    assert build["provider"] == "Claude"
    assert build["remaining_krw"] == 68_800
    assert len(body["events"]) == 1
    assert body["events"][0]["charged_krw"] == 1_200


def test_usage_me_is_empty_but_valid_without_an_allocation(
    client: TestClient, dev_user
) -> None:
    """A member with no approved budget still gets a usable response."""
    body = client.get("/api/usage/me").json()

    assert body["categories"] == []
    assert body["events"] == []
    assert body["personal"]["remaining_krw"] == 0


def test_usage_me_requires_signing_in(anon_client: TestClient) -> None:
    assert anon_client.get("/api/usage/me").status_code == 401


# ------------------------------------------------------------ simulate


def test_simulate_usage_charges_through_the_real_service(
    client: TestClient, dev_user, funded, db_session: Session
) -> None:
    response = client.post(
        "/api/admin/simulate-usage",
        json={"category": "build", "amount_krw": 5_000, "provider": "claude"},
    )

    assert response.status_code == 201
    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.build_consumed_krw == 5_000
    assert db_session.query(UsageEvent).count() == 1


def test_simulate_usage_is_absent_outside_development(
    client: TestClient, dev_user, funded, monkeypatch
) -> None:
    """404, not 403 — in a deployed environment the route should look absent."""
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "app_env", "production")

    response = client.post(
        "/api/admin/simulate-usage",
        json={"category": "build", "amount_krw": 5_000, "provider": "claude"},
    )

    assert response.status_code == 404


def test_simulate_usage_rejects_a_member(other_client: TestClient, funded) -> None:
    assert (
        other_client.post(
            "/api/admin/simulate-usage",
            json={"category": "build", "amount_krw": 1_000, "provider": "claude"},
        ).status_code
        == 403
    )


# --------------------------------------------------------------- audit


def test_admin_changes_write_audit_rows(
    client: TestClient, dev_user, other_user, funded, db_session: Session
) -> None:
    client.put(
        f"/api/admin/quarters/{funded.id}/members/{other_user.id}",
        json={"status": "active"},
    )
    client.put(f"/api/admin/members/{other_user.id}/role", json={"role": "admin"})

    rows = db_session.query(AuditLog).order_by(AuditLog.id).all()
    actions = [row.action for row in rows]

    assert "membership.set" in actions
    assert "role.set" in actions
    # Every row records who did it and reads as a Korean sentence.
    for row in rows:
        assert row.actor_username == dev_user.username
        assert row.summary


def test_the_audit_view_is_readable_by_admins_only(
    client: TestClient, funded, other_user
) -> None:
    """One client, two sessions in turn.

    `client` and `other_client` are the same TestClient — signing in as
    the second member replaces the first session rather than holding both,
    so the two checks have to happen in sequence.
    """
    client.put(
        f"/api/admin/quarters/{funded.id}/members/{other_user.id}",
        json={"status": "inactive"},
    )

    allowed = client.get("/api/admin/audit")
    assert allowed.status_code == 200
    assert allowed.json()[0]["action_label"] == "참여 상태 변경"

    # Now switch to the ordinary member.
    from tests.conftest import MEMBER_PASSWORD

    client.post("/api/auth/logout")
    client.post(
        "/api/auth/login",
        json={"username": other_user.username, "password": MEMBER_PASSWORD},
    )

    assert client.get("/api/admin/audit").status_code == 403


def test_adjusting_an_allocation_is_logged_and_keeps_percentages_in_step(
    client: TestClient, dev_user, funded, db_session: Session
) -> None:
    response = client.put(
        f"/api/admin/quarters/{funded.id}/allocations/{dev_user.id}",
        json={"build_budget_krw": 40_000, "video_budget_krw": 60_000, "note": "조정"},
    )

    assert response.status_code == 200
    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.build_budget_krw == 40_000
    assert allocation.build_percentage == 40
    assert allocation.video_percentage == 60

    logged = db_session.query(AuditLog).filter_by(action="allocation.adjusted").one()
    assert "40,000" in logged.summary


def test_a_rolled_back_change_leaves_no_audit_row(
    client: TestClient, funded, db_session: Session
) -> None:
    """The audit row shares the change's transaction, so a failure logs nothing."""
    before = db_session.query(AuditLog).count()

    # No allocation exists for a member who never applied.
    response = client.put(
        f"/api/admin/quarters/{funded.id}/allocations/99999",
        json={"build_budget_krw": 1, "video_budget_krw": 1},
    )

    assert response.status_code == 404
    assert db_session.query(AuditLog).count() == before


# -------------------------------------------------- concurrency (PostgreSQL)


def _postgres_engine():
    """A real PostgreSQL engine, or None when one is not reachable.

    SQLite ignores `SELECT ... FOR UPDATE`, so the lock that prevents
    overspending cannot be demonstrated on it. This test therefore needs
    the real database and skips politely without it, which keeps
    `pytest` working when Docker is not running.
    """
    from sqlalchemy import create_engine

    from app.core.config import get_settings

    url = get_settings().database_url
    if not url.startswith("postgresql"):
        return None
    try:
        engine = create_engine(url, connect_args={"connect_timeout": 2})
        with engine.connect():
            pass
        return engine
    except Exception:
        return None


def test_concurrent_charges_cannot_overspend() -> None:
    """Eight threads each try to spend 20,000원 of a 100,000원 Video budget.

    Five can succeed; three must be refused. Without the row lock, several
    threads read the same "remaining" figure before any of them writes,
    every one of them decides it is affordable, and the member ends up
    overdrawn. The assertion that matters is not how many succeeded but
    that consumed never exceeds the budget.
    """
    import threading
    import uuid

    from sqlalchemy.orm import sessionmaker

    from app.db.base import Base
    from app.models import User, UserRole, AccountStatus

    engine = _postgres_engine()
    if engine is None:
        pytest.skip("PostgreSQL is not reachable; the row lock cannot be tested on SQLite")

    Base.metadata.create_all(bind=engine)
    Session_ = sessionmaker(bind=engine, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]

    with Session_() as setup:
        member = User(
            username=f"race_{tag}",
            email=f"race_{tag}@ctrl.ai",
            password_hash="!",
            display_name="동시 요청 시험",
            role=UserRole.MEMBER,
            account_status=AccountStatus.ACTIVE,
        )
        setup.add(member)
        setup.flush()

        quarter = Quarter(
            code=f"RACE-{tag}",
            display_name=f"동시성 {tag}",
            starts_at=date(2026, 10, 1),
            ends_at=date(2026, 12, 31),
            status=QuarterStatus.ACTIVE,
            subsidy_limit_krw=100_000,
        )
        setup.add(quarter)
        setup.flush()

        setup.add(
            QuarterAllocation(
                user_id=member.id,
                quarter_id=quarter.id,
                community_total_budget_krw=100_000,
                build_budget_krw=0,
                video_budget_krw=100_000,
                build_percentage=0,
                video_percentage=100,
            )
        )
        setup.commit()
        member_id, quarter_id = member.id, quarter.id

    # current_quarter() picks the earliest ACTIVE quarter, which may not be
    # this one if the development database already has quarters. Charge
    # against the allocation directly through a patched lookup.
    import app.services.usage as usage_module

    original = usage_module.current_quarter
    usage_module.current_quarter = lambda db: db.get(Quarter, quarter_id)

    outcomes: list[str] = []
    lock = threading.Lock()

    def attempt() -> None:
        with Session_() as session:
            person = session.get(User, member_id)
            try:
                usage_module.charge(
                    session,
                    user=person,
                    category=BudgetCategory.VIDEO,
                    amount_krw=20_000,
                    provider="higgsfield",
                )
                result = "ok"
            except usage_service.InsufficientBudgetError:
                result = "refused"
            except Exception as error:  # pragma: no cover - surfaced below
                result = f"error:{error}"
        with lock:
            outcomes.append(result)

    threads = [threading.Thread(target=attempt) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    usage_module.current_quarter = original

    try:
        with Session_() as check:
            allocation = (
                check.query(QuarterAllocation)
                .filter_by(user_id=member_id, quarter_id=quarter_id)
                .one()
            )
            charged = (
                check.query(UsageEvent)
                .filter_by(user_id=member_id)
                .with_entities(UsageEvent.charged_krw)
                .all()
            )

            assert not [o for o in outcomes if o.startswith("error:")], outcomes
            # The point of the test:
            assert allocation.video_consumed_krw <= allocation.video_budget_krw
            assert allocation.video_remaining_krw >= 0
            # And the ledger agrees with the balance, to the won.
            assert sum(row[0] for row in charged) == allocation.video_consumed_krw
            assert outcomes.count("ok") == 5
            assert outcomes.count("refused") == 3
    finally:
        with Session_() as cleanup:
            cleanup.query(UsageEvent).filter_by(user_id=member_id).delete()
            cleanup.query(QuarterAllocation).filter_by(user_id=member_id).delete()
            from app.models import PersonalBalance

            cleanup.query(PersonalBalance).filter_by(user_id=member_id).delete()
            cleanup.query(Quarter).filter_by(id=quarter_id).delete()
            cleanup.query(User).filter_by(id=member_id).delete()
            cleanup.commit()
        engine.dispose()
