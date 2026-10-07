"""Chat conversations and their messages (Phase 2).

A member's conversations are **private** and belong to them alone: every
route scopes its query by the signed-in member, and nobody else — admins
included — reads them through the API.

Two decisions worth knowing:

* **Deleting a conversation is a real delete**, not the soft delete used
  for projects and videos. Deleted Items exists to give back *work*; a
  chat is private conversation, and keeping it after the member asked for
  it to go would only mislead them. The money it spent is not lost: each
  `UsageEvent` keeps its figures, and its `conversation_id` is set to
  NULL.
* **Only text is stored.** Claude's thinking blocks are never kept or sent
  back. Each request is rebuilt from the stored text, so trimming the
  oldest messages to fit the context limit never edits a block Claude
  produced — which current models reject.
"""

import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, status_enum


class ChatRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"


class ChatMessageStatus(str, enum.Enum):
    """How an assistant reply ended. A member's own message is always `complete`."""

    COMPLETE = "complete"
    #: The member pressed 중지. The text so far is kept, and charged.
    STOPPED = "stopped"
    #: The reply reached the output limit and was cut off.
    TRUNCATED = "truncated"
    #: Claude declined to answer.
    REFUSED = "refused"


class ChatAction(str, enum.Enum):
    """The button a reply offers. Chosen by the reply, opened by the member."""

    BUILDER = "builder"
    VIDEO = "video"


class Conversation(TimestampMixin, Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: Empty until the first message names it; the member can rename it.
    title: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    #: When the last message was written — what the list is sorted by.
    #: Renaming changes `updated_at` but should not move a conversation up.
    last_message_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    #: The catalogue model this conversation's *next* reply uses. Set to the
    #: default when the conversation is created; the member may change it,
    #: which affects later replies only — each reply records its own model
    #: in `ChatMessage.model_id`. NULL (a conversation from before
    #: chat-model-choice, or a model since removed) means the default.
    chat_model_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_models.id", ondelete="SET NULL"), nullable=True
    )

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="conversation",
        # Deleted by the ORM rather than left to ON DELETE CASCADE, so the
        # behaviour does not depend on the database enforcing foreign keys.
        cascade="all, delete-orphan",
        order_by="ChatMessage.id",
    )

    def __repr__(self) -> str:
        return f"<Conversation {self.id} user={self.user_id}>"


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: Denormalised from the conversation so the per-member rate limit is
    #: one indexed count, not a join.
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[ChatRole] = mapped_column(status_enum(ChatRole, "chatrole"), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[ChatMessageStatus] = mapped_column(
        status_enum(ChatMessageStatus, "chatmessagestatus"),
        default=ChatMessageStatus.COMPLETE,
        nullable=False,
    )

    #: The action button the reply offers, if any, and the project name
    #: it suggests. The idea itself is the member's message before it.
    action: Mapped[ChatAction | None] = mapped_column(
        status_enum(ChatAction, "chataction"), nullable=True
    )
    action_title: Mapped[str] = mapped_column(String(100), default="", nullable=False)

    #: For an assistant reply: the catalogue model that wrote it (the
    #: provider's id, e.g. "claude-haiku-4-5" — also under the mock, which
    #: is priced as the model chosen) and what it cost.
    model_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    usage_event_id: Mapped[int | None] = mapped_column(
        ForeignKey("usage_events.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    conversation: Mapped[Conversation] = relationship(back_populates="messages")

    def __repr__(self) -> str:
        return f"<ChatMessage {self.id} {self.role.value}>"
