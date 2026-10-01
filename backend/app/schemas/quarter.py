"""Quarter, application, allocation and wallet schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.quarter import ApplicationStatus, QuarterStatus
from app.models.user import AccountStatus, UserRole
from app.models.membership import MembershipStatus
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


class MembershipRead(BaseModel):
    """One member's participation in one quarter."""

    model_config = ConfigDict(from_attributes=True)

    quarter_id: int
    status: MembershipStatus


class MembershipUpdate(BaseModel):
    """Admin setting a member's participation in a quarter."""

    status: MembershipStatus


class MemberWithMembership(BaseModel):
    """A member as the admin member list shows them.

    Carries both statuses because they answer different questions:
    `account_status` is whether they may sign in at all, and
    `membership_status` is whether they are participating in this quarter.
    """

    user_id: int
    username: str
    display_name: str
    role: UserRole
    account_status: AccountStatus
    #: None이면 이번 분기에 참여 기록이 없다는 뜻입니다.
    membership_status: MembershipStatus | None


class RoleUpdate(BaseModel):
    """Admin changing a member's system role."""

    role: UserRole


class AllocationAdjust(BaseModel):
    """Admin adjusting an approved allocation, in KRW.

    Figures are absolute, not deltas: an admin types what the budget
    should be, which is what the panel shows them.
    """

    build_budget_krw: int = Field(ge=0, le=100_000_000)
    video_budget_krw: int = Field(ge=0, le=100_000_000)
    note: str = Field(default="", max_length=200)


class AuditLogRead(BaseModel):
    """One row of the read-only audit view."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    actor_username: str
    action: str
    action_label: str = ""
    target_type: str
    target_label: str
    summary: str


class MyQuarterStatus(BaseModel):
    """Everything Profile needs about the member's standing this quarter."""

    quarter: QuarterRead | None
    application: ApplicationRead | None
    allocation: AllocationRead | None
    personal: PersonalBalanceRead | None
    #: 신청 가능 / 승인 대기 / 활동 회원 / 미참여 / 신청 거절
    participation: str
    days_remaining: int | None
    #: 이번 분기 참여 상태. None이면 참여 기록이 없다는 뜻입니다.
    membership_status: MembershipStatus | None = None
    #: 새로 만들 수 있는지. 프런트엔드가 매번 규칙을 다시 쓰지 않도록
    #: 백엔드가 계산해서 내려 줍니다. 실제 차단은 require_active_member가 합니다.
    may_create: bool = False


# --------------------------------------------------------------- Admin 개요
#
# 아래 스키마들은 Admin 화면이 읽기만 하는 것들입니다. 업무 규칙은 하나도
# 들어 있지 않습니다 — 이미 다른 곳에서 정해진 숫자를 Admin이 한 번에 읽을
# 수 있게 모아 주는 것이 전부입니다.


class StatusCounts(BaseModel):
    """회원 수를 상태별로 센 것.

    계정 상태와 참여 상태를 따로 셉니다. 둘은 다른 질문에 답하기 때문에
    (로그인할 수 있는가 / 이번 분기에 만들 수 있는가) 합쳐 세면 어느 쪽
    숫자인지 알 수 없게 됩니다.
    """

    #: 계정 상태별 — active / inactive / former
    accounts: dict[str, int] = Field(default_factory=dict)
    #: 이번 분기 참여 상태별. `none`은 참여 기록이 없는 회원입니다.
    membership: dict[str, int] = Field(default_factory=dict)
    total: int = 0


class AdminDashboard(BaseModel):
    """대시보드가 한 번의 호출로 읽는 것 전부.

    한 화면이면 한 번의 호출입니다. 숫자를 따로따로 불러오면 카드마다
    다른 순간의 값을 보여 주게 됩니다.
    """

    quarter: QuarterRead | None
    #: 손이 필요한 일. 0이면 카드에 강조 표시를 하지 않습니다.
    pending_applications: int = 0
    pending_top_ups: int = 0
    counts: StatusCounts
    #: 영상 모델 가운데 회원에게 보이는 것의 수 — 카드의 상태 한 줄에 씁니다.
    video_models_total: int = 0
    video_models_member_visible: int = 0
    recent_audit: list[AuditLogRead] = Field(default_factory=list)
    #: 개발 환경에서만 true. 개발 도구 카드와 사이드바 항목을 이 값으로
    #: 가립니다. 실제 차단은 백엔드가 404로 합니다.
    is_development: bool = False


class MemberQuarterHistory(BaseModel):
    """한 회원이 어느 분기에 어떻게 참여했는지 한 줄."""

    quarter_id: int
    quarter_code: str
    quarter_display_name: str
    quarter_status: QuarterStatus
    membership_status: MembershipStatus | None
    application: ApplicationRead | None
    allocation: AllocationRead | None


class MemberDetail(BaseModel):
    """회원 상세 화면이 필요한 것 전부, 한 번의 호출로.

    참여 이력이 분기마다 한 줄씩 들어옵니다. CTRL+AI는 분기로 돌아가므로
    "지금 활동 중인가"만으로는 그 회원을 설명할 수 없습니다.
    """

    user_id: int
    username: str
    display_name: str
    email: str
    role: UserRole
    account_status: AccountStatus
    created_at: datetime
    quarters: list[MemberQuarterHistory] = Field(default_factory=list)
    personal: PersonalBalanceRead | None = None
    top_ups: list[TopUpRead] = Field(default_factory=list)
    #: 이 회원을 대상으로 한 감사 기록만.
    audit: list[AuditLogRead] = Field(default_factory=list)
