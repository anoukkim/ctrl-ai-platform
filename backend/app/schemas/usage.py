"""Usage ledger schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.quarter import BudgetCategory
from app.models.usage import FundingSource


class UsageEventRead(BaseModel):
    """One row of the member's 최근 사용 내역 table."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    category: BudgetCategory
    funding_source: FundingSource
    provider: str
    model_id: str | None
    charged_krw: int
    #: Where the charge came from, already resolved to a name the member
    #: recognises, so the table does not have to join projects itself.
    label: str = ""


class CategoryUsage(BaseModel):
    """One of the two community budget cards."""

    category: BudgetCategory
    #: "Claude" / "Higgsfield" — who actually does the work.
    provider: str
    budget_krw: int
    consumed_krw: int
    remaining_krw: int


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
    #: Empty when the member has no approved allocation this quarter.
    categories: list[CategoryUsage] = Field(default_factory=list)
    total_budget_krw: int = 0
    personal: PersonalUsage | None = None
    events: list[UsageEventRead] = Field(default_factory=list)


class SimulateUsageRequest(BaseModel):
    """Development-only: pretend a provider charged someone."""

    user_id: int | None = None
    category: BudgetCategory = BudgetCategory.BUILD
    amount_krw: int = Field(ge=0, le=1_000_000)
    provider: str = Field(default="claude", max_length=50)
    model_id: str | None = Field(default=None, max_length=120)
