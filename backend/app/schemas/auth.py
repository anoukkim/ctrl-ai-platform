"""Request and response shapes for authentication.

None of these carry `password_hash`. Response models are built from an
explicit field list rather than from the ORM object wholesale, so a
column added to `User` later cannot leak into an API response by default.
"""

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.security import MIN_PASSWORD_LENGTH
from app.models.user import AccountStatus, UserRole

USERNAME_PATTERN = r"^[a-zA-Z0-9_]+$"


class RegisterRequest(BaseModel):
    """Sign-up form.

    The username is restricted to letters, digits and underscore so it can
    appear in a URL and be typed without ambiguity.
    """

    username: str = Field(min_length=3, max_length=50, pattern=USERNAME_PATTERN)
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)
    display_name: str = Field(min_length=1, max_length=100)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)


class CurrentUser(BaseModel):
    """The signed-in member, as the frontend needs them.

    `is_admin` is derived here rather than making the browser compare role
    strings. It decides what the sidebar shows — but never what the API
    allows, which is checked again on every admin route.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: EmailStr
    display_name: str
    role: UserRole
    account_status: AccountStatus
    is_admin: bool
