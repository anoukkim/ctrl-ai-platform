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
    visibility: Mapped[ChatModelVisibility] = mapped_column(
        status_enum(ChatModelVisibility, "chatmodelvisibility"),
        default=ChatModelVisibility.DISABLED,
        nullable=False,
    )
    #: Exactly one row is the default, and it is always open to members —
    #: the admin routes refuse anything else.
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    def __repr__(self) -> str:
        return f"<ChatModel {self.provider}/{self.model_id} {self.visibility.value}>"


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
