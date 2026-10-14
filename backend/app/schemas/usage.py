"""Usage ledger schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.usage import FundingSource, UsageFeature
from app.schemas.accounting import MemberMoneyRead, SplitRead

#: The wallet card's breakdown: 채팅 / 빌더 / 영상 / 기타 (cost-clarity
#: gave 빌더 its own line).
SpendingGroup = Literal["chat", "build", "video", "other"]


class UsageEventRead(BaseModel):
    """One row of the member's 최근 사용 내역 table."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    funding_source: FundingSource
    provider: str
    #: A `UsageFeature` value; null on rows older than the column.
    feature: str | None
    model_id: str | None
    charged_krw: int
    #: Which line of the wallet's breakdown this charge counts under.
    group: SpendingGroup = "other"
    #: Where the charge came from, already resolved to a name the member
    #: recognises, so the table does not have to join projects itself.
    label: str = ""
    #: The charge by part, in won (cost-clarity) — the same split as the
    #: reply receipt. None only if it could not be worked out.
    split: SplitRead | None = None


class WalletUsage(BaseModel):
    """The member's one 동아리 지원 wallet for the quarter."""

    budget_krw: int
    consumed_krw: int
    remaining_krw: int


class SpendingLine(BaseModel):
    """One line of "어디에 썼나요" — information only, never a limit."""

    group: SpendingGroup
    label: str
    consumed_krw: int


class PersonalUsage(BaseModel):
    balance_krw: int
    consumed_krw: int
    remaining_krw: int
    overage_enabled: bool


class MyUsage(BaseModel):
    """Everything the Usage screen needs, in one call."""

    quarter_code: str | None
    quarter_name: str | None
    days_remaining: int | None
    membership_status: str | None
    #: None when the member has no approved wallet this quarter.
    wallet: WalletUsage | None = None
    #: 채팅 / 빌더 / 영상 / 기타, in that order, adding up to
    #: `wallet.consumed_krw`.
    breakdown: list[SpendingLine] = Field(default_factory=list)
    personal: PersonalUsage | None = None
    events: list[UsageEventRead] = Field(default_factory=list)
    #: 대화별 / 날짜별 totals and this quarter's cache saving (cost-clarity).
    #: None with no current quarter.
    money: MemberMoneyRead | None = None
