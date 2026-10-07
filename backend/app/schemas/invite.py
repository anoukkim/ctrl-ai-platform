"""Admin › Members › 초대 코드."""

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.invite import InviteStatus


class InviteCreate(BaseModel):
    #: Empty means "generate a readable one".
    code: str = Field(default="", max_length=40)
    label: str = Field(default="", max_length=100)
    max_uses: int = Field(default=1, ge=1, le=1000)
    expires_at: datetime | None = None


class InviteSignup(BaseModel):
    user_id: int
    username: str
    display_name: str
    signed_up_at: datetime


class InviteRead(BaseModel):
    id: int
    code: str
    label: str
    max_uses: int
    uses: int
    expires_at: datetime | None
    is_active: bool
    status: InviteStatus
    created_by_username: str
    created_at: datetime
    signups: list[InviteSignup]
