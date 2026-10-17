"""admin-consolidation v3 (3) — 사용 분석 and the member panel's 사용 내역.

원가 (provider cost, USD and its won at the call's rate) and 청구 (wallet
won) side by side; by feature, by model; top apps (deleted ones left out)
and members; the trend and forecast; when credit or a wallet runs out; and
the Concur CSV of the quarter's purchases.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import BuilderProject, CreditPurchase, FundingSource, QuarterAllocation, UsageEvent
from app.services import usage_analysis


def charge(db: Session, user, quarter, feature: str, krw: int, usd: str, model: str | None = None, project=None, tin=0, tout=0, **extra):
    db.add(
        UsageEvent(
            user_id=user.id, quarter_id=quarter.id, funding_source=FundingSource.COMMUNITY, provider="claude",
            feature=feature, charged_krw=krw, provider_cost=Decimal(usd), exchange_rate_krw=Decimal("1400"),
            model_id=model, builder_project_id=project.id if project else None, input_tokens=tin, output_tokens=tout, **extra,
        )
    )


def test_the_quarter_analysis(client: TestClient, db_session: Session, dev_user, other_user, participating) -> None:
    quarter = participating
    app = BuilderProject(owner_user_id=other_user.id, name="동아리 게시판", description="")
    gone = BuilderProject(owner_user_id=other_user.id, name="지운 앱", description="", deleted_at=datetime.now(timezone.utc))
    db_session.add_all([app, gone])
    db_session.flush()
    db_session.add(CreditPurchase(provider="anthropic", purchased_on=quarter.starts_at, amount_usd=Decimal("100"), paid_krw=140_000, memo="10월"))
    charge(db_session, other_user, quarter, "build", 5_800, "3.0", "claude-sonnet-5-5", tin=1000, tout=500)
    charge(db_session, other_user, quarter, "chat", 3_400, "2.0", "claude-sonnet-5-5", tin=800, tout=200)
    charge(db_session, dev_user, quarter, "app_ai", 800, "0.4", "claude-haiku-4-5", project=app)
    charge(db_session, dev_user, quarter, "app_ai", 900, "0.5", "claude-haiku-4-5", project=gone)
    db_session.commit()

    body = client.get(f"/api/admin/quarters/{quarter.id}/usage-analysis").json()
    assert body["charged_krw"] == 10_900
    assert body["cost_usd"] == 5.9 and body["cost_krw"] == round(5.9 * 1400)
    [claude] = [line for line in body["providers"] if line["provider"] == "claude"]
    assert claude["charged_krw"] == 10_900 and claude["remaining_usd"] == 94.1
    assert claude["runs_out_on"] is not None
    assert {s["label"]: s["pct"] for s in body["by_feature"]} == {"Project Builder": 53, "Chat": 31, "앱 AI": 16}
    assert body["by_model"][0]["model_id"] == "claude-sonnet-5-5" and body["by_model"][0]["input_tokens"] == 1800
    # The deleted app is not listed, though its charge counts in the totals.
    assert [a["name"] for a in body["top_apps"]] == ["동아리 게시판"]
    assert body["top_members"][0]["id"] == other_user.id
    assert sum(day["krw"] for day in body["daily"]) == 10_900

    csv = client.get(f"/api/admin/quarters/{quarter.id}/export/concur.csv")
    assert csv.status_code == 200 and "attachment" in csv.headers["content-disposition"]
    text = csv.content.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("Transaction Date,Vendor,Amount,Currency")
    assert ",140000,KRW," in text and "10월" in text


def test_a_past_quarter_keeps_its_trend(db_session: Session, dev_user, participating) -> None:
    """Opened weeks after it ended, a quarter still shows its own last 30
    days — the window ends at the quarter's end, not today."""
    quarter = participating
    last = datetime.combine(quarter.ends_at, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=3)
    charge(db_session, dev_user, quarter, "chat", 1_200, "0.5", "claude-sonnet-5-5", created_at=last)
    db_session.commit()
    analysis = usage_analysis.quarter_analysis(db_session, quarter, today=quarter.ends_at + timedelta(days=45))
    assert len(analysis.daily) == 30 and analysis.daily[-1].day == quarter.ends_at
    assert sum(day.krw for day in analysis.daily) == 1_200


def test_unpriced_calls_and_spent_credit_are_named(db_session: Session, dev_user, participating) -> None:
    quarter = participating
    db_session.add(CreditPurchase(provider="claude", purchased_on=quarter.starts_at, amount_usd=Decimal("1"), paid_krw=1_400))
    charge(db_session, dev_user, quarter, "chat", 3_000, "2.0", "claude-sonnet-5-5")
    db_session.add(
        UsageEvent(
            user_id=dev_user.id, quarter_id=quarter.id, funding_source=FundingSource.COMMUNITY, provider="higgsfield",
            feature="video", charged_krw=5_000, provider_cost=None,
        )
    )
    db_session.commit()
    analysis = usage_analysis.quarter_analysis(db_session, quarter)
    lines = {line.provider: line for line in analysis.providers}
    assert lines["claude"].spent and lines["claude"].runs_out_on is None
    assert lines["higgsfield"].unpriced_events == 1


def test_csv_cells_never_run_as_formulas() -> None:
    from app.services.accounting import csv_bytes

    text = csv_bytes(["a", "b", "c"], [["=HYPERLINK(\"x\")", "-1000", "@SUM(A1)"]]).decode("utf-8-sig")
    assert text.splitlines()[1] == "\"'=HYPERLINK(\"\"x\"\")\",-1000,'@SUM(A1)"


def test_concur_lists_only_the_quarters_purchases(client: TestClient, db_session: Session, participating) -> None:
    quarter = participating
    db_session.add(CreditPurchase(provider="claude", purchased_on=quarter.starts_at, amount_usd=Decimal("10"), paid_krw=14_000, memo="안"))
    db_session.add(
        CreditPurchase(provider="claude", purchased_on=quarter.starts_at - timedelta(days=1), amount_usd=Decimal("10"), paid_krw=15_000, memo="밖")
    )
    db_session.commit()
    text = client.get(f"/api/admin/quarters/{quarter.id}/export/concur.csv").content.decode("utf-8-sig")
    assert ",14000,KRW," in text and ",15000," not in text


def test_the_member_usage(client: TestClient, db_session: Session, dev_user, participating) -> None:
    quarter = participating
    db_session.add(QuarterAllocation(user_id=dev_user.id, quarter_id=quarter.id, budget_krw=80_000, consumed_krw=10_000))
    charge(db_session, dev_user, quarter, "chat", 6_000, "1.0", "claude-sonnet-5-5", tin=2000, tout=900)
    charge(db_session, dev_user, quarter, "build", 4_000, "1.0", "claude-sonnet-5-5", tin=1000, tout=100)
    # The club's absorbed call is not the member's.
    charge(db_session, dev_user, quarter, "publish_summary", 0, "0.1", "claude-haiku-4-5", club_absorbed=True)
    db_session.commit()

    body = client.get(f"/api/admin/members/{dev_user.id}/usage", params={"quarter_id": quarter.id}).json()
    assert (body["budget_krw"], body["used_krw"], body["remaining_krw"], body["used_pct"], body["calls"]) == (80_000, 10_000, 70_000, 13, 2)
    assert {s["label"]: s["krw"] for s in body["by_feature"]} == {"Chat": 6_000, "Project Builder": 4_000}
    assert body["by_model"] == [
        {"model_id": "claude-sonnet-5-5", "label": body["by_model"][0]["label"], "krw": 10_000, "input_tokens": 3000, "output_tokens": 1000}
    ]
    assert len(body["recent"]) == 2


def test_when_a_wallet_runs_out(db_session: Session, dev_user, participating) -> None:
    quarter = participating
    db_session.add(QuarterAllocation(user_id=dev_user.id, quarter_id=quarter.id, budget_krw=80_000, consumed_krw=40_000))
    db_session.commit()
    tenth = quarter.starts_at + timedelta(days=9)
    usage = usage_analysis.member_usage(db_session, dev_user, quarter, today=tenth)
    # 4,000원 a day: 40,000원 left lasts ten more days.
    assert usage.runs_out_on == tenth + timedelta(days=10)


def test_the_usage_routes_are_for_admins(other_client: TestClient, dev_user, participating) -> None:
    assert other_client.get(f"/api/admin/quarters/{participating.id}/usage-analysis").status_code == 403
    assert other_client.get(f"/api/admin/members/{dev_user.id}/usage", params={"quarter_id": participating.id}).status_code == 403
