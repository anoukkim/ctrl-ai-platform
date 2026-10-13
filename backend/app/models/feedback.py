"""Feedback a member sends from the 의견 보내기 button.

The 의견 보내기 button in the sidebar footer is the one way a member
sends a note (admin-and-nav-cleanup, 2026-10-14 — Report Issue and
`/issues` are gone): a short note saved here and read in Admin ›
Feedback (prep-beta-launch, point 2).

The author is a foreign key and nothing else — no copied username. A
withdrawn member is anonymised after 30 days, and a name copied into this
table would survive that. Joining `users` shows whatever the account is
called now.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: The longest note accepted, in characters. A few paragraphs.
FEEDBACK_MAX_LENGTH = 2000

#: Notes one member may send per hour, counted from saved rows.
FEEDBACK_PER_HOUR = 20


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    #: The screen the member was on, e.g. "/video/12". Helps reproduce it.
    page: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    def __repr__(self) -> str:
        return f"<Feedback {self.id} by {self.user_id}>"
