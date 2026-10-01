"""SQLAlchemy declarative base and shared column mixins."""

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, func
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


def status_enum(enum_type: type[enum.Enum], name: str) -> Enum:
    """Store an enum as VARCHAR with a CHECK constraint.

    A native PostgreSQL ENUM would turn "add one more value" into an
    ALTER TYPE; this way it stays an ordinary migration, and the same
    model still works on SQLite in the tests.

    Note for migrations: the Enum column renders its own CHECK constraint,
    so Alembic's autogenerate also reflecting one produces a duplicate that
    PostgreSQL rejects. Drop the reflected `sa.CheckConstraint` lines from
    a generated migration and let the column type emit them.
    """
    return Enum(
        enum_type,
        name=name,
        native_enum=False,
        create_constraint=True,
        # 20 is enough for every value in use ('application_open' is the
        # longest at 16) and matches the existing columns, so widening it
        # does not make Alembic rewrite tables that are already correct.
        length=20,
        values_callable=lambda e: [member.value for member in e],
    )
