"""token-guard: the three spending guards, and the figures behind them.

* **Per-reply cap.** A reply may cost at most `reply_cap_krw`. Enforced
  *before* the call: from the calibrated input estimate and the model's
  prices the backend works out how many output tokens the rest of the cap
  buys and sends that as `max_tokens` — the API then stops at the cap
  itself and reports real usage, so the charge is exact. Thinking tokens
  count toward `max_tokens` and are billed as output, so the cap covers
  them too.
* **Long-history warning.** When the input estimate passes
  `long_history_tokens`, the composer warns what the history adds per
  reply and what a fresh conversation saves. Priced at the cache-read
  price where caching is on, so the saving is not overstated.
* **Daily cap.** At most `daily_cap_krw` per member per **KST day**,
  across every paid feature. Checked by `usage.ensure_affordable` — the
  pre-check every feature already passes — never by `charge()`, which
  settles work the club has already paid for.

The settings live in `chat_limits` rows (newest wins, like the exchange
rate); with no row the `DEFAULTS` below apply, so nothing needs seeding.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from decimal import ROUND_FLOOR, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ChatLimits, UsageEvent
from app.services.pricing import MILLION, Price

#: Korea Standard Time. The club runs on KST; a cap that reset at UTC
#: midnight would reset at 9 in the morning.
KST = timezone(timedelta(hours=9))


@dataclass(frozen=True)
class Limits:
    reply_cap_krw: int
    long_history_tokens: int
    daily_cap_krw: int


#: In force while the table is empty. The owner asked for "about 100원"
#: per reply and a warning at half the context limit; the daily cap is
#: opt-in.
DEFAULTS = Limits(reply_cap_krw=100, long_history_tokens=8_000, daily_cap_krw=0)


def current(db: Session) -> Limits:
    """The newest row, or the defaults with no row at all."""
    row = db.scalar(select(ChatLimits).order_by(ChatLimits.id.desc()).limit(1))
    if row is None:
        return DEFAULTS
    return Limits(
        reply_cap_krw=row.reply_cap_krw,
        long_history_tokens=row.long_history_tokens,
        daily_cap_krw=row.daily_cap_krw,
    )


def output_budget(price: Price, cap_krw: int, input_tokens: int) -> int:
    """How many output tokens `cap_krw` still buys after the input.

    The input is priced the way the pre-check prices it — as a cache
    write when caching is on, the dearest way input can be billed — so
    the cap is not exceeded by the input being billed dearer than
    assumed. (It can still be exceeded slightly when the *calibrated
    estimate* undershoots the real input tokens — a very token-dense
    prompt; the spec accepts charging real usage.) Returns 0 or less
    when the input alone reaches the cap.
    """
    budget_usd = Decimal(cap_krw) / price.usd_krw
    input_usd = (
        Decimal(input_tokens)
        * (price.cache_write_usd_per_mtok if price.cache_ttl else price.input_usd_per_mtok)
        / MILLION
    )
    remaining = budget_usd - input_usd
    if remaining <= 0:
        return 0
    tokens = (remaining * MILLION / price.output_usd_per_mtok).to_integral_value(
        rounding=ROUND_FLOOR
    )
    return int(tokens)


def history_cost_krw(price: Price, history_tokens: int) -> int:
    """What `history_tokens` of input add to one reply, in won.

    At the cache-read price where caching is on — a long conversation's
    history is mostly cache reads — so the figure (and the saving a new
    conversation offers) is not overstated.
    """
    if history_tokens <= 0:
        return 0
    if price.cache_ttl is not None:
        return price.krw(0, 0, cache_read_tokens=history_tokens)
    return price.krw(history_tokens, 0)


def kst_day_start(now: datetime | None = None) -> datetime:
    """Today's midnight in KST, as an aware UTC datetime for comparisons."""
    moment = (now or datetime.now(timezone.utc)).astimezone(KST)
    start = datetime.combine(moment.date(), time.min, tzinfo=KST)
    return start.astimezone(timezone.utc)


def daily_spent_krw(db: Session, user_id: int, now: datetime | None = None) -> int:
    """What the member has been charged since KST midnight, every feature."""
    spent = db.scalar(
        select(func.coalesce(func.sum(UsageEvent.charged_krw), 0)).where(
            UsageEvent.user_id == user_id,
            UsageEvent.created_at >= kst_day_start(now),
        )
    )
    return int(spent or 0)
