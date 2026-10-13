"""Feedback from the 의견 보내기 button, and Admin's list of it."""

from datetime import datetime

from pydantic import BaseModel


class FeedbackCreate(BaseModel):
    # Plain strings: the route checks the length itself and answers in
    # Korean. A schema limit would answer 422 with a list-shaped detail
    # the frontend cannot show.
    body: str
    page: str = ""


class FeedbackRead(BaseModel):
    id: int
    body: str
    page: str
    created_at: datetime


class FeedbackAdminRead(FeedbackRead):
    user_id: int | None
    username: str | None
    display_name: str | None
