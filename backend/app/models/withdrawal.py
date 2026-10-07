"""Leaving CTRL+AI: one row per withdrawal.

A withdrawal is not a delete. The account becomes `former` at once — the
member is signed out and cannot sign in — but for 30 days nothing else is
lost, and an admin can put it back. Only after the grace period does
`app.jobs.anonymise_withdrawn` remove the personal fields, and only then
is it final.

Three things live here rather than on `User`, because they belong to the
event and not to the person:

* **What was released.** The member's remaining 동아리 지원 stops being
  spendable. There is no club reserve to return it to yet
  (`budget-by-provider` builds one), so the amounts are recorded here and
  in the audit log; that item adds where the money goes next.
* **What has to be undone on 복구.** `reversal` holds the previous
  membership, allocation, application and publishing state, so restoring
  puts back exactly what withdrawing took away rather than guessing.
* **The refund hold.** Personal money is real money. A member who leaves
  with a 개인 충전 balance is marked 환불 대기, and anonymisation waits
  until an admin records the refund — nothing silently discards it.

A member can withdraw, be restored and withdraw again, so there can be
several rows per user. At most one is *open* (not restored); the service
enforces that.
"""

import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, status_enum
from app.models.audit import JSON_TYPE

#: How long an admin may restore a withdrawn account.
GRACE_PERIOD_DAYS = 30


class RefundStatus(str, enum.Enum):
    """Whether personal money is still owed back to the member."""

    #: Nothing was left in the member's 개인 충전 balance.
    NONE = "none"
    #: 환불 대기 — money is owed; anonymisation waits for it.
    PENDING = "pending"
    #: 환불 완료 — an admin recorded that the money was returned.
    RECORDED = "recorded"


class PublishedWorkChoice(str, enum.Enum):
    """What happens to the member's published work."""

    #: Stays public, labelled 탈퇴 회원. The default (CLAUDE.md §10).
    KEEP = "keep"
    #: Everything published is taken down.
    UNPUBLISH = "unpublish"


class AccountWithdrawal(TimestampMixin, Base):
    """One member leaving, and what became of it."""

    __tablename__ = "account_withdrawals"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )

    withdrawn_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: After this, the account can no longer be restored.
    grace_ends_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    #: Who did it — the member themselves, or an admin. Kept if that
    #: account goes, like the audit log's actor.
    initiated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    published_work: Mapped[PublishedWorkChoice] = mapped_column(
        status_enum(PublishedWorkChoice, "publishedworkchoice"),
        default=PublishedWorkChoice.KEEP,
        nullable=False,
    )

    #: Total 동아리 지원 that stopped being spendable, in KRW.
    released_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    refund_status: Mapped[RefundStatus] = mapped_column(
        status_enum(RefundStatus, "refundstatus"),
        default=RefundStatus.NONE,
        nullable=False,
    )
    #: The 개인 충전 balance left when the member withdrew.
    refund_amount_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    refund_recorded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refund_recorded_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Free text — a transfer reference, say. Like `PersonalTopUp`.
    refund_reference: Mapped[str] = mapped_column(String(200), default="", nullable=False)

    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Set by the scheduled job. From here on there is nothing to restore.
    anonymised_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    #: The state withdrawing replaced, so 복구 can put it back exactly.
    reversal: Mapped[dict] = mapped_column(JSON_TYPE, default=dict, nullable=False)

    @property
    def is_open(self) -> bool:
        """Still in effect: not restored."""
        return self.restored_at is None

    def __repr__(self) -> str:
        return (
            f"<AccountWithdrawal user={self.user_id} refund={self.refund_status.value}"
            f" restored={self.restored_at is not None}>"
        )
