"""Chat API schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.chat import ChatAction, ChatMessageStatus, ChatRole

#: The longest single message a member may send, in characters. Well
#: inside the context limit, so one message never crowds out the history.
MAX_MESSAGE_LENGTH = 8000


class ConversationCreate(BaseModel):
    title: str = Field(default="", max_length=100)


class ConversationUpdate(BaseModel):
    title: str = Field(max_length=100)


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    created_at: datetime
    last_message_at: datetime


class ChatMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: ChatRole
    content: str
    status: ChatMessageStatus
    action: ChatAction | None = None
    action_title: str = ""
    created_at: datetime


class ConversationDetail(ConversationRead):
    messages: list[ChatMessageRead]


class ChatMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)


class ChatInfo(BaseModel):
    """What the Chat screen needs to know about how replies are made.

    Never the key, and never the model's price: the screen says whether
    replies are real or a test, and how fast a member may send.
    """

    #: True while CLAUDE_PROVIDER is mock — the screen says 테스트 모드.
    is_mock: bool
    rate_limit_per_minute: int
    max_message_length: int
