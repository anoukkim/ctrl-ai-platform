"""Usage ledger.

One row per paid action, recorded so an admin can eventually reconcile a
provider's invoice against what members actually consumed.

Two amounts are kept on purpose:

* `provider_cost` — what the provider charged, in their own units
* `charged_krw`   — what Ctrl AI took off a budget

They are not the same number and must not be conflated: the platform may
round, batch, or absorb a difference. The KRW figure is the one that moves
a balance.

Every charge comes out of the member's one 동아리 지원 wallet (or, if
they opted in, their personal balance). What the money was *for* is
recorded on the event instead — `provider` (Anthropic vs Higgsfield, which
is what the club buys credit from), `feature` (chat, video_generate, …),
`model_id` and the native units — so the club can still see what was
spent where, and forecast each provider's purchase from it.
"""

import enum
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, status_enum


class FundingSource(str, enum.Enum):
    """Which pot paid for this action: the 동아리 지원 wallet or the member's
    own money. Never both — a charge is paid from one pot.
    """

    COMMUNITY = "community"
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
    #: app-platform P2: AI inside a member app, paid by the visitor
    #: (`builder_project_id` names the app).
    APP_AI = "app_ai"
    #: app-platform P4: the same, from the Builder's 미리보기 — the creator
    #: trying their own app, charged to the creator. Kept apart so Usage
    #: and Admin › Apps can tell a visitor's use from the maker's tries.
    APP_AI_PREVIEW = "app_ai_preview"
    #: publish-summary: the 게시 dialog's pre-filled text — always a
    #: club-absorbed row (0원 to the member).
    PUBLISH_SUMMARY = "publish_summary"
    #: chat-to-builder-carry: naming a 미리보기 that has no title — a
    #: club-absorbed row (0원 to the member).
    PROJECT_NAME = "project_name"
    #: image-generation: one picture from an 이미지 만들기 card in Chat
    #: (`conversation_id` names the conversation).
    IMAGE_GENERATE = "image_generate"


#: How a member's spending is broken down on their wallet card: 채팅 /
#: 빌더 / 영상 / 기타. Information only — all three come out of the same wallet.
#: The video prompt helper is Claude, but the member was making a video,
#: so it counts as 영상.
SPENDING_GROUP: dict[str, str] = {
    UsageFeature.CHAT.value: "chat",
    # 빌더 got its own line with cost-clarity (2026-10-14): the owner's
    # breakdown is 채팅 / 빌더 / 영상 / 기타.
    UsageFeature.BUILD.value: "build",
    UsageFeature.PUBLISH_SUMMARY.value: "build",
    UsageFeature.PROJECT_NAME.value: "build",
    UsageFeature.VIDEO_PROMPT.value: "video",
    UsageFeature.VIDEO_GENERATE.value: "video",
    UsageFeature.VIDEO_EDIT.value: "video",
    UsageFeature.VIDEO_EXTEND.value: "video",
    # image-generation: made in Chat, so it counts as 채팅 (the owner's four
    # lines stay); the ledger row itself says 이미지.
    UsageFeature.IMAGE_GENERATE.value: "chat",
}


def spending_group(feature: str | None) -> str:
    """`chat`, `build`, `video` or `other` for a `UsageEvent.feature` value."""
    return SPENDING_GROUP.get(feature or "", "other")


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

    funding_source: Mapped[FundingSource] = mapped_column(
        status_enum(FundingSource, "fundingsource"), nullable=False
    )

    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    #: A `UsageFeature` value. See that class for why it is a string.
    feature: Mapped[str | None] = mapped_column(String(30), nullable=True)
    #: The provider's model id, when the action used one.
    model_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    #: The 생각 깊이 of a Claude call (quality-tuning Q1), for Admin ›
    #: Budget's model × depth view. None before Q1 and for other providers.
    depth: Mapped[str | None] = mapped_column(String(10), nullable=True)

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
    #: Prompt caching (prompt-caching). `input_tokens` is then only the
    #: uncached input; these are the tokens written to and read from the
    #: cache, each priced at its own rate. Null on rows from before caching
    #: and on anything that is not a Claude call.
    cache_write_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_read_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: The input estimate the pre-check used, before the call (Chat only).
    #: Kept next to the real counts so `services/calibration.py` can learn
    #: how far off the estimate runs (cost-calibration).
    estimated_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Server-tool use this charge covered (chat-plus-tools): how many web
    #: searches ran, and the won their per-search fee added on top of the
    #: token cost. Null when no tool ran — old rows read unchanged.
    web_search_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    web_fetch_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tool_fee_krw: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: The reply was written with 생각 과정 보기 on (chat-thinking-view), so
    #: its output includes the thinking tokens. Calibration keeps these
    #: apart from ordinary replies. Null on everything else.
    thinking_shown: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    #: The won per unit of `provider_currency` this charge was converted
    #: at, copied from the rate in force. A later rate change does not move
    #: a charge that already happened.
    exchange_rate_krw: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    #: What Ctrl AI deducted from a budget.
    charged_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    #: The dollar cost split by what it paid for (cost-clarity), at the
    #: prices in force when the charge was made: uncached input, cache
    #: writes, cache reads, output, and tool fees. They add up to
    #: `provider_cost`. `cache_saved_usd` is what the cache reads would
    #: have cost as plain input, minus what they did cost — the member's
    #: "캐시로 아낀 금액". Null on rows from before the split, and on
    #: anything not priced by the token (video).
    input_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    cache_write_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    cache_read_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    output_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    tool_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    cache_saved_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)

    #: The club paid the provider for this call but no member was charged
    #: (cost-clarity): a Builder generation cut off or unusable after the
    #: provider had already billed it. `charged_krw` is 0; `provider_cost`
    #: is what the club spent, so Admin › Budget's 사용 matches the
    #: provider's bill. Never shown to members as a charge.
    club_absorbed: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )

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

    #: The project's or video's name, written just before that row is
    #: purged for good (ui-improvements B): the money row outlives the
    #: work, and Usage must still say what the charge was for. Null while
    #: the project exists — its live name is read instead.
    work_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    def __repr__(self) -> str:
        return (
            f"<UsageEvent user={self.user_id} {self.feature or self.provider}"
            f" {self.charged_krw}KRW from {self.funding_source.value}>"
        )
