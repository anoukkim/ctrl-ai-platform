"""personal-topup-off (owner, 2026-10-14): 개인 충전 is not offered.

`PERSONAL_TOPUP_ENABLED` defaults to false in **every** environment. The
tables, routes and admin screen are kept for personal-topup-ui, but while
the switch is off:

* the top-up and personal-spend routes refuse in Korean,
* `charge()` never touches personal money — an earlier opt-in and a real
  balance change nothing,
* members are not shown a personal balance at all.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import (
    FundingSource,
    MembershipStatus,
    Quarter,
    QuarterAllocation,
    QuarterStatus,
)
from app.services import usage as usage_service
from app.services.quarters import set_membership
from app.services.wallet import get_or_create_balance


@pytest.fixture
def funded(db_session: Session, dev_user):
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
    db_session.add(
        QuarterAllocation(user_id=dev_user.id, quarter_id=quarter.id, budget_krw=100_000)
    )
    db_session.commit()
    return quarter


def opted_in_with_money(db_session: Session, dev_user) -> None:
    """The state personal-topup-off must ignore: opt-in and a real balance."""
    balance = get_or_create_balance(db_session, dev_user.id)
    balance.balance_krw = 500_000
    balance.overage_enabled = True
    db_session.commit()


def test_the_setting_is_off_by_default_everywhere() -> None:
    assert Settings(app_env="development").top_ups_enabled is False
    assert Settings(app_env="beta").top_ups_enabled is False
    assert Settings(app_env="production").top_ups_enabled is False
    # And the beta stays off even when the switch is on.
    assert Settings(app_env="beta", personal_topup_enabled=True).top_ups_enabled is False
    assert Settings(app_env="production", personal_topup_enabled=True).top_ups_enabled is True


def test_charge_never_uses_personal_money_while_off(
    db_session: Session, dev_user, funded
) -> None:
    opted_in_with_money(db_session, dev_user)

    with pytest.raises(usage_service.InsufficientBudgetError) as caught:
        usage_service.charge(
            db_session, user=dev_user, amount_krw=120_000, provider="claude", feature="chat"
        )

    # The short refusal: no advice to switch on 개인 사용, which would not help.
    assert str(caught.value) == "이번 분기 지원금이 부족합니다."
    balance = get_or_create_balance(db_session, dev_user.id)
    db_session.refresh(balance)
    assert balance.consumed_krw == 0


def test_ensure_affordable_matches_charge_while_off(
    db_session: Session, dev_user, funded
) -> None:
    opted_in_with_money(db_session, dev_user)

    with pytest.raises(usage_service.InsufficientBudgetError):
        usage_service.ensure_affordable(db_session, user=dev_user, amount_krw=120_000)

    # The wallet still pays what it can cover.
    result = usage_service.charge(
        db_session, user=dev_user, amount_krw=90_000, provider="claude", feature="chat"
    )
    assert result.funding_source is FundingSource.COMMUNITY


def test_a_capped_charge_falls_to_the_wallet_not_personal_money(
    db_session: Session, dev_user, funded
) -> None:
    """cap_to_available must also ignore the bigger personal pot while off."""
    opted_in_with_money(db_session, dev_user)

    result = usage_service.charge(
        db_session,
        user=dev_user,
        amount_krw=120_000,
        provider="claude",
        feature="chat",
        cap_to_available=True,
    )

    assert result.funding_source is FundingSource.COMMUNITY
    assert result.event.charged_krw == 100_000
    balance = get_or_create_balance(db_session, dev_user.id)
    db_session.refresh(balance)
    assert balance.consumed_krw == 0


def test_the_personal_spend_switch_is_refused(client: TestClient, dev_user) -> None:
    response = client.patch("/api/quarters/me/wallet", json={"overage_enabled": True})
    assert response.status_code == 403
    assert "개인 충전" in response.json()["detail"]
    # Switching off is always allowed.
    assert (
        client.patch("/api/quarters/me/wallet", json={"overage_enabled": False}).status_code
        == 200
    )


def test_members_are_not_shown_a_personal_balance(
    client: TestClient, db_session: Session, dev_user, funded
) -> None:
    opted_in_with_money(db_session, dev_user)

    assert client.get("/api/usage/me").json()["personal"] is None
    assert client.get("/api/quarters/me").json()["personal"] is None
