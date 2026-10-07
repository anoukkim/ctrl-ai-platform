"""Admin › System — Claude's prices, the exchange rate, and the chat limits."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ClaudeModelPriceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_id: str
    display_name: str
    input_usd_per_mtok: Decimal
    output_usd_per_mtok: Decimal
    updated_at: datetime


class ClaudeModelPriceWrite(BaseModel):
    display_name: str = Field(default="", max_length=60)
    # Bounds catch a typo (a price per token typed as per million) rather
    # than describe any real price.
    input_usd_per_mtok: Decimal = Field(gt=0, le=1000, decimal_places=4)
    output_usd_per_mtok: Decimal = Field(gt=0, le=1000, decimal_places=4)


class ExchangeRateRead(BaseModel):
    krw_per_usd: Decimal
    set_at: datetime
    #: Empty for the rate the migration seeded.
    set_by_username: str = ""


class ExchangeRateWrite(BaseModel):
    krw_per_usd: Decimal = Field(ge=100, le=10000, decimal_places=2)


class ClaudeSettingsRead(BaseModel):
    """Everything about how Claude is used, for the admin — never the key."""

    is_mock: bool
    #: ANTHROPIC_MODEL, or "" when it is not set.
    model: str
    #: The price row a reply is charged at — the mock borrows a real one.
    priced_as: str
    thinking: str
    effort: str
    max_output_tokens: int
    context_tokens: int
    rate_limit_per_minute: int
    prices: list[ClaudeModelPriceRead]
    exchange_rate: ExchangeRateRead | None
    rate_history: list[ExchangeRateRead]
