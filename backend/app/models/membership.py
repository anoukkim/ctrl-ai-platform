"""Per-quarter participation.

Two different questions are easy to confuse, so they are two different
columns:

* `User.account_status` — can this person use Ctrl AI **at all**? A
  `former` member has left the community and cannot sign in.
* `QuarterMembership.status` — is this member **participating in this
  particular quarter**? Someone can sit a quarter out, keep their account
  and all their work, and come back next quarter.

Participation is per quarter rather than a single field on the user
because Ctrl AI runs by quarter: a member may be active in 2026 Q1, skip
Q2, and return in Q3. A single flag would lose that history, and history
is what the community's attribution depends on.

**A missing row means "not participating".** There is no need to write an
`inactive` row for everyone who did not apply.
"""

import enum

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, status_enum


class MembershipStatus(str, enum.Enum):
    """Participation in one quarter.

    Korean labels (활동 회원 / 비활동 회원 / 탈퇴 회원) live in the frontend;
    the database stores the English value.
    """

    ACTIVE = "active"
    INACTIVE = "inactive"
    FORMER = "former"


class QuarterMembership(TimestampMixin, Base):
    """One member's participation in one quarter."""

    __tablename__ = "quarter_memberships"
    __table_args__ = (
        # One row per member per quarter. Without this a member could end
        # up both active and inactive in the same quarter.
        UniqueConstraint("user_id", "quarter_id", name="uq_membership_user_quarter"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    quarter_id: Mapped[int] = mapped_column(
        ForeignKey("quarters.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[MembershipStatus] = mapped_column(
        status_enum(MembershipStatus, "membership_status"),
        default=MembershipStatus.ACTIVE,
        nullable=False,
    )

    user: Mapped["object"] = relationship("User", lazy="joined")
    quarter: Mapped["object"] = relationship("Quarter", lazy="joined")

    @property
    def may_create(self) -> bool:
        """Only an active participant may use paid creation features."""
        return self.status is MembershipStatus.ACTIVE

    def __repr__(self) -> str:
        return (
            f"<QuarterMembership user_id={self.user_id} "
            f"quarter_id={self.quarter_id} status={self.status.value}>"
        )
