"""Request and response shapes for authentication.

None of these carry `password_hash`. Response models are built from an
explicit field list rather than from the ORM object wholesale, so a
column added to `User` later cannot leak into an API response by default.

There is no sign-up request here: since signup-google-first (2026-11-03)
an account is only made on the Google setup screen (`routes/google_auth.py`).
"""

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from app.models.user import AccountStatus, UserRole

#: The username rule — letters, digits and underscore, so it can appear in
#: a URL and be typed without ambiguity. Checked on the Google setup screen.
USERNAME_PATTERN = r"^[a-zA-Z0-9_]+$"


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
    #: False for an account that has no password yet (a Google member from
    #: before signup-google-first, or one that removed it): screens that
    #: re-check one ask for something else, and the sign-in-method notice
    #: shows until both methods exist.
    has_password: bool = True
    #: Whether a Google account is linked (signup-google-first). With
    #: `has_password`, this decides the "로그인 방법을 하나 더" notice.
    has_google: bool = False
    #: Profile › 알림 › 사용 알림 표시 (feat-spend-feedback).
    spend_notifications: bool = True
