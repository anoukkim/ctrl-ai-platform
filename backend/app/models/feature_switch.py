"""Feature switches the 관리자 flips at run time (owner-polish 6).

The first one locks the **Video Generator** for members: the owner starts
video two quarters from now, keeps the provider wiring, and wants the
whole area closed until then — behind a switch, not a deploy.

Like `ChatLimits` and `ExchangeRate`, the history is the table itself: a
new row per change, the newest row per key is the one in force, and no
row means the code's default (`services/feature_switches.py` — video is
**locked** by default, so a fresh database fails closed). Every change
is also an audit entry.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FeatureSwitch(Base):
    __tablename__ = "feature_switches"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Which feature — `feature_switches.VIDEO` ("video") for now.
    key: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    #: True = open to members. The 관리자 is never locked out.
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    #: Why, in the admin's words — shown beside the switch.
    note: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    set_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<FeatureSwitch {self.key} {'open' if self.enabled else 'locked'}>"
