"""Seasons and seasonal membership.

Ctrl AI runs in seasons of four months (NOT quarters). A person's account
and their participation in a season are deliberately separate things: a
member who sits out a season keeps their account, their projects and the
attribution on anything they published.
"""

import enum
from datetime import date

from sqlalchemy import Date, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class SeasonStatus(str, enum.Enum):
    """Where a season sits relative to today."""

    UPCOMING = "upcoming"
    ACTIVE = "active"
    CLOSED = "closed"


class MembershipStatus(str, enum.Enum):
    """A person's standing in one season.

    `FORMER` means they left the community. It is not a deletion: their
    published work keeps their name, so the row must survive.
    """

    ACTIVE = "active"
    INACTIVE = "inactive"
    FORMER = "former"


def status_enum(enum_type: type[enum.Enum], name: str) -> Enum:
    """Store an enum as VARCHAR with a CHECK constraint.

    A native PostgreSQL ENUM would turn "add one more value" into an
    ALTER TYPE; this way it stays an ordinary migration, and the same
    model still works on SQLite in the tests.
    """
    return Enum(
        enum_type,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=20,
        values_callable=lambda e: [member.value for member in e],
    )


class Season(TimestampMixin, Base):
    """One four-month season."""

    __tablename__ = "seasons"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    starts_at: Mapped[date] = mapped_column(Date, nullable=False)
    ends_at: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[SeasonStatus] = mapped_column(
        status_enum(SeasonStatus, "seasonstatus"),
        default=SeasonStatus.UPCOMING,
        nullable=False,
    )

    memberships: Mapped[list["SeasonMembership"]] = relationship(back_populates="season")

    def __repr__(self) -> str:
        return f"<Season {self.name!r} {self.status.value}>"


class SeasonMembership(TimestampMixin, Base):
    """A person's participation in one season."""

    __tablename__ = "season_memberships"
    __table_args__ = (UniqueConstraint("user_id", "season_id", name="uq_membership_user_season"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id", ondelete="CASCADE"), index=True)
    status: Mapped[MembershipStatus] = mapped_column(
        status_enum(MembershipStatus, "membershipstatus"),
        default=MembershipStatus.ACTIVE,
        nullable=False,
    )

    season: Mapped["Season"] = relationship(back_populates="memberships")

    def __repr__(self) -> str:
        return f"<SeasonMembership user={self.user_id} season={self.season_id}>"


class CreditAllocation(TimestampMixin, Base):
    """What one member may spend with one provider in one season.

    Providers do not bill in the same unit, so the unit is stored per row
    rather than converted into an invented platform currency.
    """

    __tablename__ = "credit_allocations"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "season_id", "provider", "resource_type", name="uq_allocation_scope"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id", ondelete="CASCADE"), index=True)

    # "anthropic" / "higgsfield" — the provider, not the model.
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    # "text" / "video" — what the allowance buys.
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # "tokens" / "credits" — kept per row on purpose.
    unit: Mapped[str] = mapped_column(String(20), nullable=False)

    allocated_amount: Mapped[int] = mapped_column(default=0, nullable=False)
    consumed_amount: Mapped[int] = mapped_column(default=0, nullable=False)

    @property
    def remaining_amount(self) -> int:
        return max(0, self.allocated_amount - self.consumed_amount)

    def __repr__(self) -> str:
        return f"<CreditAllocation user={self.user_id} {self.provider}:{self.resource_type}>"
