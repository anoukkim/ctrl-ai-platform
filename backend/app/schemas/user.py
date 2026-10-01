"""User API schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.user import AccountStatus, UserRole


class UserRead(BaseModel):
    """A user as returned by the API.

    `password_hash` is deliberately absent. Listing the fields explicitly,
    rather than serialising the ORM object wholesale, is what guarantees a
    credential column added later cannot appear in a response by accident.
    """

    # Lets Pydantic read values off a SQLAlchemy object's attributes
    # rather than requiring a dictionary.
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: EmailStr
    display_name: str
    role: UserRole
    account_status: AccountStatus
    created_at: datetime
    updated_at: datetime
