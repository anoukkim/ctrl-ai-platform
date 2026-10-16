"""Feedback from the 의견 보내기 button, and Admin's list of it."""

from datetime import datetime

from pydantic import BaseModel, Field


class FeedbackCreate(BaseModel):
    # Plain strings: the route checks the length itself and answers in
    # Korean. A schema limit would answer 422 with a list-shaped detail
    # the frontend cannot show.
    body: str
    page: str = ""
    #: Screenshots uploaded first (`POST /feedback/images`), by id.
    image_ids: list[int] = Field(default_factory=list)


class FeedbackImageRead(BaseModel):
    id: int
    name: str
    size: int
    width: int
    height: int
    media_type: str


class FeedbackRead(BaseModel):
    id: int
    body: str
    page: str
    created_at: datetime
    images: list[FeedbackImageRead] = Field(default_factory=list)


class FeedbackAdminRead(FeedbackRead):
    user_id: int | None
    username: str | None
    display_name: str | None
