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
    """An active quarter, active membership, and a 100,000원 wallet."""
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
        budget_krw=100_000,
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
        amount_krw=24_500,
        provider="claude",
    )

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.consumed_krw == 24_500
    assert allocation.remaining_krw == 75_500

    events = db_session.query(UsageEvent).all()
    assert len(events) == 1
    assert events[0].charged_krw == 24_500
    assert events[0].funding_source is FundingSource.COMMUNITY
    assert result.community_remaining_krw == 75_500


def test_claude_and_higgsfield_spend_from_the_same_wallet(
    db_session: Session, dev_user, funded
) -> None:
    """One balance: what Chat spends, video can no longer spend."""
    usage_service.charge(
        db_session, user=dev_user, amount_krw=60_000, provider="claude", feature="chat"
    )
    usage_service.charge(
        db_session, user=dev_user, amount_krw=40_000, provider="higgsfield",
        feature="video_generate",
    )

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.consumed_krw == 100_000
    assert allocation.remaining_krw == 0
    with pytest.raises(usage_service.InsufficientBudgetError):
        usage_service.charge(
            db_session, user=dev_user, amount_krw=1, provider="claude", feature="chat"
        )
    # The ledger still says who was paid for what.
    by_provider = {e.provider: e.charged_krw for e in db_session.query(UsageEvent)}
    assert by_provider == {"claude": 60_000, "higgsfield": 40_000}


def test_the_pre_check_refuses_when_the_one_balance_is_short(
    db_session: Session, dev_user, funded
) -> None:
    usage_service.charge(
        db_session, user=dev_user, amount_krw=99_000, provider="claude", feature="chat"
    )

    usage_service.ensure_affordable(db_session, user=dev_user, amount_krw=1_000)
    with pytest.raises(usage_service.InsufficientBudgetError):
        usage_service.ensure_affordable(db_session, user=dev_user, amount_krw=1_001)
    # Checking spends nothing.
    assert db_session.query(QuarterAllocation).one().consumed_krw == 99_000


def test_charges_accumulate(db_session: Session, dev_user, funded) -> None:
    for _ in range(3):
        usage_service.charge(
            db_session,
            user=dev_user,
            amount_krw=10_000,
            provider="higgsfield",
        )

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.consumed_krw == 30_000
    assert allocation.remaining_krw == 70_000
    assert db_session.query(UsageEvent).count() == 3


# --------------------------------------------------- insufficient budget


def test_a_charge_larger_than_the_budget_is_refused(
    db_session: Session, dev_user, funded
) -> None:
    with pytest.raises(usage_service.InsufficientBudgetError):
        usage_service.charge(
            db_session,
            user=dev_user,
            amount_krw=100_001,
            provider="higgsfield",
        )

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.consumed_krw == 0
    # Nothing is written when nothing is charged.
    assert db_session.query(UsageEvent).count() == 0


def test_the_budget_cannot_be_driven_negative(
    db_session: Session, dev_user, funded
) -> None:
    usage_service.charge(
        db_session, user=dev_user, amount_krw=100_000, provider="higgsfield",
    )

    with pytest.raises(usage_service.InsufficientBudgetError):
        usage_service.charge(
            db_session, user=dev_user, amount_krw=1, provider="higgsfield",
        )

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.remaining_krw == 0
    assert allocation.consumed_krw == 100_000


# ----------------------------------------------------- personal overage


def test_personal_money_is_not_touched_unless_the_member_opted_in(
    db_session: Session, dev_user, funded
) -> None:
    balance = get_or_create_balance(db_session, dev_user.id)
    balance.balance_krw = 150_000
    db_session.commit()

    with pytest.raises(usage_service.InsufficientBudgetError) as caught:
        usage_service.charge(
            db_session, user=dev_user, amount_krw=120_000, provider="higgsfield",
        )

    assert "개인 사용을 켜" in str(caught.value)
    db_session.refresh(balance)
    assert balance.consumed_krw == 0


def test_personal_money_is_used_once_opted_in(
    db_session: Session, dev_user, funded
) -> None:
    balance = get_or_create_balance(db_session, dev_user.id)
    balance.balance_krw = 150_000
    balance.overage_enabled = True
    db_session.commit()

    result = usage_service.charge(
        db_session, user=dev_user, amount_krw=120_000, provider="higgsfield",
    )

    assert result.funding_source is FundingSource.PERSONAL
    db_session.refresh(balance)
    assert balance.consumed_krw == 120_000
    # The wallet is untouched — the two pots never mix, and one charge is
    # never split between them.
    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.consumed_krw == 0


def test_the_wallet_is_spent_before_personal_money(
    db_session: Session, dev_user, funded
) -> None:
    balance = get_or_create_balance(db_session, dev_user.id)
    balance.balance_krw = 50_000
    balance.overage_enabled = True
    db_session.commit()

    result = usage_service.charge(
        db_session, user=dev_user, amount_krw=40_000, provider="claude", feature="chat"
    )

    assert result.funding_source is FundingSource.COMMUNITY
    db_session.refresh(balance)
    assert balance.consumed_krw == 0


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


def test_usage_me_reports_the_wallet_and_events(
    client: TestClient, dev_user, funded, db_session: Session
) -> None:
    usage_service.charge(
        db_session, user=dev_user, amount_krw=1_200, provider="claude", feature="chat"
    )

    body = client.get("/api/usage/me").json()

    assert body["quarter_name"] == "2026 Q4"
    assert body["wallet"] == {"budget_krw": 100_000, "consumed_krw": 1_200, "remaining_krw": 98_800}
    assert len(body["events"]) == 1
    assert body["events"][0]["charged_krw"] == 1_200
    assert body["events"][0]["group"] == "chat"
    assert "category" not in body["events"][0]


def test_usage_me_breaks_the_wallet_down_by_chat_video_and_other(
    client: TestClient, dev_user, funded, db_session: Session
) -> None:
    for amount, provider, feature in [
        (1_000, "claude", "chat"),
        (2_000, "claude", "chat"),
        (3_500, "higgsfield", "video_generate"),
        (300, "claude", "video_prompt"),
        (700, "claude", None),
    ]:
        usage_service.charge(
            db_session, user=dev_user, amount_krw=amount, provider=provider, feature=feature
        )
    # Personal money is not wallet money and stays out of the breakdown.
    balance = get_or_create_balance(db_session, dev_user.id)
    balance.balance_krw, balance.overage_enabled = 500_000, True
    db_session.commit()
    usage_service.charge(
        db_session, user=dev_user, amount_krw=200_000, provider="claude", feature="chat"
    )

    body = client.get("/api/usage/me").json()

    assert [(line["group"], line["label"], line["consumed_krw"]) for line in body["breakdown"]] == [
        ("chat", "채팅", 3_000),
        ("video", "영상", 3_800),
        ("other", "기타", 700),
    ]
    assert sum(line["consumed_krw"] for line in body["breakdown"]) == body["wallet"]["consumed_krw"]


def test_usage_me_is_empty_but_valid_without_an_allocation(
    client: TestClient, dev_user
) -> None:
    """A member with no approved budget still gets a usable response."""
    body = client.get("/api/usage/me").json()

    assert body["wallet"] is None
    assert body["breakdown"] == []
    assert body["events"] == []
    assert body["personal"]["remaining_krw"] == 0


def test_usage_me_requires_signing_in(anon_client: TestClient) -> None:
    assert anon_client.get("/api/usage/me").status_code == 401


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


def test_adjusting_a_wallet_is_logged(
    client: TestClient, dev_user, funded, db_session: Session
) -> None:
    response = client.put(
        f"/api/admin/quarters/{funded.id}/allocations/{dev_user.id}",
        json={"budget_krw": 60_000, "note": "조정"},
    )

    assert response.status_code == 200
    assert response.json()["remaining_krw"] == 60_000
    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.budget_krw == 60_000

    logged = db_session.query(AuditLog).filter_by(action="allocation.adjusted").one()
    assert "100,000원에서 60,000원" in logged.summary
    assert logged.detail["before"] == {"budget_krw": 100_000}
    assert logged.detail["after"] == {"budget_krw": 60_000}


def test_a_rolled_back_change_leaves_no_audit_row(
    client: TestClient, funded, db_session: Session
) -> None:
    """The audit row shares the change's transaction, so a failure logs nothing."""
    before = db_session.query(AuditLog).count()

    # No allocation exists for a member who never applied.
    response = client.put(
        f"/api/admin/quarters/{funded.id}/allocations/99999",
        json={"budget_krw": 1},
    )

    assert response.status_code == 404
    assert db_session.query(AuditLog).count() == before


# -------------------------------------------------- concurrency (PostgreSQL)


def test_concurrent_charges_cannot_overspend(pg_engine) -> None:
    """Eight threads each try to spend 20,000원 of a 100,000원 wallet.

    Five can succeed; three must be refused. Without the row lock, several
    threads read the same "remaining" figure before any of them writes,
    every one of them decides it is affordable, and the member ends up
    overdrawn. The assertion that matters is not how many succeeded but
    that consumed never exceeds the budget.
    """
    import threading
    import uuid

    from sqlalchemy.orm import sessionmaker

    from app.models import User, UserRole, AccountStatus

    # The PostgreSQL test database, migrated to head (tests/pg.py). Skips
    # without one: SQLite ignores SELECT ... FOR UPDATE.
    Session_ = sessionmaker(bind=pg_engine, expire_on_commit=False)
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
                budget_krw=100_000,
            )
        )
        setup.commit()
        member_id, quarter_id = member.id, quarter.id

    # current_quarter() picks the earliest ACTIVE quarter, which may not be
    # this one if another test left a quarter in the database. Charge
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
            assert allocation.consumed_krw <= allocation.budget_krw
            assert allocation.remaining_krw >= 0
            # And the ledger agrees with the balance, to the won.
            assert sum(row[0] for row in charged) == allocation.consumed_krw
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


def test_two_first_requests_for_a_new_wallet_do_not_fail(db_session: Session, other_user) -> None:
    """The sidebar and Usage ask for a new member's wallet at the same time.

    Simulated: the first lookup misses although the row already exists (it
    was inserted by the other request a moment earlier), so the insert hits
    the unique user_id. The helper must return the existing wallet, not 500.
    """
    from app.models import PersonalBalance
    from app.services import wallet

    db_session.add(PersonalBalance(user_id=other_user.id, balance_krw=0, consumed_krw=0))
    db_session.commit()

    real_scalar = db_session.scalar
    calls = {"n": 0}

    def first_lookup_misses(statement, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return None
        return real_scalar(statement, *args, **kwargs)

    db_session.scalar = first_lookup_misses  # type: ignore[method-assign]
    try:
        balance = wallet.get_or_create_balance(db_session, other_user.id)
    finally:
        db_session.scalar = real_scalar  # type: ignore[method-assign]
    assert balance.user_id == other_user.id
    assert db_session.query(PersonalBalance).filter_by(user_id=other_user.id).count() == 1
