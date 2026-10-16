"""The USD→KRW rate, refreshed automatically (owner-polish-3 (b)).

The owner's words: "환율은 그냥 자동 반영하면 안됨? 왜 굳이 여기다". So the
rate the ledger converts dollars with is fetched **once a day** from a
free, keyless public source — the ECB's reference rates through
Frankfurter (api.frankfurter.dev) — behind a provider interface with a
mock default, like every other provider (CLAUDE.md §7): `FX_PROVIDER=
mock|frankfurter`. No paid service, ever.

Rules, all deliberate:

* **A jump over `MAX_JUMP_PCT` is not applied.** A fetched rate more than
  5% away from the rate in force is held back and shown as a warning in
  Admin › System (`FxStatus.note`), with an audit row; the admin applies
  it by hand if it is real.
* **The admin may pin a rate** — `FxStatus.auto_enabled` off (setting a
  rate by hand turns it off, since a value typed in should stay). While
  off, the refresh fetches nothing.
* **A failed fetch keeps the last rate.** Nothing here runs inside a
  charge: the rate in force is still `pricing.current_rate` (the newest
  `exchange_rates` row), read as before. The refresh is a job
  (`app.jobs.refresh_fx`, in `deploy/daily-jobs.sh`) and Admin › System's
  지금 새로 고침 — never the request path.
* **Only new charges use a new rate**: every usage event keeps the rate
  it was priced at (`UsageEvent.exchange_rate_krw`); wallets never move.
* **Every change is audited** — applied (`exchange_rate.auto`), held back
  (`exchange_rate.blocked`), the switch (`exchange_rate.auto_set`).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable, Protocol

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import AuditAction, ExchangeRate, FxStatus, User
from app.services import audit, pricing

logger = logging.getLogger(__name__)

#: A day-to-day move larger than this is held back, not applied.
MAX_JUMP_PCT = Decimal("5")
#: The free source: the ECB's daily reference rates. No key, no account.
FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"
#: What the mock quotes — a plausible rate, the same every day, so the
#: screens and the ledger can be exercised with no network.
MOCK_RATE = Decimal("1385.00")

OUTCOME_LABEL = {
    "applied": "새 환율을 반영했어요",
    "unchanged": "환율이 그대로예요",
    "blocked": "변동이 커서 반영하지 않았어요",
    "failed": "환율을 받아오지 못했어요",
    "": "아직 확인한 적이 없어요",
}


class FxError(Exception):
    """The source could not be read. Korean message; `detail` for the log."""

    def __init__(self, message: str, detail: str = "") -> None:
        super().__init__(message)
        self.detail = detail


@dataclass(frozen=True)
class FxQuote:
    rate: Decimal
    #: The day the source quotes the rate for.
    as_of: date
    #: "mock" | "frankfurter" — stored on the rate row.
    source: str


class FxProvider(Protocol):
    def fetch(self) -> FxQuote: ...


class MockFxProvider:
    """No network. The same rate every day — tests change `rate`."""

    source = "mock"

    def __init__(self, rate: Decimal = MOCK_RATE) -> None:
        self.rate = rate

    def fetch(self) -> FxQuote:
        return FxQuote(rate=self.rate, as_of=datetime.now(timezone.utc).date(), source=self.source)


class FrankfurterFxProvider:
    """`GET https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW` →
    `{"base": "USD", "date": "2026-10-16", "rates": {"KRW": 1385.12}}`.
    `get` is injectable so the parser is tested without the network."""

    source = "frankfurter"

    def __init__(self, get: Callable[..., object] | None = None) -> None:
        self._get = get

    def fetch(self) -> FxQuote:
        import httpx2 as httpx

        get = self._get or httpx.get
        try:
            response = get(FRANKFURTER_URL, params={"base": "USD", "symbols": "KRW"}, timeout=10.0)
        except Exception as error:  # noqa: BLE001 — any transport failure: the last rate stays
            logger.warning("FX fetch failed: %s", type(error).__name__)
            raise FxError("환율 서버에 닿지 못했어요. 마지막 환율을 그대로 씁니다.", type(error).__name__) from error
        status = getattr(response, "status_code", 0)
        if status != 200:
            raise FxError(f"환율 서버가 {status}로 답했어요. 마지막 환율을 그대로 씁니다.", f"status {status}")
        try:
            body = response.json()
            rate = Decimal(str(body["rates"]["KRW"])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            as_of = date.fromisoformat(str(body["date"]))
        except (KeyError, TypeError, ValueError, ArithmeticError) as error:
            raise FxError("환율 서버의 답을 읽지 못했어요. 마지막 환율을 그대로 씁니다.", type(error).__name__) from error
        if not (Decimal(100) <= rate <= Decimal(10000)):
            raise FxError(f"환율 서버의 답({rate})이 말이 안 돼요. 마지막 환율을 그대로 씁니다.", "implausible")
        return FxQuote(rate=rate, as_of=as_of, source=self.source)


def get_fx_provider(settings: Settings) -> FxProvider:
    mode = settings.provider_mode("fx")
    if mode == "frankfurter":
        return FrankfurterFxProvider()
    return MockFxProvider()


# ------------------------------------------------------------ the status row


def status_row(db: Session) -> FxStatus:
    row = db.get(FxStatus, 1)
    if row is None:
        row = FxStatus(id=1, auto_enabled=True)
        db.add(row)
        db.flush()
    return row


def set_auto(db: Session, *, admin: User, on: bool) -> FxStatus:
    """The pin switch. Does not commit."""
    row = status_row(db)
    if row.auto_enabled == on:
        return row
    row.auto_enabled = on
    if on:
        row.note = ""
        row.outcome = ""
    audit.record(
        db,
        actor=admin,
        action=AuditAction.EXCHANGE_RATE_AUTO_SET,
        target_type="exchange_rate",
        target_label="USD",
        summary="환율 자동 반영을 켰습니다. 하루 한 번 새 환율을 받아 옵니다." if on else "환율 자동 반영을 껐습니다. 지금 환율이 고정됩니다.",
        detail={"auto_enabled": on},
    )
    return row


def pin_by_hand(db: Session, *, admin: User, rate: Decimal) -> bool:
    """A rate typed in by the admin must stay: the switch goes off with it —
    unless the admin typed exactly the quote that was held back, which is
    accepting it, not pinning. Returns whether the rate was pinned."""
    row = status_row(db)
    accepted = row.outcome == "blocked" and row.fetched_rate is not None and Decimal(row.fetched_rate) == rate
    row.note = ""
    row.outcome = ""
    if accepted or not row.auto_enabled:
        return False
    row.auto_enabled = False
    return True


# ------------------------------------------------------------ the refresh


@dataclass(frozen=True)
class RefreshResult:
    outcome: str  # "applied" | "unchanged" | "blocked" | "failed" | "paused"
    message: str
    rate: Decimal | None = None
    previous: Decimal | None = None


def jump_pct(previous: Decimal, new: Decimal) -> Decimal:
    if previous == 0:
        return Decimal(0)
    return (abs(new - previous) / previous * 100).quantize(Decimal("0.1"))


def refresh(db: Session, settings: Settings, *, now: datetime | None = None) -> RefreshResult:
    """Fetch today's rate and apply it under the rules. Does not commit.

    Idempotent and safe to repeat: the same quote twice is "unchanged".
    Never raises for a provider failure — the outcome says so and the
    last rate stays.
    """
    moment = now or datetime.now(timezone.utc)
    status = status_row(db)
    if not status.auto_enabled:
        return RefreshResult("paused", "환율 자동 반영이 꺼져 있어요. 지금 환율이 고정되어 있습니다.")
    status.checked_at = moment
    provider = get_fx_provider(settings)
    try:
        quote = provider.fetch()
    except FxError as error:
        status.outcome = "failed"
        status.note = str(error)
        return RefreshResult("failed", str(error))
    status.fetched_rate = quote.rate
    status.fetched_for = quote.as_of
    current = pricing.current_rate(db)
    previous = Decimal(current.krw_per_unit) if current else None
    if previous is not None and quote.rate == previous:
        status.outcome = "unchanged"
        status.note = ""
        return RefreshResult("unchanged", f"환율이 그대로예요 (1달러 = {quote.rate:,}원).", quote.rate, previous)
    if previous is not None:
        moved = jump_pct(previous, quote.rate)
        if moved > MAX_JUMP_PCT:
            status.outcome = "blocked"
            status.note = (
                f"받아 온 환율 1달러 = {quote.rate:,}원은 지금 환율 {previous:,}원과 {moved}% 차이가 나서 "
                f"반영하지 않았어요 ({MAX_JUMP_PCT}% 넘는 변동은 보류). 맞는 값이면 그 값을 그대로 입력해 주세요 — "
                "그러면 자동 반영은 켜진 채로 반영돼요. 다른 값을 적으면 환율이 고정됩니다."
            )
            audit.record(
                db,
                actor=None,
                action=AuditAction.EXCHANGE_RATE_BLOCKED,
                target_type="exchange_rate",
                target_label="USD",
                summary=f"환율 자동 반영 보류: 1달러 = {quote.rate:,}원 ({quote.source}, {quote.as_of.isoformat()}) — 지금 {previous:,}원과 {moved}% 차이",
                detail={"fetched": str(quote.rate), "current": str(previous), "jump_pct": str(moved), "source": quote.source},
            )
            return RefreshResult("blocked", status.note, quote.rate, previous)
    db.add(ExchangeRate(currency="USD", krw_per_unit=quote.rate, set_by=None, source=quote.source, fetched_for=quote.as_of))
    audit.record(
        db,
        actor=None,
        action=AuditAction.EXCHANGE_RATE_AUTO,
        target_type="exchange_rate",
        target_label="USD",
        summary=(
            f"환율 자동 반영: 1달러 = {quote.rate:,}원 ({quote.source}, {quote.as_of.isoformat()} 기준)"
            + (f" (이전 {previous:,}원)" if previous is not None else "")
        ),
        detail={"before": str(previous) if previous is not None else None, "after": str(quote.rate), "source": quote.source},
    )
    status.outcome = "applied"
    status.note = ""
    db.flush()
    return RefreshResult("applied", f"새 환율을 반영했어요: 1달러 = {quote.rate:,}원.", quote.rate, previous)
