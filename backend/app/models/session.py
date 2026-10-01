"""Server-side login sessions.

Sessions are rows, not self-contained tokens. The cookie carries an
opaque random string and nothing else; everything about the session —
who it belongs to and when it expires — is looked up here.

That costs one query per request and buys real logout: deleting the row
ends the session immediately. A signed stateless token cannot be revoked
before it expires, which is the wrong trade for an application that can
mark a member `former` and needs that to take effect at once.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class UserSession(Base):
    """One signed-in browser."""

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Indexed and unique: every authenticated request looks a session up
    # by this value.
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    # Deleting a member deletes their sessions with them.
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["object"] = relationship("User", lazy="joined")

    def __repr__(self) -> str:
        return f"<UserSession user_id={self.user_id} expires_at={self.expires_at}>"
