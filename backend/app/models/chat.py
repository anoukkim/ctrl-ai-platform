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

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, false, func
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
    #: 생각 깊이 (quality-tuning Q1): "low" | "medium" | "high" | "max", or
    #: NULL for the default. The server turns it into effort, max_tokens and
    #: a cap (`services/depth.py`); the client never sends numbers.
    depth: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Anthropic server tools (chat-plus-tools), chosen per conversation —
    # not per message, because changing the tool list breaks the prompt
    # cache. A tool is only *sent* when the conversation's model also
    # allows it; these flags survive a model switch unchanged.
    use_web_search: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    use_web_fetch: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    use_code_execution: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    #: 생각 과정 보기 (chat-thinking-view): show Claude's summarized
    #: thinking under each later reply. Off by default — it costs more on
    #: Sonnet and Haiku. Per conversation, like the tools, because the
    #: thinking configuration is part of the cached prompt.
    show_thinking: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
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
    #: The 생각 깊이 the reply ran at (None: the model has none).
    depth: Mapped[str | None] = mapped_column(String(10), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Set when the reply stopped at the per-reply cost cap (token-guard):
    #: the cap in force, in won, so the screen can say why — after a
    #: reload too. Null for every other ending, including the global
    #: output limit.
    capped_krw: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Web-search sources the reply cited (chat-plus-tools):
    #: [{"title": str, "url": str}, ...]. Null when no tool ran.
    #: Claude's summarized thinking for a reply written with 생각 과정 보기
    #: on (chat-thinking-view). Display only — it is never sent back to
    #: the model; history stays text (preserved-thinking rules).
    thinking: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list | None] = mapped_column(JSON, nullable=True)
    usage_event_id: Mapped[int | None] = mapped_column(
        ForeignKey("usage_events.id", ondelete="SET NULL"), nullable=True
    )
    #: feat-auto-continue: a reply the server wrote in several calls lists
    #: every call's usage event here, in order (the first is also
    #: `usage_event_id`; a call the ledger never saw — a failed one — is a
    #: null entry, so the count stays right); the receipt adds the rows
    #: up. Null for a one-call reply.
    segment_event_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    #: Why the server stopped continuing (the ceiling, the wallet, a failed
    #: call) — the Korean sentence the screen shows, after a reload too.
    stop_note: Mapped[str | None] = mapped_column(String(300), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    conversation: Mapped[Conversation] = relationship(back_populates="messages")

    @property
    def segments(self) -> int:
        """How many calls wrote this reply (feat-auto-continue)."""
        return len(self.segment_event_ids) if self.segment_event_ids else 1

    #: Files sent with this message (chat-plus-files). Read-only here: rows
    #: are created by the upload route and deleted with the conversation.
    attachments: Mapped[list["ChatAttachment"]] = relationship(
        viewonly=True, order_by="ChatAttachment.id", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<ChatMessage {self.id} {self.role.value}>"


class AttachmentKind(str, enum.Enum):
    """What a chat attachment is, decided from its bytes (chat-plus-files)."""

    IMAGE = "image"
    PDF = "pdf"
    CSV = "csv"
    TEXT = "text"


class ChatAttachment(Base):
    """A file a member attached to a chat message (chat-plus-files).

    Uploaded before the message is sent: `message_id` is NULL until the
    message that carries it is saved, and such a row can still be removed
    with ✕. The bytes live in storage under `storage_key`
    (`chat/<user_id>/<conversation_id>/<id>`); images are the re-encoded
    copy (EXIF gone), everything else the bytes as uploaded.

    Private like the conversation: every route scopes by the owner, and
    another member's attachment is a 404. Deleting the conversation
    deletes the rows and the bytes; so does withdrawal anonymisation.
    """

    __tablename__ = "chat_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    message_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_messages.id", ondelete="CASCADE"), index=True, nullable=True
    )
    kind: Mapped[AttachmentKind] = mapped_column(
        status_enum(AttachmentKind, "attachmentkind"), nullable=False
    )
    #: The stored copy's media type (an image may have been re-encoded).
    media_type: Mapped[str] = mapped_column(String(80), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_size: Mapped[int] = mapped_column(Integer, nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: The same figure the browser shows and the budget pre-check adds.
    estimated_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<ChatAttachment {self.id} {self.kind.value}>"
