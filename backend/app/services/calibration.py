"""Cost calibration: what replies really cost, learned from the ledger.

Before a Chat call the app can only *estimate* — one token per character
for the input (`pricing.estimate_tokens`, deliberately generous) and a
fixed "typical reply" of 3,000 input and 800 output tokens for the
picker's "답장 1회 약 N원". After the call, the provider reports the real
counts and each usage event keeps them, next to the estimate made before
the call (`UsageEvent.estimated_input_tokens`, cost-calibration).

This module turns the most recent real replies of one model into:

* **`input_ratio`** — real prompt tokens ÷ the estimate. Korean runs near
  one token per syllable, English well under one per character, so the
  ratio is usually below 1, and the pre-check can stop over-reserving.
* **`median_reply_krw`** — what a reply of this model actually cost,
  prompt caching included. Once there are enough replies it replaces the
  formula behind "답장 1회 약 N원".

Calibration only ever makes the input estimate *smaller* (never above the
uncalibrated figure) and never touches the output side of the worst case,
so the pre-check still cannot let through a member who cannot pay. It
does not touch history trimming either: a limit that moved with the ratio
would move the cut and break the prompt cache.

Nothing here calls a provider; it reads the ledger.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UsageEvent, UsageFeature

#: How many recent replies of a model to learn from.
SAMPLE_SIZE = 200
#: Fewer replies than this and the formula is used instead.
MIN_SAMPLES = 10
#: The calibrated input estimate is the observed ratio times this, so a
#: prompt a little longer than usual is still covered.
SAFETY_MARGIN = 1.2


@dataclass(frozen=True)
class ModelCalibration:
    model_id: str
    #: Recent replies the figures are based on.
    samples: int
    #: Real prompt tokens ÷ estimated. None without samples that carry an estimate.
    input_ratio: float | None
    avg_prompt_tokens: float | None
    avg_estimated_tokens: float | None
    avg_output_tokens: float | None
    avg_reply_krw: float | None
    median_reply_krw: int | None
    #: Prompt tokens read from the cache ÷ all prompt tokens.
    cache_hit_rate: float | None

    @property
    def calibrated(self) -> bool:
        return self.samples >= MIN_SAMPLES

    @property
    def input_factor(self) -> float:
        """What to multiply the one-token-per-character estimate by. ≤ 1."""
        if not self.calibrated or self.input_ratio is None:
            return 1.0
        return min(1.0, self.input_ratio * SAFETY_MARGIN)

    def calibrated_input(self, estimated_tokens: int) -> int:
        return math.ceil(estimated_tokens * self.input_factor)


def _prompt(event: UsageEvent) -> int:
    return (
        (event.input_tokens or 0)
        + (event.cache_write_tokens or 0)
        + (event.cache_read_tokens or 0)
    )


def for_model(db: Session, model_id: str) -> ModelCalibration:
    """The calibration of one model from its most recent Chat replies."""
    events = list(
        db.scalars(
            select(UsageEvent)
            .where(
                UsageEvent.feature == UsageFeature.CHAT.value,
                UsageEvent.model_id == model_id,
                UsageEvent.output_tokens.is_not(None),
            )
            .order_by(UsageEvent.id.desc())
            .limit(SAMPLE_SIZE)
        )
    )
    if not events:
        return ModelCalibration(model_id, 0, None, None, None, None, None, None, None)

    with_estimate = [e for e in events if (e.estimated_input_tokens or 0) > 0]
    prompts = [_prompt(e) for e in events]
    estimated_total = sum(e.estimated_input_tokens or 0 for e in with_estimate)
    prompt_total = sum(prompts)
    charged = [e.charged_krw for e in events]

    return ModelCalibration(
        model_id=model_id,
        samples=len(events),
        input_ratio=(
            sum(_prompt(e) for e in with_estimate) / estimated_total if estimated_total else None
        ),
        avg_prompt_tokens=prompt_total / len(events),
        avg_estimated_tokens=estimated_total / len(with_estimate) if with_estimate else None,
        avg_output_tokens=sum(e.output_tokens or 0 for e in events) / len(events),
        avg_reply_krw=sum(charged) / len(charged),
        median_reply_krw=math.ceil(statistics.median(charged)),
        cache_hit_rate=(
            sum(e.cache_read_tokens or 0 for e in events) / prompt_total if prompt_total else None
        ),
    )


# ----------------------------------------------------- cache stats (PART F)


@dataclass(frozen=True)
class CacheDay:
    """One model's cache activity on one KST day (audit-caching)."""

    model_id: str
    day: str  # YYYY-MM-DD, KST
    replies: int
    cache_hit_replies: int
    read_tokens: int
    #: What caching saved that day: read tokens billed at the read price
    #: instead of the input price, at **today's** catalogue prices and
    #: each event's own exchange rate — an honest approximation, labelled
    #: as such on the screen.
    saved_krw: int


def cache_stats(db: Session, days: int = 14) -> list[CacheDay]:
    """Per model and KST day: requests, hits, tokens read, won saved.

    Reads the ledger only; small enough to aggregate in Python (a club's
    two weeks of chat). Models are priced at their current catalogue
    figures — past price edits are not replayed.
    """
    from datetime import datetime, timedelta, timezone
    from decimal import ROUND_CEILING, Decimal

    from app.models import ChatModel

    kst = timezone(timedelta(hours=9))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    prices: dict[str, tuple[Decimal, Decimal | None]] = {
        row.model_id: (row.input_usd_per_mtok, row.cache_read_usd_per_mtok)
        for row in db.scalars(select(ChatModel))
    }

    events = db.scalars(
        select(UsageEvent).where(
            UsageEvent.provider == "claude",
            # Chat replies only: the builder starter and the prompt helper
            # never use prompt caching, and counting them would deflate
            # the hit rate on days with Builder/Video activity.
            UsageEvent.feature == UsageFeature.CHAT.value,
            UsageEvent.model_id.is_not(None),
            UsageEvent.created_at >= cutoff,
        )
    )
    buckets: dict[tuple[str, str], dict[str, Decimal | int]] = {}
    for event in events:
        created = event.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        day = created.astimezone(kst).date().isoformat()
        bucket = buckets.setdefault(
            (event.model_id, day),
            {"replies": 0, "hits": 0, "read": 0, "saved_won": Decimal(0)},
        )
        bucket["replies"] += 1
        read = event.cache_read_tokens or 0
        if read > 0:
            bucket["hits"] += 1
            bucket["read"] += read
            input_price, read_price = prices.get(event.model_id, (None, None))
            if input_price is not None:
                if read_price is None:
                    read_price = input_price / 10
                rate = event.exchange_rate_krw or Decimal(0)
                bucket["saved_won"] += (
                    Decimal(read) * (input_price - read_price) / 1_000_000 * rate
                )

    rows = [
        CacheDay(
            model_id=model_id,
            day=day,
            replies=int(bucket["replies"]),
            cache_hit_replies=int(bucket["hits"]),
            read_tokens=int(bucket["read"]),
            saved_krw=int(
                Decimal(bucket["saved_won"]).to_integral_value(rounding=ROUND_CEILING)
            ),
        )
        for (model_id, day), bucket in buckets.items()
    ]
    rows.sort(key=lambda row: (row.day, row.model_id), reverse=True)
    return rows
