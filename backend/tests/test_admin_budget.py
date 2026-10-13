"""Admin › Budget and the per-quarter wallet amount (single-wallet).

Two things the club leader relies on: the amount a quarter gives each
member is set per quarter and never moves a wallet already approved, and
the per-provider totals — what the next purchase from Anthropic and from
Higgsfield is forecast from — add up to the usage ledger, to the won.
"""

from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
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


def test_a_new_quarter_gives_80_000_won_by_default() -> None:
    assert Settings.model_fields["quarterly_subsidy_limit_krw"].default == 80_000


def test_creating_a_quarter_copies_the_default_amount(client: TestClient) -> None:
    response = client.post(
        "/api/admin/quarters",
        json={
            "code": "2027-Q1",
            "display_name": "2027 Q1",
            "starts_at": "2027-01-01",
            "ends_at": "2027-03-31",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["subsidy_limit_krw"] == 80_000


@pytest.fixture
def quarter(db_session: Session) -> Quarter:
    row = Quarter(
        code="2026-Q4",
        display_name="2026 Q4",
        starts_at=date(2026, 10, 1),
        ends_at=date(2026, 12, 31),
        status=QuarterStatus.ACTIVE,
        subsidy_limit_krw=80_000,
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_an_admin_changes_the_amount_per_quarter_and_it_is_audited(
    client: TestClient, db_session: Session, quarter: Quarter, dev_user
) -> None:
    # A wallet approved at the old amount.
    db_session.add(QuarterAllocation(user_id=dev_user.id, quarter_id=quarter.id, budget_krw=80_000))
    db_session.commit()

    response = client.patch(f"/api/admin/quarters/{quarter.id}", json={"subsidy_limit_krw": 120_000})

    assert response.status_code == 200
    assert response.json()["subsidy_limit_krw"] == 120_000
    logged = db_session.scalar(select(AuditLog).where(AuditLog.action == "quarter.updated"))
    assert logged.detail["after"] == {"subsidy_limit_krw": "120000"}
    # The wallet already approved does not move.
    assert db_session.query(QuarterAllocation).one().budget_krw == 80_000


# --------------------------------------------------------- Admin › Budget


@pytest.fixture
def spending(db_session: Session, quarter: Quarter, dev_user, other_user):
    """Two members with wallets, and a mix of Claude and Higgsfield spend."""
    for member in (dev_user, other_user):
        set_membership(db_session, member.id, quarter.id, MembershipStatus.ACTIVE)
        db_session.add(QuarterAllocation(user_id=member.id, quarter_id=quarter.id, budget_krw=80_000))
    db_session.commit()

    charges = [
        (dev_user, 1_200, "claude", "chat", 900, 300, Decimal("0.857143")),
        (dev_user, 3_500, "higgsfield", "video_generate", None, None, None),
        (other_user, 600, "claude", "video_prompt", 500, 100, Decimal("0.428571")),
        (other_user, 7_000, "higgsfield", "video_extend", None, None, None),
    ]
    for member, amount, provider, feature, tokens_in, tokens_out, usd in charges:
        usage_service.charge(
            db_session,
            user=member,
            amount_krw=amount,
            provider=provider,
            feature=feature,
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            provider_units=(tokens_in or 0) + (tokens_out or 0) if tokens_in else 5,
            provider_unit="tokens" if tokens_in else "seconds",
            provider_cost=usd,
        )
    # Personal money, opted in: still Claude credit the club bought.
    balance = get_or_create_balance(db_session, other_user.id)
    balance.balance_krw, balance.overage_enabled = 200_000, True
    db_session.commit()
    usage_service.charge(
        db_session, user=other_user, amount_krw=100_000, provider="claude", feature="chat",
        provider_cost=Decimal("71.428572"),
    )
    return quarter


def test_the_budget_page_lists_every_wallet(
    client: TestClient, spending: Quarter, dev_user, other_user
) -> None:
    body = client.get(f"/api/admin/quarters/{spending.id}/budget").json()

    assert body["member_budget_krw"] == 80_000
    wallets = {wallet["username"]: wallet for wallet in body["wallets"]}
    assert wallets[dev_user.username]["consumed_krw"] == 4_700
    assert wallets[dev_user.username]["remaining_krw"] == 75_300
    assert wallets[other_user.username]["consumed_krw"] == 7_600
    assert body["total_budget_krw"] == 160_000
    assert body["total_consumed_krw"] == 12_300
    assert body["total_remaining_krw"] == 147_700


def test_per_provider_totals_match_the_usage_ledger(
    client: TestClient, db_session: Session, spending: Quarter
) -> None:
    body = client.get(f"/api/admin/quarters/{spending.id}/budget").json()
    providers = {line["provider"]: line for line in body["providers"]}

    for provider, line in providers.items():
        ledger = db_session.scalar(
            select(func.sum(UsageEvent.charged_krw)).where(
                UsageEvent.quarter_id == spending.id, UsageEvent.provider == provider
            )
        )
        assert line["charged_krw"] == ledger
        assert line["community_krw"] + line["personal_krw"] == ledger

    claude, higgsfield = providers["claude"], providers["higgsfield"]
    assert claude["label"] == "Claude (Anthropic)"
    assert (claude["community_krw"], claude["personal_krw"]) == (1_800, 100_000)
    assert claude["provider_cost"] == {"USD": "72.71"}
    assert (claude["input_tokens"], claude["output_tokens"]) == (1_400, 400)
    assert higgsfield["charged_krw"] == 10_500 and higgsfield["personal_krw"] == 0
    assert higgsfield["units"] == {"seconds": 10}

    total = db_session.scalar(
        select(func.sum(UsageEvent.charged_krw)).where(UsageEvent.quarter_id == spending.id)
    )
    assert body["total_charged_krw"] == total == 112_300
    # Shares add up, and the reference split covers every wallet's won.
    assert sum(line["share"] for line in body["providers"]) == pytest.approx(1)
    assert sum(line["share_of_wallets_krw"] for line in body["providers"]) == pytest.approx(
        body["total_budget_krw"], abs=1
    )
    # Ordered largest first — the purchase that matters most is on top.
    assert [line["provider"] for line in body["providers"]] == ["claude", "higgsfield"]


def test_wallet_money_in_the_report_equals_the_wallets(
    client: TestClient, db_session: Session, spending: Quarter
) -> None:
    body = client.get(f"/api/admin/quarters/{spending.id}/budget").json()
    community = db_session.scalar(
        select(func.sum(UsageEvent.charged_krw)).where(
            UsageEvent.quarter_id == spending.id,
            UsageEvent.funding_source == FundingSource.COMMUNITY,
        )
    )
    assert sum(line["community_krw"] for line in body["providers"]) == community
    assert community == body["total_consumed_krw"]


def test_a_quarter_with_no_spend_has_no_provider_lines(
    client: TestClient, quarter: Quarter
) -> None:
    body = client.get(f"/api/admin/quarters/{quarter.id}/budget").json()
    assert body["providers"] == [] and body["total_charged_krw"] == 0


def test_the_budget_page_is_admin_only(other_client: TestClient, quarter: Quarter) -> None:
    assert other_client.get(f"/api/admin/quarters/{quarter.id}/budget").status_code == 403


def test_an_unknown_quarter_is_404(client: TestClient) -> None:
    assert client.get("/api/admin/quarters/9999/budget").status_code == 404
