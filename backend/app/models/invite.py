"""Invite codes (invite-only-signup).

The site address is public — the repository is — but CTRL+AI is for club
members only, so signing up needs a code an admin handed out. There is no
approval queue: a valid code creates a usable account at once, and joining
a quarter still goes through the normal application.

A code is stored **normalised** (trimmed, upper case), so members can type
it in any case. `uses` is only ever raised by one conditional `UPDATE`
(`services/invites.claim`), which is what stops two people taking the last
use of a code at the same moment.

Codes are never deleted — `is_active` turns one off — so every account
keeps a pointer to the code it signed up with (`User.invite_code_id`).
"""

import enum
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class InviteStatus(str, enum.Enum):
    """What the admin list shows. Derived, never stored."""

    USABLE = "usable"  # 사용 가능
    EXPIRED = "expired"  # 만료
    EXHAUSTED = "exhausted"  # 소진
    DISABLED = "disabled"  # 중지


class InviteCode(TimestampMixin, Base):
    __tablename__ = "invite_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Upper case, trimmed. What members type, in any case.
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    #: What the code was for, e.g. "2026 Q4 공지용". Admin-only.
    label: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    #: 1 for a single-use code.
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False)
    uses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    #: None means it never expires.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    def status(self, now: datetime | None = None) -> InviteStatus:
        """중지 before 만료 before 소진: the admin's own switch says the most."""
        now = now or datetime.now(timezone.utc)
        if not self.is_active:
            return InviteStatus.DISABLED
        expires = self.expires_at
        if expires is not None:
            if expires.tzinfo is None:  # SQLite hands back naive datetimes
                expires = expires.replace(tzinfo=timezone.utc)
            if expires <= now:
                return InviteStatus.EXPIRED
        if self.uses >= self.max_uses:
            return InviteStatus.EXHAUSTED
        return InviteStatus.USABLE

    def __repr__(self) -> str:
        return f"<InviteCode {self.code} {self.uses}/{self.max_uses}>"
