"""Personal (member-funded) money.

Kept deliberately separate from the community quarterly subsidy. A member
who has used up their community budget may continue only if they have
their own balance AND have explicitly turned personal spending on. Personal
money is never charged silently, and it never raises the community subsidy
above the quarter's limit.

Phase 1 is a manual workflow: the member requests a top-up, an admin
confirms the deposit. There is no payment provider, and none is called.
"""

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, status_enum


class TopUpStatus(str, enum.Enum):
    REQUESTED = "requested"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class PersonalBalance(TimestampMixin, Base):
    """One member's own money, in KRW.

    `overage_enabled` is the opt-in. While it is false, usage stops when
    the community allocation runs out instead of reaching for this balance.
    """

    __tablename__ = "personal_balances"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )

    balance_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    consumed_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    #: Must be turned on by the member before any personal money is spent.
    overage_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    @property
    def remaining_krw(self) -> int:
        return max(0, self.balance_krw - self.consumed_krw)

    def __repr__(self) -> str:
        return f"<PersonalBalance user={self.user_id} remaining={self.remaining_krw}>"


class PersonalTopUp(TimestampMixin, Base):
    """A request to add personal money, confirmed by an admin.

    `payment_reference` is free text for now — a deposit slip number, say.
    A real payment provider would fill it automatically later.
    """

    __tablename__ = "personal_top_ups"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )

    amount_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[TopUpStatus] = mapped_column(
        status_enum(TopUpStatus, "topupstatus"),
        default=TopUpStatus.REQUESTED,
        nullable=False,
    )

    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    payment_reference: Mapped[str | None] = mapped_column(String(200), nullable=True)

    def __repr__(self) -> str:
        return f"<PersonalTopUp user={self.user_id} {self.amount_krw}KRW {self.status.value}>"
