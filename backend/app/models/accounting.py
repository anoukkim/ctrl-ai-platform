"""The club's side of the money (cost-clarity, 2026-10-14).

Two append-only records:

* **`CreditPurchase`** — what the club bought from a provider: the date,
  the dollars of credit, the won the 팀장 actually paid, a memo. Nothing
  updates or deletes a row; a mistake is corrected by a second row with a
  negative amount and a memo saying so. Admin › Budget subtracts what the
  ledger says was used (`UsageEvent.provider_cost`) to estimate what is
  left — an estimate, because the provider's console is the final word.
* **`WalletAdjustment`** — an admin moving one member's wallet up or down
  with a reason, or a quarter's carry-over landing in the next wallet.
  The wallet's `budget_krw` is the running total; these rows are how it
  got there, and they are never edited.
"""

import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CreditPurchase(Base):
    __tablename__ = "credit_purchases"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Who the credit was bought from — the ledger's provider key
    #: ("claude" for Anthropic, "higgsfield", …).
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    purchased_on: Mapped[date] = mapped_column(Date, nullable=False)
    #: Credit received, in the provider's currency (USD for Anthropic).
    #: Negative only on a correcting row.
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    #: What the card was actually charged, in won (fees and the bank's
    #: rate included) — the figure the receipt and Concur show.
    paid_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    memo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<CreditPurchase {self.provider} ${self.amount_usd} {self.paid_krw}KRW>"


class AdjustmentKind(str, enum.Enum):
    #: An admin's +/− with a reason.
    ADJUST = "adjust"
    #: Part of last quarter's unspent wallet, added at approval.
    CARRY_OVER = "carry_over"


class WalletAdjustment(Base):
    __tablename__ = "wallet_adjustments"

    id: Mapped[int] = mapped_column(primary_key=True)
    allocation_id: Mapped[int] = mapped_column(
        ForeignKey("quarter_allocations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    quarter_id: Mapped[int] = mapped_column(
        ForeignKey("quarters.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: Signed: + adds to the wallet, − takes away.
    amount_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    #: An `AdjustmentKind` value, stored as text like `UsageEvent.feature`.
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default=AdjustmentKind.ADJUST.value)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    #: The wallet's total before and after, so the row reads on its own.
    budget_before_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    budget_after_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<WalletAdjustment user={self.user_id} {self.amount_krw:+}KRW {self.kind}>"
