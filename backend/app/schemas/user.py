"""User API schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.user import UserRole


class UserRead(BaseModel):
    """A user as returned by the API."""

    # Lets Pydantic read values off a SQLAlchemy object's attributes
    # rather than requiring a dictionary.
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    display_name: str
    role: UserRole
    is_active: bool
    created_at: datetime
    updated_at: datetime
