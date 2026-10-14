"""The chat model catalogue, and what a dollar costs in won.

Claude bills in US dollars per million tokens; CTRL+AI budgets in won
(CLAUDE.md section 9). Turning one into the other needs two figures, and
both are kept here, editable by an admin rather than written into code:

* **`ChatModel`** — the catalogue: one row per *provider + model*, with
  its dollars per million input and output tokens, the Korean label and
  description members see, and who may pick it. The provider is
  `anthropic` today; another provider later (Gemini, say) is a new
  adapter plus rows here, not a new table. Exactly one row is the
  **default** — what a new conversation and the video prompt helper use.
  It replaced `claude_model_prices` and the single `ANTHROPIC_MODEL`
  setting (chat-model-choice, 2026-10-07); `ANTHROPIC_MODEL` is now only
  the fallback when the catalogue is empty.
* **`ExchangeRate`** — the won per dollar. **A new row per change, never
  an update**, so the history is the table itself. The current rate is the
  newest row.

Every `UsageEvent` copies the dollar cost and the rate it was charged at,
so changing either figure later never moves a charge that already
happened. Each change is also written to the audit log.
"""

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, status_enum


class ChatModelVisibility(str, enum.Enum):
    """Who may pick a catalogue model."""

    #: Any member may choose it in Chat.
    MEMBERS = "members"
    #: Only admins may choose it — to try a model before opening it up.
    ADMIN = "admin"
    #: Nobody; kept so past messages and usage still name it.
    DISABLED = "disabled"


class ChatModel(TimestampMixin, Base):
    __tablename__ = "chat_models"
    __table_args__ = (UniqueConstraint("provider", "model_id", name="uq_chat_models_provider_model"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Whose API serves it: "anthropic" today. See `services/chat_models.py`.
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    #: The exact id the provider's API expects, e.g. "claude-sonnet-5-5".
    model_id: Mapped[str] = mapped_column(String(120), nullable=False)
    #: What members read in the picker, in Korean.
    label: Mapped[str] = mapped_column(String(60), nullable=False)
    #: One line under the label: what the model is good for.
    description: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    input_usd_per_mtok: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    output_usd_per_mtok: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    #: What reading this model's prompt cache costs, per million tokens.
    #: Null means a tenth of the input price — Anthropic's rule for most
    #: models; Opus 5.5 reads at a twentieth. Cache *writes* need no column:
    #: they are always 1.25x (5-minute) or 2x (1-hour) the input price.
    cache_read_usd_per_mtok: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 4), nullable=True
    )
    visibility: Mapped[ChatModelVisibility] = mapped_column(
        status_enum(ChatModelVisibility, "chatmodelvisibility"),
        default=ChatModelVisibility.DISABLED,
        nullable=False,
    )
    #: Exactly one row is the default, and it is always open to members —
    #: the admin routes refuse anything else.
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Anthropic server tools (chat-plus-tools): which this model may use.
    # Off until an admin opens one; a member still has to turn it on per
    # conversation. Mock-only until Phase 9 — no real API is ever called.
    tools_web_search: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    tools_web_fetch: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    tools_code_execution: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    #: $ per web search ($10 per 1,000). A catalogue value, admin-editable.
    web_search_usd_per_call: Mapped[Decimal] = mapped_column(
        Numeric(10, 6), default=Decimal("0.01"), nullable=False
    )

    def __repr__(self) -> str:
        return f"<ChatModel {self.provider}/{self.model_id} {self.visibility.value}>"


class ChatLimits(Base):
    """The three spending guards (token-guard): a new row per change.

    Like `ExchangeRate`, the history is the table itself and the row in
    force is the newest one. With no row at all the code's defaults apply
    (`services/chat_limits.py`), so the table needs no seed.

    * `reply_cap_krw` — one reply may cost at most this, enforced
      **before** the call through `max_tokens`. 0 turns the cap off.
    * `long_history_tokens` — the input estimate at which the composer
      warns that a long conversation is getting expensive. 0 turns the
      warning off.
    * `daily_cap_krw` — the most one member may spend per KST day across
      every paid feature. 0 turns it off (the default).
    """

    __tablename__ = "chat_limits"

    id: Mapped[int] = mapped_column(primary_key=True)
    reply_cap_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    long_history_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    daily_cap_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Outgoing provider calls allowed at once, per server process
    #: (audit-caching-and-distribution). Guards the club key against one
    #: member starting many streams; never 0 — that would stop Chat.
    provider_concurrency: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="3"
    )
    #: 웹 페이지 읽기 (tool-cap-defaults, owner 2026-10-14 morning):
    #: fetches per reply and tokens per fetched page. Inside the
    #: per-reply cap's reserve, so smaller values fit a smaller cap.
    #: Never 0 — the member's toggle is how the tool turns off.
    web_fetch_max_uses: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )
    web_fetch_max_content_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="10000"
    )
    set_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return (
            f"<ChatLimits reply={self.reply_cap_krw} "
            f"history={self.long_history_tokens} daily={self.daily_cap_krw}>"
        )


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Always "USD" today; named so a second currency is a row, not a column.
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False, index=True)
    krw_per_unit: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    set_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<ExchangeRate {self.currency}={self.krw_per_unit}>"
