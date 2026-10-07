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
    ROLE_SET = "role.set"
    QUARTER_CREATED = "quarter.created"
    QUARTER_UPDATED = "quarter.updated"
    APPLICATION_APPROVED = "application.approved"
    APPLICATION_REJECTED = "application.rejected"
    ALLOCATION_ADJUSTED = "allocation.adjusted"
    TOPUP_CONFIRMED = "topup.confirmed"
    TOPUP_REJECTED = "topup.rejected"
    USAGE_SIMULATED = "usage.simulated"
    # A project or video an admin removed, or put back. A member deleting
    # their own work is not an admin change and is not logged here; an
    # admin reaching into someone else's library is.
    WORK_DELETED = "work.deleted"
    WORK_RESTORED = "work.restored"


#: What each action is called on the Admin screen.
AUDIT_ACTION_LABEL: dict[str, str] = {
    AuditAction.MEMBERSHIP_SET: "참여 상태 변경",
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
