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
    """Rename, change the model, the tool toggles — at least one."""

    title: str | None = Field(default=None, max_length=100)
    #: Affects later replies only; each reply keeps the model that wrote it.
    chat_model_id: int | None = None
    #: Server tools (chat-plus-tools), per conversation. Turning one on is
    #: refused when the conversation's model does not allow it.
    use_web_search: bool | None = None
    use_web_fetch: bool | None = None
    use_code_execution: bool | None = None


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    created_at: datetime
    last_message_at: datetime
    #: The catalogue model the next reply uses. None means the default.
    chat_model_id: int | None = None
    #: The member's tool toggles (chat-plus-tools). A tool still runs only
    #: when the model allows it too.
    use_web_search: bool = False
    use_web_fetch: bool = False
    use_code_execution: bool = False


class ReplyReceipt(BaseModel):
    """One reply's ledger figures (live-cost-display).

    Straight from the reply's usage event: the cache fields are None when
    caching was off, and `charged_krw` is what actually left the wallet —
    the receipt replaces the running estimate, never restates it.
    """

    input_tokens: int
    output_tokens: int
    cache_write_tokens: int | None = None
    cache_read_tokens: int | None = None
    #: Billed web searches and their fee (chat-plus-tools); 0 = no line.
    web_search_count: int = 0
    tool_fee_krw: int = 0
    charged_krw: int


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
    #: Set when the reply stopped at the per-reply cost cap (token-guard):
    #: the cap in force, in won. Null for every other ending.
    capped_krw: int | None = None
    #: Web-search sources the reply cited (chat-plus-tools), in order.
    sources: list["SourceRead"] | None = None
    #: The reply's receipt, filled from its usage event when the
    #: conversation is read (live-cost-display). Not a column: while a
    #: reply streams, the receipt arrives on the `done` event instead.
    receipt: ReplyReceipt | None = None
    created_at: datetime


class LongHistoryRead(BaseModel):
    """The composer's long-conversation warning (token-guard, point 4)."""

    #: Input tokens a reply carries beyond the system prompt.
    history_tokens: int
    #: What that adds to one reply — and what a new conversation saves.
    extra_krw: int


class ConversationDetail(ConversationRead):
    messages: list[ChatMessageRead]
    #: Present while the history is long enough to warrant the warning.
    long_history: LongHistoryRead | None = None


class SourceRead(BaseModel):
    """One cited source — shown as a numbered link with its domain."""

    title: str = ""
    url: str


class ChatMessageCreate(BaseModel):
    #: `extra="forbid"`: a member can send text and nothing else. In
    #: particular no file or container ids — Anthropic file ids are
    #: workspace-wide, so accepting one would open other members' files
    #: (chat-plus-tools).
    model_config = ConfigDict(extra="forbid")

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
    #: "답장 1회 약 N원". None without a rate.
    estimated_reply_krw: int | None
    #: "recent" — the median of this model's recent real replies
    #: (cost-calibration); "formula" — `pricing.TYPICAL_INPUT_TOKENS` and
    #: `TYPICAL_OUTPUT_TOKENS` at list price, until there are enough.
    estimate_basis: str = "formula"
    estimate_samples: int = 0
    #: Which server tools the admin opened on this model, and what one
    #: web search costs in won — the member's toggle shows it first.
    tools_web_search: bool = False
    tools_web_fetch: bool = False
    tools_code_execution: bool = False
    web_search_krw_per_call: int | None = None


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
