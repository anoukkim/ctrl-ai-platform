"""cost-clarity (owner, 2026-10-14): where the money went, caching made visible.

Mock Claude and fake transports only; nothing leaves the machine. What is
pinned down here:

* every Claude charge stores its dollar cost split by part, the parts add
  up to `provider_cost`, and `charged_krw` is their total rounded up once;
* caching's saving is what the read tokens would have cost as input,
  minus what they cost; Haiku 4.5 below 4,096 tokens never reads the cache;
* Haiku is sent the web-fetch version it accepts;
* the member's Usage carries 대화별 / 날짜별 totals and the quarter's
  saving; a club-absorbed cost is never shown to a member as a charge;
* Admin › Budget: purchases are append-only and audited, the estimated
  balance is purchases − recorded use, the per-member table and caching
  panel add up, CSVs are UTF-8 with a BOM;
* a wallet moves by audited adjustment rows (never an overwrite);
* 분기 마감 freezes wallets, records 회수, and carries the chosen share
  into the next approval exactly once;
* reconciliation compares our ledger with Anthropic's cost report — the
  mock by default, the real adapter against a fake transport.
"""

import json
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_CEILING, Decimal

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import (
    ApplicationStatus,
    AuditLog,
    ChatModel,
    Conversation,
    CreditPurchase,
    Quarter,
    QuarterAllocation,
    QuarterApplication,
    QuarterStatus,
    UsageEvent,
    WalletAdjustment,
)
from app.services import accounting, claude_provider, cost_report
from app.services import usage as usage_service
from app.services.claude_provider import CHAT_SYSTEM_PROMPT, AnthropicClaudeProvider, server_tool_params
from app.services.pricing import CostSplit, Price
from tests.test_chat import new_conversation, send


@pytest.fixture
def config():
    settings = Settings(app_env="development", chat_mock_delay_ms=0, chat_rate_limit_per_minute=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


SONNET = Price(
    model_id="claude-sonnet-5-5",
    input_usd_per_mtok=Decimal("2"),
    output_usd_per_mtok=Decimal("10"),
    usd_krw=Decimal("1400"),
    cache_read_usd_per_mtok=Decimal("0.10"),
    cache_ttl="5m",
)


# ----------------------------------------------------------------- the split


def test_the_split_adds_up_to_the_cost_and_the_charge_rounds_up_once() -> None:
    split = SONNET.split(1_000, 500, cache_write_tokens=2_000, cache_read_tokens=10_000)

    # $2/M input, $2.50/M write (1.25x), $0.10/M read (Sonnet 5.5's 0.05x),
    # $10/M output — the documented prices (platform.claude.com pricing,
    # checked 2026-10-14).
    assert split.input == Decimal("0.002")
    assert split.cache_write == Decimal("0.005")
    assert split.cache_read == Decimal("0.001")
    assert split.output == Decimal("0.005")
    assert split.total == SONNET.usd(1_000, 500, 2_000, 10_000)
    # Saved: 10,000 read tokens at $2 − $0.10 per million.
    assert split.cache_saved == Decimal("0.019")

    won = SONNET.krw(1_000, 500, 2_000, 10_000)
    assert won == int((split.total * 1400).to_integral_value(ROUND_CEILING))
    assert won >= split.total * 1400


def test_a_reply_that_only_wrote_the_cache_saved_nothing() -> None:
    assert SONNET.split(0, 100, cache_write_tokens=5_000).cache_saved == 0


def test_a_chat_reply_stores_its_split_and_receipt(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    for text in ("여행 계획을 도와 주세요.", "둘째 날은 어디가 좋을까요?"):
        assert send(client, conversation, text).status_code == 200

    events = db_session.query(UsageEvent).order_by(UsageEvent.id).all()
    assert len(events) == 2
    for event in events:
        parts = (
            event.input_cost_usd + event.cache_write_cost_usd + event.cache_read_cost_usd
            + event.output_cost_usd + event.tool_cost_usd
        )
        # Each part and the total are rounded to the sixth decimal on
        # their own, so they agree to within that rounding.
        assert abs(parts - event.provider_cost) <= Decimal("0.000005")
        assert event.charged_krw >= parts * event.exchange_rate_krw
    # The second turn read the first from the cache, and that saved money.
    assert events[1].cache_read_tokens > 0
    assert events[1].cache_saved_usd > 0

    reply = client.get(f"/api/chat/conversations/{conversation}").json()["messages"][-1]
    receipt = reply["receipt"]
    assert receipt["cache_saved_krw"] > 0
    assert receipt["split_estimated"] is False
    won_parts = sum(
        receipt[key] for key in ("input_krw", "cache_write_krw", "cache_read_krw", "output_krw", "tool_krw")
    )
    assert won_parts <= receipt["charged_krw"] < won_parts + 1.01


def test_haiku_below_its_4096_minimum_is_never_billed_as_a_cache_read(
    client: TestClient, db_session: Session, budgeted, config, monkeypatch
) -> None:
    """Short Haiku conversations do not cache; they pay full input.

    The mock counts one token per character, so the system prompt alone is
    about 4,000 "tokens" there (real Haiku sees about a quarter of that).
    The minimum is raised past it so the test stays about the rule — under
    the model's minimum nothing is cached — not about the prompt's length.
    """
    monkeypatch.setitem(claude_provider.CACHE_MINIMUM_TOKENS, "claude-haiku-4-5", 4096 + len(CHAT_SYSTEM_PROMPT))
    haiku = db_session.query(ChatModel).filter_by(model_id="claude-haiku-4-5").one()
    conversation = client.post(
        "/api/chat/conversations", json={"chat_model_id": haiku.id}
    ).json()["id"]
    for text in ("안녕하세요", "오늘 날씨 어때요?", "고마워요"):
        assert send(client, conversation, text).status_code == 200

    for event in db_session.query(UsageEvent).all():
        assert event.model_id == "claude-haiku-4-5"
        assert event.cache_read_tokens == 0 and event.cache_write_tokens == 0
        assert event.cache_saved_usd == 0
        assert event.input_tokens > 0


def test_every_model_gets_the_basic_direct_web_tools() -> None:
    """Was "newer models dynamic"; fix-real-web-search moved every model to
    the basic versions (dynamic filtering surfaced JSON parsing to members)."""
    haiku = {b["name"]: b["type"] for b in server_tool_params(("web_search", "web_fetch"), "claude-haiku-4-5", 1, 10_000)}
    sonnet = {b["name"]: b["type"] for b in server_tool_params(("web_search", "web_fetch"), "claude-sonnet-5-5", 1, 10_000)}
    assert haiku == {"web_search": "web_search_20250305", "web_fetch": "web_fetch_20250910"}
    assert sonnet == {"web_search": "web_search_20250305", "web_fetch": "web_fetch_20250910"}


def test_an_old_row_without_a_split_is_re_priced_and_marked_estimated(
    db_session: Session, dev_user
) -> None:
    event = UsageEvent(
        user_id=dev_user.id, funding_source="community", provider="claude", feature="chat",
        model_id="claude-sonnet-5-5", input_tokens=1_000, output_tokens=500,
        cache_write_tokens=0, cache_read_tokens=10_000, exchange_rate_krw=Decimal("1400"),
        charged_krw=17,
    )
    split = accounting.split_of(event, accounting.catalogue_prices(db_session))
    assert split.estimated is True
    assert split.cache_saved == Decimal("0.019") * 1400

    video = UsageEvent(
        user_id=dev_user.id, funding_source="community", provider="higgsfield",
        feature="video_generate", charged_krw=3_500,
    )
    assert accounting.split_of(video).other == 3_500


# ------------------------------------------------------- the member's Usage


def test_usage_shows_per_conversation_and_per_day_totals_and_the_saving(
    client: TestClient, db_session: Session, budgeted, dev_user, config
) -> None:
    first = new_conversation(client)
    second = new_conversation(client)
    for conversation in (first, first, second):
        assert send(client, conversation, "요약해 주세요. 긴 질문입니다.").status_code == 200
    usage_service.charge(
        db_session, user=dev_user, amount_krw=3_500,
        provider="higgsfield", feature="video_generate",
    )
    # A deleted conversation keeps its money under "삭제된 대화".
    assert client.delete(f"/api/chat/conversations/{second}").status_code == 204

    money = client.get("/api/usage/me").json()["money"]
    events = db_session.query(UsageEvent).all()
    assert money["quarter"]["charged_krw"] == sum(e.charged_krw for e in events)
    assert money["quarter"]["other_krw"] == 3_500
    titles = [row["title"] for row in money["by_conversation"]]
    assert "삭제된 대화" in titles
    assert sum(row["split"]["charged_krw"] for row in money["by_conversation"]) == sum(
        e.charged_krw for e in events if e.feature == "chat"
    )
    assert sum(day["split"]["charged_krw"] for day in money["by_day"]) == money["quarter"]["charged_krw"]
    assert money["quarter"]["cache_saved_krw"] > 0


def test_a_club_absorbed_cost_is_not_a_member_charge(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    usage_service.record_absorbed(
        db_session, user=dev_user, provider="claude", feature="build", model_id="claude-sonnet-5-5",
        input_tokens=900, output_tokens=2_000, cost=SONNET.split(900, 2_000),
        exchange_rate_krw=Decimal("1400"),
    )
    body = client.get("/api/usage/me").json()
    assert body["events"] == []
    assert body["money"]["quarter"]["charged_krw"] == 0
    db_session.refresh(budgeted)
    assert budgeted.consumed_krw == 0

    # …but the club sees it: Admin › Budget's 사용 includes it.
    credit = client.get("/api/admin/credit").json()
    anthropic = next(p for p in credit["providers"] if p["provider"] == "claude")
    assert Decimal(anthropic["absorbed_usd"]) == Decimal("0.02")
    assert Decimal(anthropic["used_usd"]) == Decimal("0.02")


# ------------------------------------------------------- Admin › Budget


def test_purchases_are_append_only_audited_and_drive_the_estimated_balance(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    response = client.post(
        "/api/admin/credit/purchases",
        json={"provider": "claude", "purchased_on": "2026-10-14", "amount_usd": "10.00",
              "paid_krw": 14_350, "memo": "첫 구매"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["created_by_username"] == dev_user.username

    usage_service.charge(
        db_session, user=dev_user, amount_krw=500, provider="claude", feature="chat",
        provider_cost=Decimal("0.35"),
    )
    credit = client.get("/api/admin/credit").json()
    anthropic = credit["providers"][0]
    assert anthropic["provider"] == "claude"  # Anthropic first
    assert anthropic["purchased_usd"] == "10.00" and anthropic["paid_krw"] == 14_350
    assert anthropic["used_usd"] == "0.35" and anthropic["remaining_usd"] == "9.65"
    assert credit["report_provider"] == "mock"

    logged = db_session.query(AuditLog).filter_by(action="credit.purchase_recorded").one()
    assert "$10.00" in logged.summary and "14,350원" in logged.summary

    # No route edits or deletes a purchase; a correction is a new row.
    paths = {(r.path, m) for r in app.routes for m in getattr(r, "methods", ())}
    assert not any(p.startswith("/api/admin/credit/purchases/") for p, _ in paths)
    refused = client.post(
        "/api/admin/credit/purchases",
        json={"provider": "claude", "purchased_on": "2026-10-14", "amount_usd": "-1.00", "paid_krw": -1_400},
    )
    assert refused.status_code == 400 and "메모" in refused.json()["detail"]
    assert client.post(
        "/api/admin/credit/purchases",
        json={"provider": "claude", "purchased_on": "2026-10-14", "amount_usd": "-1.00",
              "paid_krw": -1_400, "memo": "첫 구매 금액 정정"},
    ).status_code == 201
    assert db_session.query(CreditPurchase).count() == 2


def test_quarter_money_and_the_member_table_add_up(
    client: TestClient, db_session: Session, budgeted, dev_user, config
) -> None:
    conversation = new_conversation(client)
    send(client, conversation, "질문 하나")
    send(client, conversation, "질문 둘")
    usage_service.charge(db_session, user=dev_user, amount_krw=1_200, provider="claude", feature="build")
    usage_service.charge(db_session, user=dev_user, amount_krw=3_500, provider="higgsfield", feature="video_generate")

    body = client.get(f"/api/admin/quarters/{budgeted.quarter_id}/money").json()
    row = body["members"][0]
    db_session.refresh(budgeted)
    assert body["granted_krw"] == budgeted.budget_krw
    assert body["charged_krw"] == budgeted.consumed_krw
    assert body["unspent_krw"] == budgeted.remaining_krw
    assert row["build_krw"] == 1_200 and row["video_krw"] == 3_500
    assert row["chat_krw"] + row["build_krw"] + row["video_krw"] + row["other_krw"] == budgeted.consumed_krw
    assert row["cache_saved_krw"] > 0


def test_the_cache_panel_counts_reads_writes_and_the_saving(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = new_conversation(client)
    for _ in range(3):
        send(client, conversation, "캐시 확인용 질문입니다.")
    rows = client.get("/api/admin/cache-panel?days=7").json()
    assert len(rows) == 1
    row = rows[0]
    events = db_session.query(UsageEvent).all()
    assert row["replies"] == 3 and row["hit_replies"] == 2
    assert row["read_tokens"] == sum(e.cache_read_tokens for e in events)
    assert row["write_tokens"] == sum(e.cache_write_tokens for e in events)
    assert 0 < row["hit_rate"] < 1
    assert row["saved_krw"] == pytest.approx(
        float(sum(e.cache_saved_usd * e.exchange_rate_krw for e in events)), abs=0.01
    )


def test_csv_exports_are_utf8_with_a_bom_and_match_the_database(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    usage_service.charge(db_session, user=dev_user, amount_krw=700, provider="claude", feature="chat")
    client.post(
        "/api/admin/credit/purchases",
        json={"provider": "claude", "purchased_on": "2026-10-01", "amount_usd": "5", "paid_krw": 7_100, "memo": "구매"},
    )
    quarter = budgeted.quarter_id
    for path in (
        f"/api/admin/export/members.csv?quarter_id={quarter}",
        f"/api/admin/export/daily.csv?quarter_id={quarter}",
        "/api/admin/export/purchases.csv",
        "/api/admin/export/caching.csv?days=7",
    ):
        response = client.get(path)
        assert response.status_code == 200, path
        assert response.headers["content-type"].startswith("text/csv")
        assert "attachment" in response.headers["content-disposition"]
        assert response.content.startswith(b"\xef\xbb\xbf"), path
    members = client.get(f"/api/admin/export/members.csv?quarter_id={quarter}").content.decode("utf-8-sig")
    header, line = members.splitlines()[:2]
    assert header.startswith("분기,아이디,이름")
    assert ",700," in line
    purchases = client.get("/api/admin/export/purchases.csv").content.decode("utf-8-sig")
    assert "2026-10-01,Claude (Anthropic),5.00,7100,구매" in purchases


def test_a_member_cannot_reach_any_money_route(other_client: TestClient, participating) -> None:
    for path in (
        "/api/admin/credit",
        f"/api/admin/quarters/{participating.id}/money",
        "/api/admin/cache-panel",
        "/api/admin/export/purchases.csv",
        "/api/admin/reconcile?start=2026-10-01&end=2026-10-02",
    ):
        assert other_client.get(path).status_code == 403, path


# --------------------------------------------------------- adjustments


def test_an_adjustment_is_a_row_with_a_reason_never_an_overwrite(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    url = f"/api/admin/quarters/{budgeted.quarter_id}/allocations/{dev_user.id}/adjustments"
    assert client.post(url, json={"amount_krw": 5_000, "reason": "  "}).status_code == 400
    assert client.post(url, json={"amount_krw": 0, "reason": "영"}).status_code == 400
    assert client.post(url, json={"amount_krw": 20_000, "reason": "발표 준비"}).status_code == 201
    assert client.post(url, json={"amount_krw": -5_000, "reason": "중복 지급 정정"}).status_code == 201

    db_session.refresh(budgeted)
    assert budgeted.budget_krw == 115_000
    rows = db_session.query(WalletAdjustment).order_by(WalletAdjustment.id).all()
    assert [(r.amount_krw, r.budget_before_krw, r.budget_after_krw) for r in rows] == [
        (20_000, 100_000, 120_000), (-5_000, 120_000, 115_000),
    ]
    history = client.get(f"/api/admin/members/{dev_user.id}/adjustments").json()
    assert [h["reason"] for h in history] == ["중복 지급 정정", "발표 준비"]
    assert db_session.query(AuditLog).filter_by(action="allocation.adjusted").count() == 2


def test_an_adjustment_cannot_take_back_money_already_spent(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    usage_service.charge(db_session, user=dev_user, amount_krw=90_000, provider="claude", feature="chat")
    url = f"/api/admin/quarters/{budgeted.quarter_id}/allocations/{dev_user.id}/adjustments"
    refused = client.post(url, json={"amount_krw": -20_000, "reason": "회수"})
    assert refused.status_code == 400
    assert "최대 10,000원" in refused.json()["detail"]
    db_session.refresh(budgeted)
    assert budgeted.budget_krw == 100_000
    assert db_session.query(AuditLog).filter_by(action="allocation.adjusted").count() == 0


# --------------------------------------------------------- quarter close


def _next_quarter(db: Session) -> Quarter:
    quarter = Quarter(
        code="2027-Q1", display_name="2027 Q1", starts_at=date(2027, 1, 1),
        ends_at=date(2027, 3, 31), status=QuarterStatus.APPLICATION_OPEN, subsidy_limit_krw=80_000,
    )
    db.add(quarter)
    db.commit()
    return quarter


def test_closing_freezes_wallets_reclaims_and_carries_over_once(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    usage_service.charge(db_session, user=dev_user, amount_krw=30_000, provider="claude", feature="chat")
    quarter_id = budgeted.quarter_id

    preview = client.get(f"/api/admin/quarters/{quarter_id}/close-preview?carry_over_percent=50").json()
    assert preview["closed"] is False
    assert preview["lines"][0]["reclaimed_krw"] == 70_000
    assert preview["lines"][0]["carry_over_krw"] == 35_000

    closed = client.post(f"/api/admin/quarters/{quarter_id}/close", json={"carry_over_percent": 50})
    assert closed.status_code == 200, closed.text
    assert closed.json()["reclaimed_krw"] == 70_000 and closed.json()["closed"] is True
    db_session.refresh(budgeted)
    assert budgeted.frozen_at is not None and budgeted.reclaimed_krw == 70_000
    assert db_session.query(AuditLog).filter_by(action="quarter.closed").count() == 1
    # Nothing deleted: the wallet and its usage are all still there.
    assert db_session.query(UsageEvent).count() == 1

    # Frozen: no further charge lands, and a second close is refused.
    with pytest.raises(usage_service.NoQuarterError):
        usage_service.charge(db_session, user=dev_user, amount_krw=1, provider="claude", feature="chat")
    assert client.post(f"/api/admin/quarters/{quarter_id}/close", json={"carry_over_percent": 0}).status_code == 409
    assert client.patch(f"/api/admin/quarters/{quarter_id}", json={"status": "active"}).status_code == 409

    # The next approval receives exactly the carried share, once.
    nxt = _next_quarter(db_session)
    application = QuarterApplication(
        user_id=dev_user.id, quarter_id=nxt.id, requested_budget_krw=80_000,
        status=ApplicationStatus.SUBMITTED,
    )
    db_session.add(application)
    db_session.commit()
    assert client.post(
        f"/api/admin/applications/{application.id}/review", json={"approve": True}
    ).status_code == 200
    wallet = db_session.query(QuarterAllocation).filter_by(quarter_id=nxt.id).one()
    assert wallet.budget_krw == 115_000
    carried = db_session.query(WalletAdjustment).filter_by(kind="carry_over").one()
    assert carried.amount_krw == 35_000 and "2026 테스트" in carried.reason
    db_session.refresh(budgeted)
    assert budgeted.carried_into_id == wallet.id
    assert accounting.apply_carry_over(db_session, admin=dev_user, allocation=wallet) == 0


def test_carry_over_defaults_to_zero_and_rounds_down() -> None:
    assert accounting.carry_amount(70_001, 0) == 0
    assert accounting.carry_amount(999, 50) == 499


def test_the_status_cannot_be_set_to_closed_by_hand(
    client: TestClient, budgeted
) -> None:
    response = client.patch(f"/api/admin/quarters/{budgeted.quarter_id}", json={"status": "closed"})
    assert response.status_code == 400
    assert "분기 마감" in response.json()["detail"]
    # 신청 마감 is "active": the quarter keeps running.
    assert client.patch(
        f"/api/admin/quarters/{budgeted.quarter_id}", json={"status": "active"}
    ).status_code == 200


# ---------------------------------------------------------- reconciliation


def test_reconciliation_with_the_mock_matches_our_ledger(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    usage_service.charge(
        db_session, user=dev_user, amount_krw=50, provider="claude", feature="chat",
        provider_cost=Decimal("0.0333"),
    )
    today = datetime.now(timezone.utc).date()
    body = client.get(f"/api/admin/reconcile?start={today - timedelta(days=1)}&end={today}").json()
    assert body["provider"] == "mock"
    assert body["ours_usd"] == body["anthropic_usd"] == "0.03"
    assert all(day["matches"] for day in body["days"])


def test_a_disagreeing_day_is_flagged(db_session: Session, budgeted, dev_user) -> None:
    usage_service.charge(
        db_session, user=dev_user, amount_krw=500, provider="claude", feature="chat",
        provider_cost=Decimal("0.40"),
    )
    today = datetime.now(timezone.utc).date()
    provider = cost_report.MockCostReportProvider(db_session, adjust={today: Decimal("0.25")})
    days = cost_report.reconcile(db_session, provider, today, today)
    assert days[0].difference_usd == Decimal("0.25") and days[0].matches is False


def test_the_real_cost_report_adapter_reads_cents_and_follows_pages() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        page = request.url.params.get("page")
        if page is None:
            return httpx.Response(200, json={
                "data": [{"starting_at": "2026-10-01T00:00:00Z", "ending_at": "2026-10-02T00:00:00Z",
                          "results": [{"amount": "123.45", "currency": "USD", "cost_type": "tokens"},
                                      {"amount": "10", "currency": "USD", "cost_type": "web_search"}]}],
                "has_more": True, "next_page": "page_2",
            })
        return httpx.Response(200, json={
            "data": [{"starting_at": "2026-10-02T00:00:00Z", "ending_at": "2026-10-03T00:00:00Z",
                      "results": []}],
            "has_more": False, "next_page": None,
        })

    settings = Settings(anthropic_admin_provider="anthropic", anthropic_admin_api_key="sk-ant-admin-test")
    provider = cost_report.AnthropicCostReportProvider(
        settings, http_client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    totals = provider.daily_usd(date(2026, 10, 1), date(2026, 10, 2))
    assert totals == {date(2026, 10, 1): Decimal("1.3345"), date(2026, 10, 2): Decimal(0)}

    first = seen[0]
    assert first.url.path == "/v1/organizations/cost_report"
    assert first.headers["x-api-key"] == "sk-ant-admin-test"
    assert first.headers["anthropic-version"] == "2023-06-01"
    assert first.url.params["starting_at"] == "2026-10-01T00:00:00Z"
    assert first.url.params["ending_at"] == "2026-10-03T00:00:00Z"
    assert first.url.params["bucket_width"] == "1d"
    assert seen[1].url.params["page"] == "page_2"


def test_a_wrong_admin_key_is_a_korean_error_not_a_crash() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"type": "error", "error": {"type": "authentication_error"}})

    provider = cost_report.AnthropicCostReportProvider(
        Settings(anthropic_admin_api_key="bad"),
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with pytest.raises(cost_report.CostReportError, match="Admin API 키"):
        provider.daily_usd(date(2026, 10, 1), date(2026, 10, 1))


def test_the_admin_key_is_required_only_when_the_real_report_is_chosen() -> None:
    assert "ANTHROPIC_ADMIN_API_KEY" not in Settings().missing_provider_settings()
    assert "ANTHROPIC_ADMIN_API_KEY" in Settings(
        anthropic_admin_provider="anthropic"
    ).missing_provider_settings()
    assert "ANTHROPIC_ADMIN_API_KEY" not in Settings(
        anthropic_admin_provider="anthropic", anthropic_admin_api_key="sk-ant-admin-x"
    ).missing_provider_settings()


# ---------------------------------------------------- the prompt helper


def test_the_prompt_helper_charges_any_cache_tokens_the_api_reports(
    client: TestClient, db_session: Session, budgeted, monkeypatch
) -> None:
    """Audit fix: the helper used to price input and output only."""
    from app.api.routes import video as video_route
    from app.models import VideoProject

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "id": "msg", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
            "stop_reason": "end_turn", "stop_sequence": None,
            "content": [{"type": "text", "text": "좋아요. <prompt>바다 위 노을</prompt>"}],
            "usage": {"input_tokens": 100, "output_tokens": 50,
                      "cache_creation_input_tokens": 2_000, "cache_read_input_tokens": 3_000},
        })

    settings = Settings(
        app_env="development", claude_provider="anthropic",
        anthropic_api_key="test-not-a-real-key", anthropic_model="claude-sonnet-5-5",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    monkeypatch.setattr(
        video_route, "get_claude_provider",
        lambda _s: AnthropicClaudeProvider(settings, http_client=httpx.Client(transport=httpx.MockTransport(handler))),
    )
    project = VideoProject(owner_user_id=budgeted.user_id, name="노을")
    db_session.add(project)
    db_session.commit()
    response = client.post(
        f"/api/video/projects/{project.id}/prompt-help", json={"prompt": "바다", "request": "더 따뜻하게"}
    )
    app.dependency_overrides.pop(get_settings, None)
    assert response.status_code == 200, response.text
    event = db_session.query(UsageEvent).one()
    assert (event.cache_write_tokens, event.cache_read_tokens) == (2_000, 3_000)
    assert event.provider_cost == SONNET.usd(100, 50, 2_000, 3_000).quantize(Decimal("0.000001"))
    assert event.cache_saved_usd > 0


# ------------------------------------------------- PostgreSQL (real SQL)


def test_every_accounting_query_runs_on_postgresql(pg_engine) -> None:
    """SQLite accepts GROUP BY shapes PostgreSQL refuses (a 500 the local
    browser check found on Admin › Budget). Every read and write here runs
    once against the migrated PostgreSQL test database."""
    import uuid

    from sqlalchemy.orm import sessionmaker

    from app.models import AccountStatus, FundingSource, User, UserRole

    Session_ = sessionmaker(bind=pg_engine, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    with Session_() as db:
        admin = User(
            username=f"acct_{tag}", email=f"acct_{tag}@ctrl.ai", password_hash="!",
            display_name="회계 시험", role=UserRole.ADMIN, account_status=AccountStatus.ACTIVE,
        )
        db.add(admin)
        db.flush()
        quarter = Quarter(
            code=f"ACCT-{tag}", display_name=f"회계 {tag}", starts_at=date(2026, 10, 1),
            ends_at=date(2026, 12, 31), status=QuarterStatus.ACTIVE, subsidy_limit_krw=80_000,
        )
        db.add(quarter)
        db.flush()
        wallet = QuarterAllocation(user_id=admin.id, quarter_id=quarter.id, budget_krw=80_000, consumed_krw=30)
        db.add(wallet)
        split = SONNET.split(100, 400, 2_000, 6_000)
        db.add_all([
            UsageEvent(
                user_id=admin.id, quarter_id=quarter.id, funding_source=FundingSource.COMMUNITY,
                provider="claude", feature="chat", model_id="claude-sonnet-5-5", input_tokens=100,
                output_tokens=400, cache_write_tokens=2_000, cache_read_tokens=6_000,
                provider_cost=split.total, exchange_rate_krw=Decimal("1400"), charged_krw=20,
                **split.ledger_fields(),
            ),
            UsageEvent(
                user_id=admin.id, quarter_id=quarter.id, funding_source=FundingSource.COMMUNITY,
                provider="higgsfield", feature="video_generate", charged_krw=10,
            ),
        ])
        db.commit()

        accounting.record_purchase(
            db, admin=admin, provider="claude", purchased_on=date(2026, 10, 14),
            amount_usd=Decimal("10.00"), paid_krw=14_350, memo="pg",
        )
        db.commit()
        credit = {line.provider: line for line in accounting.provider_credit(db, quarter)}
        assert credit["claude"].used_usd_quarter == split.total.quantize(Decimal("0.000001"))
        assert credit["higgsfield"].unpriced_events >= 1
        rows = accounting.member_rows(db, quarter)
        assert rows[0].by_group["chat"] == 20 and rows[0].by_group["video"] == 10
        assert accounting.cache_panel(db, 3650)
        assert accounting.daily_totals(db, quarter)
        assert accounting.member_money(db, admin.id, quarter.id).quarter.charged_krw == 30
        accounting.provider_usd_by_utc_day(db, date(2026, 1, 1), date(2027, 1, 1))
        for blob in (
            accounting.members_csv(db, quarter), accounting.daily_csv(db, quarter),
            accounting.purchases_csv(db), accounting.caching_csv(db, 30),
        ):
            assert blob.startswith(b"\xef\xbb\xbf")

        accounting.adjust_wallet(db, admin=admin, quarter=quarter, user_id=admin.id, amount_krw=1_000, reason="pg")
        db.commit()
        assert accounting.adjustments_for(db, admin.id)
        lines = accounting.close_quarter(db, admin=admin, quarter=quarter, percent=10)
        db.commit()
        assert lines[0].reclaimed_krw == 80_970 and lines[0].carry_over_krw == 8_097
