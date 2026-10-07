"""Usage ledger.

One row per paid action, recorded so an admin can eventually reconcile a
provider's invoice against what members actually consumed.

Two amounts are kept on purpose:

* `provider_cost` — what the provider charged, in their own units
* `charged_krw`   — what Ctrl AI took off a budget

They are not the same number and must not be conflated: the platform may
round, batch, or absorb a difference. The KRW figure is the one that moves
a balance.

`feature` says which product action spent the money, independently of
which budget paid: the Video workspace's Claude prompt helper charges the
Build budget, but it is still `video_prompt`, not `build`. The tags are the
ones `budget-by-provider` will report on, so nothing needs backfilling.
"""

import enum
from decimal import Decimal

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


class UsageFeature(str, enum.Enum):
    """Which product action a charge came from.

    Stored as a plain string, not an enum column, so a new feature is a
    new value rather than a migration. Null on rows written before the
    column existed: what they were for is not recorded anywhere.
    """

    CHAT = "chat"
    BUILD = "build"
    VIDEO_PROMPT = "video_prompt"
    VIDEO_GENERATE = "video_generate"
    VIDEO_EDIT = "video_edit"
    VIDEO_EXTEND = "video_extend"


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
    #: A `UsageFeature` value. See that class for why it is a string.
    feature: Mapped[str | None] = mapped_column(String(30), nullable=True)
    #: The provider's model id, when the action used one.
    model_id: Mapped[str | None] = mapped_column(String(120), nullable=True)

    #: How much of the provider's own unit was used — tokens, seconds,
    #: generations. The unit is named rather than assumed.
    provider_units: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    provider_unit: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    #: What the provider charged, in their billing currency. Numeric, not
    #: float: money must not drift. Six decimal places because one chat
    #: reply costs about a cent.
    provider_cost: Mapped[float | None] = mapped_column(Numeric(14, 6), nullable=True)
    provider_currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)

    #: Token counts, split, for a Claude call. `provider_units` keeps their
    #: sum so older reports still add up; these two say which was which,
    #: because input and output are priced differently. Null for anything
    #: that is not priced by the token.
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: The won per unit of `provider_currency` this charge was converted
    #: at, copied from the rate in force. A later rate change does not move
    #: a charge that already happened.
    exchange_rate_krw: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    #: What Ctrl AI deducted from a budget.
    charged_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    #: Whichever project the action belonged to, when it belonged to one.
    builder_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="SET NULL"), nullable=True
    )
    video_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("video_projects.id", ondelete="SET NULL"), nullable=True
    )
    #: The version a video charge produced — so a member's version strip
    #: and an admin's ledger can point at the same attempt.
    video_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("video_versions.id", ondelete="SET NULL"), nullable=True
    )

    #: The chat conversation a reply belonged to. SET NULL because deleting
    #: a conversation is a real delete, and the money record must outlive it.
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )

    def __repr__(self) -> str:
        return (
            f"<UsageEvent user={self.user_id} {self.category.value}"
            f" {self.charged_krw}KRW from {self.funding_source.value}>"
        )
