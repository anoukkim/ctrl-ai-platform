"""Quarter, application, allocation and wallet schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.quarter import ApplicationStatus, QuarterStatus
from app.models.wallet import TopUpStatus


class QuarterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    display_name: str
    starts_at: date
    ends_at: date
    application_opens_at: date | None
    application_closes_at: date | None
    status: QuarterStatus
    subsidy_limit_krw: int


class QuarterCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    display_name: str = Field(min_length=1, max_length=50)
    starts_at: date
    ends_at: date
    application_opens_at: date | None = None
    application_closes_at: date | None = None
    #: Omit to use the configured default.
    subsidy_limit_krw: int | None = Field(default=None, ge=0)


class QuarterUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=50)
    starts_at: date | None = None
    ends_at: date | None = None
    application_opens_at: date | None = None
    application_closes_at: date | None = None
    status: QuarterStatus | None = None
    subsidy_limit_krw: int | None = Field(default=None, ge=0)


class ApplicationCreate(BaseModel):
    """What a member submits.

    Only the split is sent. The KRW amounts are worked out on the backend
    from the quarter's limit, so a client cannot ask for more money by
    posting its own figures.
    """

    build_percentage: int = Field(ge=0, le=100)
    video_percentage: int = Field(ge=0, le=100)


class ApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    quarter_id: int
    build_percentage: int
    video_percentage: int
    requested_total_budget_krw: int
    requested_build_budget_krw: int
    requested_video_budget_krw: int
    status: ApplicationStatus
    submitted_at: datetime | None
    reviewed_at: datetime | None
    admin_note: str


class ApplicationWithMember(ApplicationRead):
    """Admin view: who applied."""

    username: str = ""
    display_name: str = ""


class ApplicationReview(BaseModel):
    approve: bool
    admin_note: str = Field(default="", max_length=1000)


class AllocationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    quarter_id: int
    community_total_budget_krw: int
    build_budget_krw: int
    video_budget_krw: int
    build_percentage: int
    video_percentage: int
    build_consumed_krw: int
    video_consumed_krw: int
    build_remaining_krw: int
    video_remaining_krw: int
    approved_at: datetime | None


class PersonalBalanceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    balance_krw: int
    consumed_krw: int
    remaining_krw: int
    overage_enabled: bool


class PersonalBalanceUpdate(BaseModel):
    """Turning personal spending on is an explicit act by the member."""

    overage_enabled: bool


class TopUpCreate(BaseModel):
    amount_krw: int = Field(gt=0, le=10_000_000)


class TopUpRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    amount_krw: int
    status: TopUpStatus
    requested_at: datetime | None
    confirmed_at: datetime | None
    payment_reference: str | None


class TopUpConfirm(BaseModel):
    confirm: bool
    payment_reference: str | None = Field(default=None, max_length=200)


class MyQuarterStatus(BaseModel):
    """Everything Profile needs about the member's standing this quarter."""

    quarter: QuarterRead | None
    application: ApplicationRead | None
    allocation: AllocationRead | None
    personal: PersonalBalanceRead | None
    #: 신청 가능 / 승인 대기 / 활동 회원 / 미참여 / 신청 거절
    participation: str
    days_remaining: int | None
