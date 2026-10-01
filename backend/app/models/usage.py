"""Usage ledger.

One row per paid action, recorded so an admin can eventually reconcile a
provider's invoice against what members actually consumed.

Two amounts are kept on purpose:

* `provider_cost` — what the provider charged, in their own units
* `charged_krw`   — what Ctrl AI took off a budget

They are not the same number and must not be conflated: the platform may
round, batch, or absorb a difference. The KRW figure is the one that moves
a balance.

Nothing writes to this table yet — no provider is called in Phase 1. The
shape exists so that when one is, the accounting is already in place.
"""

import enum

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, status_enum
from app.models.quarter import BudgetCategory


class FundingSource(str, enum.Enum):
    """Which pot paid for this action.

    Split by category as well as by community/personal, so a Build charge
    can never quietly come out of the Video budget.
    """

    COMMUNITY_BUILD = "community_build"
    COMMUNITY_VIDEO = "community_video"
    PERSONAL = "personal"


class UsageEvent(TimestampMixin, Base):
    """One charged action."""

    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: Null for usage that happened outside any approved quarter.
    quarter_id: Mapped[int | None] = mapped_column(
        ForeignKey("quarters.id", ondelete="SET NULL"), index=True, nullable=True
    )

    category: Mapped[BudgetCategory] = mapped_column(
        status_enum(BudgetCategory, "budgetcategory"), nullable=False
    )
    funding_source: Mapped[FundingSource] = mapped_column(
        status_enum(FundingSource, "fundingsource"), nullable=False
    )

    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    #: The provider's model id, when the action used one.
    model_id: Mapped[str | None] = mapped_column(String(120), nullable=True)

    #: How much of the provider's own unit was used — tokens, seconds,
    #: generations. The unit is named rather than assumed.
    provider_units: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    provider_unit: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    #: What the provider charged, in their billing currency. Numeric, not
    #: float: money must not drift.
    provider_cost: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)
    provider_currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)

    #: What Ctrl AI deducted from a budget.
    charged_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    #: Whichever project the action belonged to, when it belonged to one.
    builder_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="SET NULL"), nullable=True
    )
    video_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("video_projects.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self) -> str:
        return (
            f"<UsageEvent user={self.user_id} {self.category.value}"
            f" {self.charged_krw}KRW from {self.funding_source.value}>"
        )
