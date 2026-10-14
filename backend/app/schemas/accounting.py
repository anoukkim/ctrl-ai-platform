"""Schemas for cost-clarity: the won split, the club's credit, adjustments,
quarter close and reconciliation."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


class SplitRead(BaseModel):
    """A charge, or a sum of charges, by part — unrounded won (2 decimals).

    `charged_krw` is what actually left the wallet: the parts' sum rounded
    up per charge, so it can be a little more than the parts add to.
    """

    input_krw: float = 0
    cache_write_krw: float = 0
    cache_read_krw: float = 0
    output_krw: float = 0
    tools_krw: float = 0
    #: Anything not priced by the token — a video.
    other_krw: float = 0
    cache_saved_krw: float = 0
    charged_krw: int = 0
    events: int = 0
    #: Some part was re-priced from today's catalogue (an old row).
    estimated: bool = False


class ConversationMoneyRead(BaseModel):
    #: None once the conversation was deleted (the money stays).
    conversation_id: int | None
    title: str
    last_at: datetime
    split: SplitRead


class DayMoneyRead(BaseModel):
    #: KST calendar day.
    day: date
    split: SplitRead


class MemberMoneyRead(BaseModel):
    """The Usage screen's 대화별 / 날짜별 and the quarter's cache saving."""

    quarter: SplitRead
    by_conversation: list[ConversationMoneyRead]
    by_day: list[DayMoneyRead]


# ---------------------------------------------------------------- admin


class ProviderCreditRead(BaseModel):
    provider: str
    label: str
    purchased_usd: str
    paid_krw: int
    purchases: int
    used_usd: str
    absorbed_usd: str
    used_krw: int
    used_usd_quarter: str
    used_krw_quarter: int
    #: Estimated: purchases − recorded use. The provider's console is final.
    remaining_usd: str
    #: Events with no dollar cost recorded (video today) — KRW only.
    unpriced_events: int


class PurchaseRead(BaseModel):
    id: int
    provider: str
    provider_label: str
    purchased_on: date
    amount_usd: str
    paid_krw: int
    memo: str
    created_by_username: str
    created_at: datetime


class PurchaseCreate(BaseModel):
    provider: str = Field(min_length=1, max_length=50)
    purchased_on: date
    #: Negative only to correct an earlier row (the memo must say so).
    amount_usd: Decimal = Field(max_digits=12, decimal_places=2)
    paid_krw: int = Field(ge=-100_000_000, le=100_000_000)
    memo: str = Field(default="", max_length=500)

    @field_validator("amount_usd")
    @classmethod
    def _not_zero(cls, value: Decimal) -> Decimal:
        if value == 0:
            raise ValueError("0달러는 기록할 수 없습니다.")
        if abs(value) > Decimal("100000"):
            raise ValueError("한 번에 $100,000을 넘게 기록할 수 없습니다.")
        return value


class CreditOverviewRead(BaseModel):
    providers: list[ProviderCreditRead]
    purchases: list[PurchaseRead]
    #: Which cost-report provider reconciliation uses: "mock" | "anthropic".
    report_provider: str


class MemberMoneyRowRead(BaseModel):
    user_id: int
    username: str
    display_name: str
    membership_status: str | None
    granted_krw: int
    consumed_krw: int
    remaining_krw: int
    chat_krw: int
    build_krw: int
    video_krw: int
    other_krw: int
    cache_saved_krw: float
    adjusted_krw: int
    carried_in_krw: int
    frozen: bool
    reclaimed_krw: int | None
    carry_over_krw: int | None


class QuarterMoneyRead(BaseModel):
    """지급 vs 사용 for one quarter, and the per-member table."""

    quarter_id: int
    quarter_name: str
    closed_at: datetime | None
    carry_over_percent: int
    granted_krw: int
    charged_krw: int
    unspent_krw: int
    cache_saved_krw: float
    #: Calls the club paid with nobody charged, this quarter (USD).
    absorbed_usd: str
    members: list[MemberMoneyRowRead]


class CacheRowRead(BaseModel):
    day: date
    model_id: str
    replies: int
    hit_replies: int
    hit_rate: float | None
    input_tokens: int
    write_tokens: int
    read_tokens: int
    write_krw: float
    saved_krw: float
    estimated: bool


class AdjustmentCreate(BaseModel):
    amount_krw: int = Field(ge=-10_000_000, le=10_000_000)
    reason: str = Field(min_length=1, max_length=300)


class AdjustmentRead(BaseModel):
    id: int
    quarter_id: int
    quarter_name: str
    amount_krw: int
    kind: str
    reason: str
    budget_before_krw: int
    budget_after_krw: int
    created_by_username: str
    created_at: datetime


class CloseLineRead(BaseModel):
    user_id: int
    username: str
    display_name: str
    budget_krw: int
    consumed_krw: int
    reclaimed_krw: int
    carry_over_krw: int


class CloseRequest(BaseModel):
    carry_over_percent: int = Field(ge=0, le=100)


class ClosePreviewRead(BaseModel):
    quarter_id: int
    quarter_name: str
    carry_over_percent: int
    closed: bool
    reclaimed_krw: int
    carry_over_krw: int
    lines: list[CloseLineRead]


class ReconcileDayRead(BaseModel):
    day: date
    ours_usd: str
    anthropic_usd: str
    difference_usd: str
    matches: bool


class ReconcileRead(BaseModel):
    provider: str
    start: date
    end: date
    ours_usd: str
    anthropic_usd: str
    days: list[ReconcileDayRead]
