"""Quarters, quarter applications, and approved allocations.

Ctrl AI operates by calendar quarter — 2026 Q1, 2026 Q2, and so on. A
quarter is normally three months. (This replaces the earlier four-month
"Season" concept; nothing in the product uses Season any more.)

Credits are not automatic. The flow is:

    admin opens applications for a quarter
      -> member presses "이번 분기 참여" — one amount, the quarter's
      -> admin approves
      -> the member's 동아리 지원 wallet for the quarter exists

There is one wallet per member per quarter (`single-wallet`, 2026-10-08).
Chat, video and every other paid feature spend from it; what each charge
was for — provider, feature, model — is on the usage event, not in a
separate bucket.

Money is the source of truth. Budgets are stored in KRW, never in tokens
or generations, because provider pricing changes and an old allocation
must not move when it does.
"""

import enum
from datetime import date, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin, status_enum


class QuarterStatus(str, enum.Enum):
    """Where a quarter sits in its life."""

    DRAFT = "draft"
    APPLICATION_OPEN = "application_open"
    ACTIVE = "active"
    CLOSED = "closed"


class ApplicationStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class Quarter(TimestampMixin, Base):
    """One calendar quarter.

    The application window is separate from the quarter itself: members
    normally apply *before* a quarter starts.
    """

    __tablename__ = "quarters"

    id: Mapped[int] = mapped_column(primary_key=True)

    #: Sortable machine form, e.g. "2026-Q1".
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    #: What members see, e.g. "2026 Q1".
    display_name: Mapped[str] = mapped_column(String(50), nullable=False)

    starts_at: Mapped[date] = mapped_column(nullable=False)
    ends_at: Mapped[date] = mapped_column(nullable=False)

    application_opens_at: Mapped[date | None] = mapped_column(nullable=True)
    application_closes_at: Mapped[date | None] = mapped_column(nullable=True)

    status: Mapped[QuarterStatus] = mapped_column(
        status_enum(QuarterStatus, "quarterstatus"),
        default=QuarterStatus.DRAFT,
        nullable=False,
    )

    #: The 동아리 지원 each participating member receives this quarter, in
    #: KRW — the one amount "이번 분기 참여" applies for. Configurable per
    #: quarter rather than a constant scattered through the code; the
    #: default comes from settings (80,000원). Changing it later does not
    #: move a wallet that was already approved.
    subsidy_limit_krw: Mapped[int] = mapped_column(Integer, nullable=False)

    #: 분기 마감 (cost-clarity): what share of each member's unspent
    #: wallet carries into their next approved wallet. 0 by default —
    #: unspent money goes back to the club (회수). Set at close.
    carry_over_percent: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    applications: Mapped[list["QuarterApplication"]] = relationship(back_populates="quarter")

    @property
    def is_accepting_applications(self) -> bool:
        return self.status is QuarterStatus.APPLICATION_OPEN

    def __repr__(self) -> str:
        return f"<Quarter {self.code} {self.status.value}>"


class QuarterApplication(TimestampMixin, Base):
    """A member's request to take part in one quarter.

    There is nothing to choose: the member applies for the quarter's
    amount, which is copied here so the application still reads correctly
    if an admin changes the quarter's amount afterwards.

    One live application per member per quarter: a cancelled or rejected
    one may be replaced, which is what the partial unique behaviour in the
    service layer enforces.
    """

    __tablename__ = "quarter_applications"
    __table_args__ = (
        UniqueConstraint("user_id", "quarter_id", name="uq_application_user_quarter"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    quarter_id: Mapped[int] = mapped_column(
        ForeignKey("quarters.id", ondelete="CASCADE"), index=True, nullable=False
    )

    #: The quarter's amount when the member applied.
    requested_budget_krw: Mapped[int] = mapped_column(Integer, nullable=False)

    status: Mapped[ApplicationStatus] = mapped_column(
        status_enum(ApplicationStatus, "applicationstatus"),
        default=ApplicationStatus.SUBMITTED,
        nullable=False,
    )

    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    admin_note: Mapped[str] = mapped_column(Text, default="", nullable=False)

    quarter: Mapped["Quarter"] = relationship(back_populates="applications")

    def __repr__(self) -> str:
        return f"<QuarterApplication user={self.user_id} quarter={self.quarter_id} {self.status.value}>"


class QuarterAllocation(TimestampMixin, Base):
    """One member's 동아리 지원 wallet for one quarter.

    One balance in KRW that every paid feature spends from. Community money
    only — personal top-ups are a separate balance and must never be mixed
    into these figures.
    """

    __tablename__ = "quarter_allocations"
    __table_args__ = (
        UniqueConstraint("user_id", "quarter_id", name="uq_allocation_user_quarter"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    quarter_id: Mapped[int] = mapped_column(
        ForeignKey("quarters.id", ondelete="CASCADE"), index=True, nullable=False
    )
    application_id: Mapped[int | None] = mapped_column(
        ForeignKey("quarter_applications.id", ondelete="SET NULL"), nullable=True
    )

    #: What the wallet holds this quarter. Copied from the application at
    #: approval; an admin may adjust it, and a withdrawal releases what is
    #: left of it.
    budget_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    #: What has been spent from it. Only `usage.charge()` raises it.
    consumed_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    #: Provider prices at the moment of approval. Kept so a member's quota
    #: in tokens or generations can be shown consistently even after a
    #: provider changes its prices. Shape is not enforced yet.
    pricing_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # 분기 마감 (cost-clarity). Set once when the quarter is closed; a
    # frozen wallet is never charged again. Nothing is deleted.
    #: When the wallet was frozen.
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: What was left at close — shown as 회수 (back to the club).
    reclaimed_krw: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: The part of it that carries into the member's next wallet.
    carry_over_krw: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: The wallet the carry-over was added to, once it has been.
    carried_into_id: Mapped[int | None] = mapped_column(
        ForeignKey("quarter_allocations.id", ondelete="SET NULL"), nullable=True
    )

    @property
    def remaining_krw(self) -> int:
        return max(0, self.budget_krw - self.consumed_krw)

    def __repr__(self) -> str:
        return f"<QuarterAllocation user={self.user_id} quarter={self.quarter_id}>"
