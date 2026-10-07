"""Chat API schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.chat import ChatAction, ChatMessageStatus, ChatRole

#: The longest single message a member may send, in characters. Well
#: inside the context limit, so one message never crowds out the history.
MAX_MESSAGE_LENGTH = 8000


class ConversationCreate(BaseModel):
    title: str = Field(default="", max_length=100)
    #: A catalogue model's `id`. Omitted means the default.
    chat_model_id: int | None = None


class ConversationUpdate(BaseModel):
    """Rename, change the model, or both. At least one must be sent."""

    title: str | None = Field(default=None, max_length=100)
    #: Affects later replies only; each reply keeps the model that wrote it.
    chat_model_id: int | None = None


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    created_at: datetime
    last_message_at: datetime
    #: The catalogue model the next reply uses. None means the default.
    chat_model_id: int | None = None


class ChatMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: ChatRole
    content: str
    status: ChatMessageStatus
    action: ChatAction | None = None
    action_title: str = ""
    #: For a reply: the provider's model id that wrote it.
    model_id: str | None = None
    created_at: datetime


class ConversationDetail(ConversationRead):
    messages: list[ChatMessageRead]


class ChatMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)


class ChatModelOption(BaseModel):
    """One entry in the Chat model picker."""

    id: int
    model_id: str
    label: str
    description: str
    #: Only admins see admin-only models; the picker marks them.
    admin_only: bool
    is_default: bool
    #: "답장 1회 약 N원" — see `pricing.TYPICAL_INPUT_TOKENS`. None without a rate.
    estimated_reply_krw: int | None


class ChatInfo(BaseModel):
    """What the Chat screen needs to know about how replies are made.

    Never the key. The models carry their estimated cost per reply in
    won — what a member needs to choose — but not the dollar prices.
    """

    #: True while CLAUDE_PROVIDER is mock — the screen says 테스트 모드.
    is_mock: bool
    rate_limit_per_minute: int
    max_message_length: int
    #: The models this member may pick, in catalogue order.
    models: list["ChatModelOption"] = []
    #: What a new conversation uses. None only with an empty catalogue.
    default_model_id: int | None = None
