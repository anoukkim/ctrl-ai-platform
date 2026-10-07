"""Turning Claude tokens into won.

    dollars = input_tokens  × input price  / 1,000,000
            + output_tokens × output price / 1,000,000
    won     = ceil(dollars × won-per-dollar)

Rounded **up** to whole won, with a minimum of 1원 for any call that used
a token: the club pays Anthropic in fractions of a cent, and a member's
budget must never be charged less than what their use cost.

The prices live in the chat model catalogue (Admin › Claude Models) and
the rate in Admin › System, both in the database
(`app/models/pricing.py`). Every charge copies the dollar figure and the
rate onto its `UsageEvent`, so a later change moves nothing already
charged.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ExchangeRate
from app.services import chat_models
from app.services.chat_models import ChosenModel

DEFAULT_USD_KRW = Decimal("1400")

#: What "one reply" means for the estimate the Chat picker shows. A
#: conversation a few turns in sends about this much (system prompt plus
#: history) and a Korean answer of a few paragraphs comes back at about
#: this length. The estimate is a guide, not the charge: what is charged
#: is the real count, and the budget check before a call uses the worst
#: case.
TYPICAL_INPUT_TOKENS = 3000
TYPICAL_OUTPUT_TOKENS = 800

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
    """The default rate and, into an empty catalogue, the default models.

    Does not commit. Idempotent, and never overwrites what an admin set.
    """
    chat_models.seed_defaults(db)
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


def price_for(db: Session, model: ChosenModel) -> Price:
    """The price and rate in force for one model, or `PricingError`."""
    if model.input_usd_per_mtok <= 0 or model.output_usd_per_mtok <= 0:
        # Only the empty-catalogue fallback can get here: a catalogue row's
        # prices are checked when an admin saves them.
        raise PricingError(
            f"Claude 모델 {model.model_id}의 가격이 등록되지 않아 지금은 쓸 수 없습니다. "
            "관리자에게 알려 주세요."
        )
    rate = current_rate(db)
    if rate is None:
        raise PricingError("환율이 등록되지 않아 지금은 쓸 수 없습니다. 관리자에게 알려 주세요.")
    return Price(
        model_id=model.model_id,
        input_usd_per_mtok=model.input_usd_per_mtok,
        output_usd_per_mtok=model.output_usd_per_mtok,
        usd_krw=Decimal(rate.krw_per_unit),
    )


def typical_reply_krw(model: ChosenModel, rate: ExchangeRate | None) -> int | None:
    """The picker's "답장 1회 약 N원". None without a rate to convert with."""
    if rate is None:
        return None
    return Price(
        model_id=model.model_id,
        input_usd_per_mtok=model.input_usd_per_mtok,
        output_usd_per_mtok=model.output_usd_per_mtok,
        usd_krw=Decimal(rate.krw_per_unit),
    ).krw(TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS)


def estimate_tokens(text: str) -> int:
    """A deliberately generous token estimate: one per character.

    Used to trim history and to check the budget *before* a call, when the
    real count is not known yet. Korean runs at roughly one token per
    syllable, English at well under one per character, so this rarely
    underestimates — and the real count from the provider is what is
    charged afterwards.
    """
    return math.ceil(len(text))
