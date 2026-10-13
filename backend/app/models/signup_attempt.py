"""One sign-up attempt, for the per-address limits (invite-only-signup).

Counted in the database rather than in memory: the server runs two API
workers (`WEB_CONCURRENCY=2`), and a count kept in one process's memory
would let each worker allow the full limit. Rows older than a day are
deleted as new ones arrive, so the table stays small.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LoginAttempt(Base):
    """A failed password sign-in, for the per-address and per-username limit.

    Password sign-in is the administrator's emergency door (google-login);
    an unlimited one invites guessing. Only failures are recorded.
    """

    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    address: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    #: Lower-cased, so Admin and admin count together.
    username: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class SignupAttempt(Base):
    __tablename__ = "signup_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: The client address (`services/rate_limit.client_address`).
    address: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    #: The invite code was missing or unusable.
    failed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
