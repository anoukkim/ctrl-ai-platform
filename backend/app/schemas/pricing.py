"""Admin › Claude Models (the chat model catalogue) and Admin › System
(the exchange rate and the chat limits)."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.pricing import ChatModelVisibility


class ChatModelAdminRead(BaseModel):
    """One catalogue row, as Admin › Claude Models shows it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    model_id: str
    label: str
    description: str
    input_usd_per_mtok: Decimal
    output_usd_per_mtok: Decimal
    visibility: ChatModelVisibility
    is_default: bool
    sort_order: int
    updated_at: datetime
    #: The same "답장 1회 약 N원" members see in the picker.
    estimated_reply_krw: int | None = None


class ChatModelCreate(BaseModel):
    provider: str = Field(default="anthropic", max_length=50)
    model_id: str = Field(min_length=2, max_length=120)
    label: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=200)
    # Bounds catch a typo (a price per token typed as per million) rather
    # than describe any real price.
    input_usd_per_mtok: Decimal = Field(gt=0, le=1000, decimal_places=4)
    output_usd_per_mtok: Decimal = Field(gt=0, le=1000, decimal_places=4)
    #: New models start closed: an admin opens one on purpose.
    visibility: ChatModelVisibility = ChatModelVisibility.DISABLED
    sort_order: int = Field(default=100, ge=0, le=10000)


class ChatModelUpdate(BaseModel):
    """Any subset. `is_default` may only be set to true — choose another
    model as the default rather than unsetting this one."""

    label: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=200)
    input_usd_per_mtok: Decimal | None = Field(default=None, gt=0, le=1000, decimal_places=4)
    output_usd_per_mtok: Decimal | None = Field(default=None, gt=0, le=1000, decimal_places=4)
    visibility: ChatModelVisibility | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_default: bool | None = None


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
    #: The catalogue default's label and id — what new conversations and
    #: the video prompt helper use. Empty with an empty catalogue.
    default_model_label: str
    default_model_id: str
    #: ANTHROPIC_MODEL — used only when the catalogue is empty.
    fallback_model: str
    thinking: str
    effort: str
    max_output_tokens: int
    context_tokens: int
    rate_limit_per_minute: int
    exchange_rate: ExchangeRateRead | None
    rate_history: list[ExchangeRateRead]
