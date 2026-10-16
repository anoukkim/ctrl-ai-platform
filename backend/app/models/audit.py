"""Administrative audit log.

Required by section 17 of CLAUDE.md: "maintain audit logs for admin
credit/membership changes". Credits and membership are the two things an
admin can change that directly affect what a member may do and how much
they may spend, so every such change leaves a row here.

Three decisions worth knowing:

* **Append only.** Nothing updates or deletes a row. The API exposes a
  read-only list; there is no edit or delete endpoint. An audit trail that
  can be quietly rewritten is not an audit trail.
* **`actor_user_id` is nullable with `SET NULL`.** If an admin account is
  ever removed, the record of what they changed must survive — the same
  reasoning that keeps a former member's name on their published work.
  `actor_username` is denormalised for the same reason.
* **`summary` is Korean and stored.** It is rendered when the row is
  written rather than rebuilt when the log is read, so changing the
  wording later cannot retroactively alter what a historical row says.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

#: JSONB on PostgreSQL, plain JSON on SQLite so the tests still run.
JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


class AuditAction:
    """The actions recorded, as plain strings.

    Deliberately not an enum with a CHECK constraint: a new admin action
    should never fail to be logged because a migration has not run yet.
    Losing the audit row is worse than storing an unexpected value.
    """

    MEMBERSHIP_SET = "membership.set"
    #: ctrlaiapps-publish: an admin took a member's app off CtrlAIApps, or
    #: closed a report without doing so.
    APP_UNPUBLISHED = "app.unpublished"
    APP_REPORT_RESOLVED = "app_report.resolved"
    #: example-apps: the server operator published the example apps.
    EXAMPLE_APPS_IMPORTED = "example_apps.imported"
    #: feat-showcase-apps: `--replace` took the earlier examples down
    #: (unpublished and soft-deleted) before publishing the new ones.
    EXAMPLE_APPS_REPLACED = "example_apps.replaced"
    #: project-export-handoff: `--update` brought existing examples up to
    #: the files in the image (a new version, published).
    EXAMPLE_APPS_UPDATED = "example_apps.updated"
    #: app-platform P2: a member allowed / disconnected an app; an admin
    #: stopped or resumed an app's 기능 상자.
    APP_CONSENT_GRANTED = "app_consent.granted"
    APP_CONSENT_REVOKED = "app_consent.revoked"
    APP_SDK_SET = "app.sdk_set"
    APP_DATA_HIDDEN = "app_data.hidden"
    APP_DATA_DELETED = "app_data.deleted"
    ROLE_SET = "role.set"
    QUARTER_CREATED = "quarter.created"
    QUARTER_UPDATED = "quarter.updated"
    APPLICATION_APPROVED = "application.approved"
    APPLICATION_REJECTED = "application.rejected"
    ALLOCATION_ADJUSTED = "allocation.adjusted"
    TOPUP_CONFIRMED = "topup.confirmed"
    TOPUP_REJECTED = "topup.rejected"
    # The usage simulator (removed 2026-10-14, admin-and-nav-cleanup); kept
    # so its old audit rows still read.
    USAGE_SIMULATED = "usage.simulated"
    # A project or video an admin removed, or put back. A member deleting
    # their own work is not an admin change and is not logged here; an
    # admin reaching into someone else's library is.
    WORK_DELETED = "work.deleted"
    WORK_RESTORED = "work.restored"
    # Leaving CTRL+AI. Logged even when the member does it themselves:
    # it releases club money and may leave a refund owed, both of which an
    # admin has to be able to trace.
    ACCOUNT_WITHDRAWN = "account.withdrawn"
    ACCOUNT_RESTORED = "account.restored"
    ACCOUNT_ANONYMISED = "account.anonymised"
    ALLOCATION_RELEASED = "allocation.released"
    REFUND_RECORDED = "refund.recorded"
    # A model's catalogue entry — its options and per-second prices. Logged
    # because a price change moves what every later generation costs.
    VIDEO_MODEL_UPDATED = "video_model.updated"
    # Claude's per-model token prices and the won-per-dollar rate. Logged
    # for the same reason: they decide what every later chat reply costs.
    CLAUDE_PRICE_UPDATED = "claude_price.updated"
    EXCHANGE_RATE_SET = "exchange_rate.set"
    # token-guard: the per-reply cap, the warning threshold, the daily cap.
    CHAT_LIMITS_SET = "chat_limits.set"
    # Invite codes (invite-only-signup): who may create accounts.
    INVITE_CREATED = "invite.created"
    INVITE_DEACTIVATED = "invite.deactivated"
    INVITE_REACTIVATED = "invite.reactivated"
    # google-login: an account made admin because its verified Google email
    # equals ADMIN_EMAIL. Logged with the new account as the actor.
    ADMIN_BY_GOOGLE = "account.admin_by_google"
    # A member linked Google to their account: a new way in.
    GOOGLE_LINKED = "account.google_linked"
    # member-password-login: the other ways in or out of an account.
    GOOGLE_UNLINKED = "account.google_unlinked"
    PASSWORD_SET = "account.password_set"
    PASSWORD_CHANGED = "account.password_changed"
    PASSWORD_REMOVED = "account.password_removed"
    # The chat model catalogue (chat-model-choice). Prices, who may pick a
    # model, and which one is the default all move what members spend.
    # `CLAUDE_PRICE_UPDATED` above stays for the rows written before it.
    CHAT_MODEL_CREATED = "chat_model.created"
    CHAT_MODEL_UPDATED = "chat_model.updated"
    # The operator's password reset from the server shell (set_password).
    PASSWORD_SET_CLI = "account.password_set_cli"
    # cost-clarity: the club's credit purchases (append-only), closing a
    # quarter, and last quarter's unspent wallet carried into the next.
    CREDIT_PURCHASE_RECORDED = "credit.purchase_recorded"
    QUARTER_CLOSED = "quarter.closed"
    ALLOCATION_CARRIED_OVER = "allocation.carried_over"


#: What each action is called on the Admin screen.
AUDIT_ACTION_LABEL: dict[str, str] = {
    AuditAction.MEMBERSHIP_SET: "참여 상태 변경",
    AuditAction.APP_UNPUBLISHED: "앱 게시 내림",
    AuditAction.APP_REPORT_RESOLVED: "앱 신고 처리",
    AuditAction.EXAMPLE_APPS_IMPORTED: "예시 앱 게시",
    AuditAction.EXAMPLE_APPS_REPLACED: "예시 앱 교체",
    AuditAction.EXAMPLE_APPS_UPDATED: "예시 앱 업데이트",
    AuditAction.APP_CONSENT_GRANTED: "앱 연결 허용",
    AuditAction.APP_CONSENT_REVOKED: "앱 연결 끊기",
    AuditAction.APP_SDK_SET: "앱 기능 상자 정지/재개",
    AuditAction.APP_DATA_HIDDEN: "앱 공유 데이터 숨김",
    AuditAction.APP_DATA_DELETED: "앱 공유 데이터 삭제",
    AuditAction.ROLE_SET: "역할 변경",
    AuditAction.QUARTER_CREATED: "분기 생성",
    AuditAction.QUARTER_UPDATED: "분기 수정",
    AuditAction.APPLICATION_APPROVED: "신청 승인",
    AuditAction.APPLICATION_REJECTED: "신청 거절",
    AuditAction.ALLOCATION_ADJUSTED: "지원금 조정",
    AuditAction.TOPUP_CONFIRMED: "충전 확인",
    AuditAction.TOPUP_REJECTED: "충전 거절",
    AuditAction.USAGE_SIMULATED: "사용량 시뮬레이션",
    AuditAction.WORK_DELETED: "작업물 삭제",
    AuditAction.WORK_RESTORED: "작업물 복구",
    AuditAction.ACCOUNT_WITHDRAWN: "회원 탈퇴",
    AuditAction.ACCOUNT_RESTORED: "탈퇴 복구",
    AuditAction.ACCOUNT_ANONYMISED: "개인정보 삭제",
    AuditAction.ALLOCATION_RELEASED: "지원금 해제",
    AuditAction.REFUND_RECORDED: "환불 완료 기록",
    AuditAction.VIDEO_MODEL_UPDATED: "영상 모델 설정 변경",
    AuditAction.CLAUDE_PRICE_UPDATED: "Claude 요금 변경",
    AuditAction.EXCHANGE_RATE_SET: "환율 변경",
    AuditAction.CHAT_LIMITS_SET: "채팅 한도 변경",
    AuditAction.INVITE_CREATED: "초대 코드 생성",
    AuditAction.INVITE_DEACTIVATED: "초대 코드 사용 중지",
    AuditAction.INVITE_REACTIVATED: "초대 코드 다시 사용",
    AuditAction.ADMIN_BY_GOOGLE: "Google 계정으로 관리자 가입",
    AuditAction.GOOGLE_LINKED: "Google 로그인 연결",
    AuditAction.GOOGLE_UNLINKED: "Google 로그인 연결 해제",
    AuditAction.PASSWORD_SET: "비밀번호 로그인 추가",
    AuditAction.PASSWORD_CHANGED: "비밀번호 변경",
    AuditAction.PASSWORD_REMOVED: "비밀번호 로그인 삭제",
    AuditAction.CHAT_MODEL_CREATED: "AI 모델 추가",
    AuditAction.CHAT_MODEL_UPDATED: "AI 모델 변경",
    AuditAction.PASSWORD_SET_CLI: "서버에서 비밀번호 재설정",
    AuditAction.CREDIT_PURCHASE_RECORDED: "크레딧 구매 기록",
    AuditAction.QUARTER_CLOSED: "분기 마감",
    AuditAction.ALLOCATION_CARRIED_OVER: "지원금 이월",
}


class AuditLog(Base):
    """One administrative change."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Who made the change. Kept even if the account is later removed.
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    #: Denormalised so the log still reads correctly if the account goes.
    actor_username: Mapped[str] = mapped_column(String(50), default="", nullable=False)

    action: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    #: What was changed — "user", "quarter", "allocation", "top_up".
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Who it was done to, when the target is a member.
    target_label: Mapped[str] = mapped_column(String(120), default="", nullable=False)

    #: A Korean sentence, rendered at write time.
    summary: Mapped[str] = mapped_column(String(300), nullable=False)
    #: Before/after values, for anything the summary cannot carry.
    detail: Mapped[dict | None] = mapped_column(JSON_TYPE, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<AuditLog {self.action} target={self.target_type}:{self.target_id}>"
