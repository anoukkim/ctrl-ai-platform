"""feat-notifications — what the browser reads of a member's notifications."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    title: str
    body: str
    link: str | None
    created_at: datetime
    read_at: datetime | None


class NotificationList(BaseModel):
    items: list[NotificationRead]
    unread: int


class UnreadRead(BaseModel):
    unread: int


class EmptyBody(BaseModel):
    """A POST that needs no fields still needs a JSON body (CLAUDE.md §2)."""
