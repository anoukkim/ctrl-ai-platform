"""SQLAlchemy declarative base and shared column mixins."""

from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base class every database model inherits from.

    SQLAlchemy collects the table definitions of all subclasses on
    `Base.metadata`, which is what creates the tables.
    """


class TimestampMixin:
    """Adds audit timestamps to a model.

    `server_default=func.now()` means PostgreSQL fills the value in, so
    the timestamps are correct even for rows inserted outside this app.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
