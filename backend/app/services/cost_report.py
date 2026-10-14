"""Reconciliation: our ledger against Anthropic's own cost report (cost-clarity g).

Optional. With an Admin API key (`ANTHROPIC_ADMIN_API_KEY`, never
required), Admin › Budget can compare what our ledger says the club spent
with Anthropic (`UsageEvent.provider_cost`) against what Anthropic's
**Cost API** reports, day by day.

Like every provider (CLAUDE.md §7) it sits behind an interface with a
mock, chosen by `ANTHROPIC_ADMIN_PROVIDER` (`mock` by default |
`anthropic`). The mock answers with our own ledger's figures — so the
screen works end to end with no key — except on a day it is asked to
disagree about in tests. The real adapter is written to the documented
API and only ever exercised against a fake transport here.

The real API, as documented (platform.claude.com/docs/en/api/beta/
organization/cost_report/retrieve, checked 2026-10-14):

    GET https://api.anthropic.com/v1/organizations/cost_report
        ?starting_at=<RFC 3339>&ending_at=<RFC 3339>&bucket_width=1d
        &limit=<≤31>&page=<next_page>
    headers: x-api-key: <Admin API key>, anthropic-version: 2023-06-01
    → {"data": [{"starting_at", "ending_at", "results": [{"amount",
       "currency", …}]}], "has_more", "next_page"}

`amount` is a decimal string in the **lowest currency unit (cents)** —
"123.45" USD is $1.23. Buckets are **UTC** days. The report covers the
whole organisation — anything else billed to the same Anthropic account
(the Console's Workbench, another project) shows up there and not in our
ledger; the screen says so. Data can lag a few minutes or more.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Protocol

from sqlalchemy.orm import Session

from app.core.config import Settings

COST_REPORT_URL = "https://api.anthropic.com/v1/organizations/cost_report"
ANTHROPIC_VERSION = "2023-06-01"
#: The API's maximum buckets per page (daily granularity).
PAGE_LIMIT = 31
#: A range longer than this is refused — a reconciliation is a check over
#: weeks, not a history download.
MAX_DAYS = 93


class CostReportError(Exception):
    """The report could not be fetched. Korean message for the admin."""


class CostReportProvider(Protocol):
    name: str

    def daily_usd(self, start: date, end: date) -> dict[date, Decimal]:
        """Anthropic's cost per UTC day, `start`..`end` inclusive."""
        ...


class MockCostReportProvider:
    """Answers with our own ledger, so the screen works with no key.

    Tests hand in `adjust` to make chosen days disagree.
    """

    name = "mock"

    def __init__(self, db: Session, adjust: dict[date, Decimal] | None = None) -> None:
        self._db = db
        self._adjust = adjust or {}

    def daily_usd(self, start: date, end: date) -> dict[date, Decimal]:
        from app.services.accounting import provider_usd_by_utc_day

        ours = provider_usd_by_utc_day(self._db, start, end)
        out: dict[date, Decimal] = {}
        day = start
        while day <= end:
            out[day] = ours.get(day, Decimal(0)) + self._adjust.get(day, Decimal(0))
            day += timedelta(days=1)
        return out


class AnthropicCostReportProvider:
    """The real Cost API. `http_client` exists for the tests' fake transport."""

    name = "anthropic"

    def __init__(self, settings: Settings, http_client: Any | None = None) -> None:
        self._key = settings.anthropic_admin_api_key.strip()
        self._client = http_client

    def _get(self, params: dict[str, Any]) -> dict[str, Any]:
        import httpx2 as httpx

        headers = {
            "x-api-key": self._key,
            "anthropic-version": ANTHROPIC_VERSION,
            "user-agent": "CTRL+AI/1.0 (club cost reconciliation)",
        }
        client = self._client or httpx.Client(timeout=20.0)
        try:
            response = client.get(COST_REPORT_URL, params=params, headers=headers)
        except httpx.HTTPError as error:
            raise CostReportError("Anthropic 비용 보고서에 연결하지 못했습니다.") from error
        finally:
            if self._client is None:
                client.close()
        if response.status_code in (401, 403):
            raise CostReportError(
                "Anthropic Admin API 키가 맞지 않거나 권한이 없습니다. "
                "Console에서 Admin 키(sk-ant-admin…)를 확인해 주세요."
            )
        if response.status_code >= 400:
            raise CostReportError(
                f"Anthropic 비용 보고서가 오류를 돌려줬습니다 (HTTP {response.status_code})."
            )
        return response.json()

    def daily_usd(self, start: date, end: date) -> dict[date, Decimal]:
        params: dict[str, Any] = {
            "starting_at": datetime.combine(start, time.min, tzinfo=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
            "ending_at": datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
            "bucket_width": "1d",
            "limit": PAGE_LIMIT,
        }
        totals: dict[date, Decimal] = {}
        day = start
        while day <= end:
            totals[day] = Decimal(0)
            day += timedelta(days=1)
        for _ in range(20):  # 20 pages × 31 days — far more than MAX_DAYS
            body = self._get(params)
            for bucket in body.get("data", []):
                bucket_day = datetime.fromisoformat(
                    str(bucket["starting_at"]).replace("Z", "+00:00")
                ).astimezone(timezone.utc).date()
                for item in bucket.get("results", []):
                    if str(item.get("currency", "USD")) != "USD":
                        continue
                    # Cents as a decimal string → dollars.
                    totals[bucket_day] = totals.get(bucket_day, Decimal(0)) + (
                        Decimal(str(item.get("amount", "0"))) / 100
                    )
            if not body.get("has_more"):
                break
            params["page"] = body.get("next_page")
        return totals


def get_cost_report_provider(settings: Settings, db: Session) -> CostReportProvider:
    if settings.anthropic_admin_provider.strip().lower() == "anthropic":
        return AnthropicCostReportProvider(settings)
    return MockCostReportProvider(db)


@dataclass(frozen=True)
class ReconcileDay:
    day: date
    ours_usd: Decimal
    anthropic_usd: Decimal

    @property
    def difference_usd(self) -> Decimal:
        return self.anthropic_usd - self.ours_usd

    @property
    def matches(self) -> bool:
        """Within a cent or 2% — rounding to six decimals per event and
        the report's own rounding never agree to the last digit."""
        tolerance = max(Decimal("0.01"), self.anthropic_usd * Decimal("0.02"))
        return abs(self.difference_usd) <= tolerance


def reconcile(
    db: Session, provider: CostReportProvider, start: date, end: date
) -> list[ReconcileDay]:
    from app.services.accounting import provider_usd_by_utc_day

    if end < start:
        raise CostReportError("끝 날짜가 시작 날짜보다 앞입니다.")
    if (end - start).days + 1 > MAX_DAYS:
        raise CostReportError(f"한 번에 {MAX_DAYS}일까지만 대조할 수 있습니다.")
    theirs = provider.daily_usd(start, end)
    ours = provider_usd_by_utc_day(db, start, end)
    out = []
    day = start
    while day <= end:
        out.append(
            ReconcileDay(
                day=day,
                ours_usd=ours.get(day, Decimal(0)),
                anthropic_usd=theirs.get(day, Decimal(0)),
            )
        )
        day += timedelta(days=1)
    return out
