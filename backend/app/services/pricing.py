"""Turning Claude tokens into won.

    dollars = input_tokens  × input price  / 1,000,000
            + output_tokens × output price / 1,000,000
    won     = ceil(dollars × won-per-dollar)

Rounded **up** to whole won, with a minimum of 1원 for any call that used
a token: the club pays Anthropic in fractions of a cent, and a member's
budget must never be charged less than what their use cost.

The prices and the rate live in the database (`app/models/pricing.py`),
editable in Admin › System. Every charge copies the dollar figure and the
rate onto its `UsageEvent`, so a later change moves nothing already
charged.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import ClaudeModelPrice, ExchangeRate

#: The mock provider has no price of its own. It is priced as the model
#: the deployment is configured to use (`ANTHROPIC_MODEL`), or, with no
#: model configured, as this one — the agreed default (2026-10-07) — so
#: the budget and the ledger behave locally the way they will for real.
MOCK_PRICED_AS = "claude-sonnet-5-5"

#: Anthropic's list prices on 2026-10-07, in dollars per million tokens.
#: The migration seeds the same figures; this copy serves the tests, which
#: build their schema without migrations.
DEFAULT_PRICES: list[tuple[str, str, Decimal, Decimal]] = [
    ("claude-sonnet-5-5", "Claude Sonnet 5.5", Decimal("2"), Decimal("10")),
    ("claude-opus-5-5", "Claude Opus 5.5", Decimal("4"), Decimal("20")),
    ("claude-haiku-4-5", "Claude Haiku 4.5", Decimal("1"), Decimal("5")),
]
DEFAULT_USD_KRW = Decimal("1400")

MILLION = Decimal(1_000_000)


class PricingError(Exception):
    """No price for the model, or no exchange rate. Korean message.

    Raised *before* a provider is called: a call the app cannot price is a
    call it cannot charge, and an uncharged call is club money nobody can
    account for.
    """


@dataclass(frozen=True)
class Price:
    model_id: str
    input_usd_per_mtok: Decimal
    output_usd_per_mtok: Decimal
    usd_krw: Decimal

    def usd(self, input_tokens: int, output_tokens: int) -> Decimal:
        return (
            Decimal(input_tokens) * self.input_usd_per_mtok
            + Decimal(output_tokens) * self.output_usd_per_mtok
        ) / MILLION

    def krw(self, input_tokens: int, output_tokens: int) -> int:
        if input_tokens <= 0 and output_tokens <= 0:
            return 0
        won = (self.usd(input_tokens, output_tokens) * self.usd_krw).to_integral_value(
            rounding=ROUND_CEILING
        )
        return max(1, int(won))


def seed_defaults(db: Session) -> None:
    """Add any missing default price and the default rate. Does not commit.

    Idempotent, and never overwrites a price an admin has set.
    """
    existing = set(db.scalars(select(ClaudeModelPrice.model_id)))
    for model_id, name, input_price, output_price in DEFAULT_PRICES:
        if model_id not in existing:
            db.add(
                ClaudeModelPrice(
                    model_id=model_id,
                    display_name=name,
                    input_usd_per_mtok=input_price,
                    output_usd_per_mtok=output_price,
                )
            )
    if current_rate(db) is None:
        db.add(ExchangeRate(currency="USD", krw_per_unit=DEFAULT_USD_KRW))
    db.flush()


def current_rate(db: Session, currency: str = "USD") -> ExchangeRate | None:
    """The newest rate row — the one in force."""
    return db.scalar(
        select(ExchangeRate)
        .where(ExchangeRate.currency == currency)
        .order_by(ExchangeRate.id.desc())
        .limit(1)
    )


def rate_history(db: Session, limit: int = 10) -> list[ExchangeRate]:
    return list(
        db.scalars(
            select(ExchangeRate)
            .where(ExchangeRate.currency == "USD")
            .order_by(ExchangeRate.id.desc())
            .limit(limit)
        )
    )


def all_prices(db: Session) -> list[ClaudeModelPrice]:
    return list(db.scalars(select(ClaudeModelPrice).order_by(ClaudeModelPrice.model_id)))


def priced_model(model_id: str, settings: Settings) -> str:
    """Which price row a call is charged at. The mock borrows a real model's."""
    if model_id == "mock":
        return settings.anthropic_model.strip() or MOCK_PRICED_AS
    return model_id


def price_for(db: Session, model_id: str, settings: Settings) -> Price:
    """The price and rate in force for one model, or `PricingError`."""
    name = priced_model(model_id, settings)
    row = db.get(ClaudeModelPrice, name)
    if row is None:
        raise PricingError(
            f"Claude 모델 {name}의 가격이 등록되지 않아 지금은 쓸 수 없습니다. "
            "관리자에게 알려 주세요."
        )
    rate = current_rate(db)
    if rate is None:
        raise PricingError("환율이 등록되지 않아 지금은 쓸 수 없습니다. 관리자에게 알려 주세요.")
    return Price(
        model_id=name,
        input_usd_per_mtok=Decimal(row.input_usd_per_mtok),
        output_usd_per_mtok=Decimal(row.output_usd_per_mtok),
        usd_krw=Decimal(rate.krw_per_unit),
    )


def estimate_tokens(text: str) -> int:
    """A deliberately generous token estimate: one per character.

    Used to trim history and to check the budget *before* a call, when the
    real count is not known yet. Korean runs at roughly one token per
    syllable, English at well under one per character, so this rarely
    underestimates — and the real count from the provider is what is
    charged afterwards.
    """
    return math.ceil(len(text))
