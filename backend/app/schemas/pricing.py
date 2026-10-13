"""Admin › AI Models (the chat model catalogue) and Admin › System
(the exchange rate and the chat limits)."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.pricing import ChatModelVisibility


class ChatModelAdminRead(BaseModel):
    """One catalogue row, as Admin › AI Models shows it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    model_id: str
    label: str
    description: str
    input_usd_per_mtok: Decimal
    output_usd_per_mtok: Decimal
    #: Null means a tenth of the input price.
    cache_read_usd_per_mtok: Decimal | None = None
    visibility: ChatModelVisibility
    is_default: bool
    sort_order: int
    updated_at: datetime
    #: "Anthropic (Claude)"; and False while the provider has no adapter
    #: (연결 준비 중) — such a row stays closed.
    provider_label: str = ""
    provider_ready: bool = True
    #: The same "답장 1회 약 N원" members see in the picker.
    estimated_reply_krw: int | None = None
    estimate_basis: str = "formula"
    estimate_samples: int = 0
    # Server tools (chat-plus-tools): which this model may use, and the
    # $ one web search costs. Off until an admin opens one.
    tools_web_search: bool = False
    tools_web_fetch: bool = False
    tools_code_execution: bool = False
    web_search_usd_per_call: Decimal = Decimal("0.01")


class ChatProviderRead(BaseModel):
    id: str
    label: str
    ready: bool


class ChatModelCreate(BaseModel):
    provider: str = Field(default="anthropic", max_length=50)
    model_id: str = Field(min_length=2, max_length=120)
    label: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=200)
    # Bounds catch a typo (a price per token typed as per million) rather
    # than describe any real price.
    input_usd_per_mtok: Decimal = Field(gt=0, le=1000, decimal_places=4)
    output_usd_per_mtok: Decimal = Field(gt=0, le=1000, decimal_places=4)
    #: Omit for a tenth of the input price.
    cache_read_usd_per_mtok: Decimal | None = Field(
        default=None, ge=0, le=1000, decimal_places=4
    )
    #: New models start closed: an admin opens one on purpose.
    visibility: ChatModelVisibility = ChatModelVisibility.DISABLED
    sort_order: int = Field(default=100, ge=0, le=10000)
    tools_web_search: bool = False
    tools_web_fetch: bool = False
    tools_code_execution: bool = False
    #: $ per web search. The bound catches a typo ($10, the per-1,000
    #: price, typed per call), not any real price.
    web_search_usd_per_call: Decimal = Field(default=Decimal("0.01"), ge=0, le=1, decimal_places=6)


class ChatModelUpdate(BaseModel):
    """Any subset. `is_default` may only be set to true — choose another
    model as the default rather than unsetting this one."""

    label: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=200)
    input_usd_per_mtok: Decimal | None = Field(default=None, gt=0, le=1000, decimal_places=4)
    output_usd_per_mtok: Decimal | None = Field(default=None, gt=0, le=1000, decimal_places=4)
    cache_read_usd_per_mtok: Decimal | None = Field(
        default=None, ge=0, le=1000, decimal_places=4
    )
    visibility: ChatModelVisibility | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_default: bool | None = None
    tools_web_search: bool | None = None
    tools_web_fetch: bool | None = None
    tools_code_execution: bool | None = None
    web_search_usd_per_call: Decimal | None = Field(
        default=None, ge=0, le=1, decimal_places=6
    )


class ExchangeRateRead(BaseModel):
    krw_per_usd: Decimal
    set_at: datetime
    #: Empty for the rate the migration seeded.
    set_by_username: str = ""


class ExchangeRateWrite(BaseModel):
    krw_per_usd: Decimal = Field(ge=100, le=10000, decimal_places=2)


class ChatLimitsRead(BaseModel):
    """The three spending guards (token-guard). 0 = that guard is off."""

    reply_cap_krw: int
    long_history_tokens: int
    daily_cap_krw: int
    set_at: datetime | None = None
    set_by_username: str = ""


class ChatLimitsWrite(BaseModel):
    """Bounds catch typos (a cap in dollars, a threshold in characters)."""

    reply_cap_krw: int = Field(ge=0, le=100_000)
    long_history_tokens: int = Field(ge=0, le=1_000_000)
    daily_cap_krw: int = Field(ge=0, le=10_000_000)


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
    #: CHAT_PROMPT_CACHE / CHAT_CACHE_TTL. `cache_ttl` is None when off.
    prompt_cache: bool = True
    cache_ttl: str | None = "5m"
    exchange_rate: ExchangeRateRead | None
    rate_history: list[ExchangeRateRead]
    #: token-guard: the per-reply cap, the warning threshold, the daily cap.
    chat_limits: ChatLimitsRead


class ModelCalibrationRead(BaseModel):
    """Admin › AI Models › 비용 보정: estimate vs reality, per model."""

    model_id: str
    label: str
    samples: int
    #: True once there are enough replies for the figures to be used.
    calibrated: bool
    input_ratio: float | None
    #: What the pre-check now multiplies the character count by (≤ 1).
    input_factor: float
    avg_prompt_tokens: float | None
    avg_estimated_tokens: float | None
    avg_output_tokens: float | None
    avg_reply_krw: float | None
    median_reply_krw: int | None
    #: The formula's figure, to compare with the median.
    formula_reply_krw: int | None
    cache_hit_rate: float | None
