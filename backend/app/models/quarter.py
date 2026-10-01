"""Quarters, quarter applications, and approved allocations.

Ctrl AI operates by calendar quarter — 2026 Q1, 2026 Q2, and so on. A
quarter is normally three months. (This replaces the earlier four-month
"Season" concept; nothing in the product uses Season any more.)

Credits are not automatic. The flow is:

    admin opens applications for a quarter
      -> member applies, choosing how to split their budget between
         Build and Video
      -> admin approves
      -> the approved allocation becomes usable

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


#: Budget categories a member splits their allowance between.
class BudgetCategory(str, enum.Enum):
    BUILD = "build"
    VIDEO = "video"


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

    #: Maximum community-funded budget one member may receive this
    #: quarter, in KRW. Configurable per quarter rather than a constant
    #: scattered through the code; the default comes from settings.
    subsidy_limit_krw: Mapped[int] = mapped_column(Integer, nullable=False)

    applications: Mapped[list["QuarterApplication"]] = relationship(back_populates="quarter")

    @property
    def is_accepting_applications(self) -> bool:
        return self.status is QuarterStatus.APPLICATION_OPEN

    def __repr__(self) -> str:
        return f"<Quarter {self.code} {self.status.value}>"


class QuarterApplication(TimestampMixin, Base):
    """A member's request to take part in one quarter.

    The member chooses a percentage split; the KRW amounts are computed
    from the quarter's subsidy limit and stored, so the application still
    reads correctly if the limit changes afterwards.

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

    #: Must add up to exactly 100.
    build_percentage: Mapped[int] = mapped_column(Integer, nullable=False)
    video_percentage: Mapped[int] = mapped_column(Integer, nullable=False)

    requested_total_budget_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    requested_build_budget_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    requested_video_budget_krw: Mapped[int] = mapped_column(Integer, nullable=False)

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
    """What an approved member may actually spend in one quarter.

    Two buckets, both in KRW. Community money only — personal top-ups are
    a separate balance and must never be mixed into these figures.
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

    community_total_budget_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    build_budget_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    video_budget_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    build_percentage: Mapped[int] = mapped_column(Integer, nullable=False)
    video_percentage: Mapped[int] = mapped_column(Integer, nullable=False)

    build_consumed_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    video_consumed_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    #: Provider prices at the moment of approval. Kept so a member's quota
    #: in tokens or generations can be shown consistently even after a
    #: provider changes its prices. Shape is not enforced yet.
    pricing_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    @property
    def build_remaining_krw(self) -> int:
        return max(0, self.build_budget_krw - self.build_consumed_krw)

    @property
    def video_remaining_krw(self) -> int:
        return max(0, self.video_budget_krw - self.video_consumed_krw)

    def __repr__(self) -> str:
        return f"<QuarterAllocation user={self.user_id} quarter={self.quarter_id}>"
