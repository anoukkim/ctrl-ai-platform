"""User model and role enumeration."""

import enum

from sqlalchemy import Boolean, Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class UserRole(str, enum.Enum):
    """Ctrl AI system roles.

    Only two roles exist. "Developer" is deliberately NOT a role: any
    active member may build a project, and a member becomes the
    developer of an app through ownership rather than through a role.

    Inheriting from `str` means the value behaves like the plain string
    "admin" in JSON responses and comparisons.
    """

    ADMIN = "admin"
    MEMBER = "member"


class User(TimestampMixin, Base):
    """A Ctrl AI member.

    Phase 0 deliberately contains no password or credential columns.
    Accounts, seasons and seasonal membership status (active / inactive /
    former) are Phase 1, and are shown as mock data in the UI until then.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        # `native_enum=False` stores the role as VARCHAR with a CHECK
        # constraint instead of a PostgreSQL ENUM type. Adding a role later
        # is then an ordinary migration rather than an ALTER TYPE, and the
        # same model works on SQLite in tests. `create_constraint=True` is
        # required because SQLAlchemy omits the CHECK constraint by default.
        Enum(
            UserRole,
            native_enum=False,
            create_constraint=True,
            length=20,
            values_callable=lambda enum: [member.value for member in enum],
        ),
        default=UserRole.MEMBER,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r} role={self.role.value}>"
