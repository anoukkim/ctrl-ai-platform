"""Spend milestones a member has already been shown (feat-spend-feedback).

One row per member, quarter and milestone kind — 첫 사용, 25 / 50 / 75 %
used, 잔액 10,000원 이하, 잔액 0. The unique key is what makes each one
appear **once per quarter**, on whichever device the member uses next
(`services/milestones.py`).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SpendMilestone(Base):
    __tablename__ = "spend_milestones"
    __table_args__ = (
        UniqueConstraint("user_id", "quarter_id", "kind", name="uq_spend_milestone"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    quarter_id: Mapped[int] = mapped_column(
        ForeignKey("quarters.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: "first" | "used_25" | "used_50" | "used_75" | "low" | "empty".
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
