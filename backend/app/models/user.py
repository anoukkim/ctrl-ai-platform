"""User model, role and account status enumerations."""

import enum

from sqlalchemy import Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, status_enum


class AccountStatus(str, enum.Enum):
    """Whether an account may use the platform at all.

    This replaces the Phase 0 `is_active` boolean, which could only say
    yes or no. A boolean has no room for "left the community", and that
    distinction matters: a former member keeps their name on everything
    they published, so the account is never deleted.

    Phase 1b extends this with the participation rules — an inactive or
    former member must lose access to paid creation features. Phase 1a
    only establishes the field and blocks sign-in for anything that is
    not `active`.
    """

    ACTIVE = "active"
    INACTIVE = "inactive"
    FORMER = "former"


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

    `username` and `email` are both unique: a member signs in with their
    username, and the email is how they are reached. `password_hash` is
    an Argon2 hash and is never exposed — no response schema includes it.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    # Never returned by the API. `UserRead` and every other response
    # schema omit it, which is why models and schemas are kept apart.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
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
    account_status: Mapped[AccountStatus] = mapped_column(
        status_enum(AccountStatus, "account_status"),
        default=AccountStatus.ACTIVE,
        nullable=False,
    )

    @property
    def can_sign_in(self) -> bool:
        """Only an active account may hold a session."""
        return self.account_status is AccountStatus.ACTIVE

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r} role={self.role.value}>"
