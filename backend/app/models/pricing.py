"""What Claude costs, and what a dollar costs in won.

Claude bills in US dollars per million tokens; CTRL+AI budgets in won
(CLAUDE.md section 9). Turning one into the other needs two figures, and
both are kept here, editable by an admin rather than written into code:

* **`ClaudeModelPrice`** — one row per model: dollars per million input
  tokens and per million output tokens. Anthropic changes prices, and the
  club may switch models by changing `ANTHROPIC_MODEL` alone, so every
  model it might use has a row.
* **`ExchangeRate`** — the won per dollar. **A new row per change, never
  an update**, so the history is the table itself. The current rate is the
  newest row.

Every `UsageEvent` copies the dollar cost and the rate it was charged at,
so changing either figure later never moves a charge that already
happened. Each change is also written to the audit log.
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ClaudeModelPrice(Base):
    __tablename__ = "claude_model_prices"

    #: The exact Anthropic model id, e.g. "claude-sonnet-5-5".
    model_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    input_usd_per_mtok: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    output_usd_per_mtok: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<ClaudeModelPrice {self.model_id}>"


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
