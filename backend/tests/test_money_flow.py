"""admin-consolidation v3 (2) — Quarters › 분기 · 예산's 돈의 흐름.

산 크레딧 → 회원에게 준 몫 (쓴 돈 · 안 쓴 돈) → 여유분, in won; what the
reserve paid for (club-absorbed calls); the end-of-quarter forecast.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import CreditPurchase, FundingSource, QuarterAllocation, UsageEvent
from app.services import money_flow


def test_the_money_flow_splits_what_was_bought(
    client: TestClient, db_session: Session, dev_user, other_user, participating
) -> None:
    quarter = participating
    db_session.add(CreditPurchase(provider="anthropic", purchased_on=quarter.starts_at, amount_usd=Decimal("900"), paid_krw=1_200_000, memo=""))
    db_session.add(CreditPurchase(provider="anthropic", purchased_on=quarter.starts_at - timedelta(days=1), amount_usd=Decimal("10"), paid_krw=13_000, memo=""))
    db_session.add(QuarterAllocation(user_id=dev_user.id, quarter_id=quarter.id, budget_krw=80_000, consumed_krw=68_800))
    db_session.add(QuarterAllocation(user_id=other_user.id, quarter_id=quarter.id, budget_krw=80_000, consumed_krw=27_610))
    db_session.add(
        UsageEvent(
            user_id=dev_user.id, funding_source=FundingSource.COMMUNITY, provider="claude", charged_krw=0,
            club_absorbed=True, provider_cost=Decimal("3.000000"), exchange_rate_krw=Decimal("1400.00"), quarter_id=quarter.id,
        )
    )
    db_session.commit()

    body = client.get(f"/api/admin/quarters/{quarter.id}/money-flow").json()
    # Bought in the quarter only (the day before does not count).
    assert body["purchased_krw"] == 1_200_000
    assert (body["granted_krw"], body["members"]) == (160_000, 2)
    assert (body["used_krw"], body["unused_krw"]) == (96_410, 63_590)
    assert body["reserve_krw"] == 1_200_000 - 160_000
    assert body["reserve_spent_krw"] == 4_200


def test_the_forecast_stretches_spending_to_the_quarter_end(db_session: Session, dev_user, participating) -> None:
    quarter = participating
    db_session.add(QuarterAllocation(user_id=dev_user.id, quarter_id=quarter.id, budget_krw=80_000, consumed_krw=10_000))
    db_session.commit()
    total = (quarter.ends_at - quarter.starts_at).days + 1
    halfway = quarter.starts_at + timedelta(days=total // 2 - 1)
    flow = money_flow.money_flow(db_session, quarter, today=halfway)
    assert flow.forecast_used_krw == round(10_000 * total / (total // 2))
    assert money_flow.money_flow(db_session, quarter, today=quarter.starts_at - timedelta(days=3)).forecast_used_krw is None
    # Too early to stretch one day of spending.
    assert money_flow.money_flow(db_session, quarter, today=quarter.starts_at).forecast_used_krw is None
    # Never past the wallets.
    wallet = db_session.query(QuarterAllocation).one()
    wallet.consumed_krw = 70_000
    db_session.commit()
    assert money_flow.money_flow(db_session, quarter, today=halfway).forecast_used_krw == 80_000


def test_the_money_flow_is_for_admins(other_client: TestClient, participating) -> None:
    assert other_client.get(f"/api/admin/quarters/{participating.id}/money-flow").status_code == 403


def test_the_apps_step_is_recorded_in_the_audit_log(client: TestClient, db_session: Session, participating) -> None:
    from app.models import AuditLog

    url = f"/api/admin/quarters/{participating.id}"
    assert client.get(f"{url}/close-steps").json() == {"apps_archived_at": None}
    done = client.post(f"{url}/apps-archived", json={})
    assert done.status_code == 200 and done.json()["apps_archived_at"] is not None
    assert client.get(f"{url}/close-steps").json()["apps_archived_at"] is not None
    row = db_session.query(AuditLog).filter(AuditLog.action == "quarter.apps_archived").one()
    assert row.target_id == participating.id


def test_the_member_list_carries_the_wallet_and_the_waiting_application(
    client: TestClient, db_session: Session, dev_user, other_user, participating
) -> None:
    from app.models import ApplicationStatus, MembershipStatus, QuarterApplication, QuarterMembership

    db_session.add(QuarterAllocation(user_id=dev_user.id, quarter_id=participating.id, budget_krw=80_000, consumed_krw=1_000))
    # Marked 비활동 first, then applied: still waiting for review.
    db_session.add(QuarterMembership(user_id=other_user.id, quarter_id=participating.id, status=MembershipStatus.INACTIVE))
    application = QuarterApplication(user_id=other_user.id, quarter_id=participating.id, requested_budget_krw=80_000, status=ApplicationStatus.SUBMITTED)
    db_session.add(application)
    db_session.commit()
    rows = {row["username"]: row for row in client.get(f"/api/admin/quarters/{participating.id}/members").json()}
    assert (rows[dev_user.username]["budget_krw"], rows[dev_user.username]["consumed_krw"]) == (80_000, 1_000)
    other = rows[other_user.username]
    assert other["application_id"] == application.id and other["application_status"] == "submitted"
    assert other["membership_status"] == "inactive"
