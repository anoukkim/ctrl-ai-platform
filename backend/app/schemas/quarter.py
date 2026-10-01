"""Quarter, application, allocation and wallet schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
    """A new quarter, as the 분기 설정 form submits it.

    The date rules are checked here rather than only in the screen, because
    a quarter with its end before its start, or applications closing after
    the quarter is over, produces figures nobody can read — and the screen
    is not the only way in.
    """

    code: str = Field(min_length=1, max_length=20)
    display_name: str = Field(min_length=1, max_length=50)
    starts_at: date
    ends_at: date
    application_opens_at: date | None = None
    application_closes_at: date | None = None
    #: Omit to use the configured default.
    subsidy_limit_krw: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def check_dates(self) -> "QuarterCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError("분기 종료일은 시작일보다 뒤여야 합니다.")

        opens, closes = self.application_opens_at, self.application_closes_at
        if (opens is None) != (closes is None):
            raise ValueError("신청 기간은 시작일과 마감일을 함께 적거나 둘 다 비워야 합니다.")

        if opens is not None and closes is not None:
            if closes < opens:
                raise ValueError("신청 마감일은 신청 시작일보다 뒤여야 합니다.")
            # Applications may open before the quarter starts — that is the
            # normal case — but they cannot still be open after it ends.
            if closes > self.ends_at:
                raise ValueError("신청 마감일은 분기 종료일보다 뒤일 수 없습니다.")
        return self


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
    """Admin view: who applied, and who dealt with it.

    The reviewer's name is carried so a processed row can say who decided
    it. Without that the 신청 승인 screen can only show "처리됨", and the
    one question an admin asks about somebody else's decision — who made
    it — needs a trip to the audit log.
    """

    username: str = ""
    display_name: str = ""
    reviewed_by_username: str = ""
    reviewed_by_display_name: str = ""


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


# ------------------------------------------------------- Admin 통계
#
# 모두 백엔드의 묶음 질의(GROUP BY)로 셉니다. 브라우저가 전체 목록을
# 받아 세면 지금은 맞지만, 회원이 수백 명이 되는 순간 조용히 느려집니다.


class ApplicationStatsRead(BaseModel):
    """신청 승인 화면 위쪽의 작은 카드들."""

    total: int = 0
    pending: int = 0
    approved: int = 0
    rejected: int = 0
    #: 신청한 금액의 합계. 승인된 금액이 아니라 신청된 금액입니다.
    requested_total_krw: int = 0


class MemberStatsRead(BaseModel):
    """회원 목록 위쪽의 작은 카드들.

    분기에 따라 달라지는 숫자(활동/비활동/미신청)와 그렇지 않은 숫자
    (전체/탈퇴/관리자)가 한 묶음에 들어 있습니다. 화면이 "보고 있는
    분기" 하나만 알면 되도록.
    """

    total: int = 0
    active: int = 0
    inactive: int = 0
    not_applied: int = 0
    former: int = 0
    admins: int = 0


class QuarterStatsRead(BaseModel):
    """분기 설정 표의 숫자 칸."""

    quarter_id: int
    applicants: int = 0
    pending: int = 0
    participants: int = 0
    users_with_usage: int = 0
    #: 실제 사용자 ÷ 참여 회원. 참여 회원이 0이면 None입니다 — 0%가
    #: 아니라 "셀 수 없음"이고, 화면은 "–"로 적습니다.
    usage_rate: float | None = None


class QuarterWithStats(QuarterRead):
    """분기 한 줄 + 그 분기의 숫자."""

    stats: QuarterStatsRead


class ProviderStatusRead(BaseModel):
    """외부 서비스 한 곳의 상태.

    **API 키 자체는 들어 있지 않습니다.** `has_key`는 설정돼 있는지만
    말합니다. 키를 돌려주는 필드는 이 스키마에도, 다른 어떤 응답에도
    없습니다.
    """

    key: str
    name: str
    purpose: str
    #: 어떤 환경 변수가 이 서비스를 고르는지 — 바꿀 곳을 알려 줍니다.
    setting: str
    #: "mock" 또는 실제 구현 이름("anthropic" 등).
    mode: str
    is_mock: bool
    has_key: bool
    last_success_at: datetime | None = None
    last_success_label: str = ""
    last_error_at: datetime | None = None
    #: 사람이 읽는 한국어 설명. 제공자의 영어 원문은 돌려주지 않습니다.
    last_error_message: str = ""
    #: 남은 잔액은 제공자가 알려 줄 때만 채웁니다. 없으면 생략합니다 —
    #: 모르는 값을 0으로 적으면 잔액이 0인 것처럼 보입니다.
    balance_label: str | None = None


class ProviderCheckResult(BaseModel):
    """연결 확인 버튼 한 번의 결과."""

    key: str
    ok: bool
    message: str
    checked_at: datetime


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

    `members`·`applications`·`quarter_stats`는 각 구역 화면이 쓰는 것과
    **같은 함수**(`services/admin_stats.py`)에서 나옵니다. 대시보드가
    자기만의 셈을 하면 같은 회원 수가 화면마다 달라집니다.
    """

    quarter: QuarterRead | None
    #: 손이 필요한 일. 0이면 카드에 강조 표시를 하지 않습니다.
    pending_applications: int = 0
    pending_top_ups: int = 0
    counts: StatusCounts
    #: 구역 화면과 공유하는 숫자.
    members: MemberStatsRead = Field(default_factory=lambda: MemberStatsRead())
    applications: ApplicationStatsRead = Field(default_factory=lambda: ApplicationStatsRead())
    quarter_stats: QuarterStatsRead | None = None
    #: 영상 모델 가운데 회원에게 보이는 것의 수 — 카드의 상태 한 줄에 씁니다.
    video_models_total: int = 0
    video_models_member_visible: int = 0
    recent_audit: list[AuditLogRead] = Field(default_factory=list)
    #: 개발 환경에서만 true. 개발 도구 카드와 사이드바 항목을 이 값으로
    #: 가립니다. 실제 차단은 백엔드가 404로 합니다.
    is_development: bool = False
    #: 실제 연결로 설정된 제공자 가운데 마지막 호출이나 확인이 실패한 것들.
    #: 비어 있으면 대시보드에 경고 카드를 띄우지 않습니다. mock 모드의
    #: 제공자는 절대 들어가지 않습니다 — 부른 적이 없으니 실패할 수도
    #: 없습니다.
    failing_providers: list[str] = Field(default_factory=list)


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
