"""Chat API schemas."""

from datetime import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.chat import AttachmentKind, ChatAction, ChatMessageStatus, ChatRole

#: The longest single message a member may send, in characters. Well
#: inside the context limit, so one message never crowds out the history.
MAX_MESSAGE_LENGTH = 8000


class ConversationCreate(BaseModel):
    title: str = Field(default="", max_length=100)
    #: A catalogue model's `id`. Omitted means the default.
    chat_model_id: int | None = None
    #: fix-new-chat-tools: what the member chose on the welcome screen,
    #: before the first message — the same rules as PATCH (a tool the
    #: model does not allow is refused).
    use_web_search: bool = False
    use_web_fetch: bool = False
    use_code_execution: bool = False
    show_thinking: bool = False
    #: 생각 깊이 (quality-tuning Q1): a level **name** only — "low",
    #: "medium", "high" or "max". The server decides every number.
    depth: Literal["low", "medium", "high", "max"] | None = None


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
    #: 생각 과정 보기 (chat-thinking-view): later replies only.
    show_thinking: bool | None = None
    #: 생각 깊이 (quality-tuning Q1): a level **name** only — "low",
    #: "medium", "high" or "max". The server decides every number.
    depth: Literal["low", "medium", "high", "max"] | None = None


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
    #: 생각 과정 보기 (chat-thinking-view).
    show_thinking: bool = False
    #: 생각 깊이 (quality-tuning Q1). None: the member's default.
    depth: str | None = None


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
    # The same reply in won, by part (cost-clarity): unrounded, so they
    # may add up to a little less than `charged_krw`, which is rounded up
    # once. `cache_saved_krw` is what the cache reads would have cost as
    # plain input, minus what they did. None on a receipt with no split.
    input_krw: float | None = None
    cache_write_krw: float | None = None
    cache_read_krw: float | None = None
    output_krw: float | None = None
    tool_krw: float | None = None
    cache_saved_krw: float | None = None
    #: The split was re-priced from today's catalogue (an old reply).
    split_estimated: bool = False
    #: Written with 생각 과정 보기 on: the output includes the thinking.
    thinking_shown: bool = False


class AttachmentRead(BaseModel):
    """A file attached to a message (chat-plus-files). Never its bytes."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    kind: AttachmentKind
    name: str = Field(validation_alias="original_name")
    size: int = Field(validation_alias="stored_size")
    media_type: str
    page_count: int | None = None
    width: int | None = None
    height: int | None = None
    #: The figure the composer's estimate and the budget pre-check use.
    estimated_tokens: int
    #: None until the message carrying it is sent.
    message_id: int | None = None


class AttachmentEstimate(BaseModel):
    """What the files waiting in the composer add, for the conversation's model."""

    #: Estimated input tokens of the files not yet sent.
    tokens: int
    #: "첨부 포함 답장 1회 약 N원" — the usual reply plus the files. None without a rate.
    with_files_krw: int | None
    #: "이어지는 답장마다 약 M원씩 더" — the files resent with each later reply.
    each_later_krw: int | None


class AttachmentUploaded(BaseModel):
    attachment: AttachmentRead
    estimate: AttachmentEstimate


class ChatMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: ChatRole
    content: str
    status: ChatMessageStatus
    action: ChatAction | None = None
    action_title: str = ""
    #: For a reply: the provider's model id that wrote it, and the 생각 깊이
    #: it ran at (None: the model has none) — the receipt shows both.
    model_id: str | None = None
    depth: str | None = None
    #: Set when the reply stopped at the per-reply cost cap (token-guard):
    #: the cap in force, in won. Null for every other ending.
    capped_krw: int | None = None
    #: Web-search sources the reply cited (chat-plus-tools), in order.
    sources: list["SourceRead"] | None = None
    #: Claude's summarized thinking (chat-thinking-view). Display only.
    thinking: str | None = None
    #: The reply's receipt, filled from its usage event when the
    #: conversation is read (live-cost-display). Not a column: while a
    #: reply streams, the receipt arrives on the `done` event instead.
    receipt: ReplyReceipt | None = None
    created_at: datetime
    attachments: list[AttachmentRead] = []


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
    """One source — shown as a numbered link with its page title."""

    title: str = ""
    url: str
    #: The reply's text cites it (fix-real-web-search) — cited ones first.
    cited: bool = False


class ChatMessageCreate(BaseModel):
    #: `extra="forbid"`: a member can send text and their own uploaded
    #: attachments, nothing else. In particular no file or container ids —
    #: Anthropic file ids are workspace-wide, so accepting one would open
    #: other members' files (chat-plus-tools).
    model_config = ConfigDict(extra="forbid")

    #: May be empty when files are attached; the route says so if both are.
    content: str = Field(default="", max_length=MAX_MESSAGE_LENGTH)
    #: Files uploaded to this conversation and not sent yet (chat-plus-files).
    attachment_ids: list[int] = Field(default_factory=list, max_length=5)


class DepthOption(BaseModel):
    """One step of the 생각 깊이 slider for one model (quality-tuning Q1)."""

    level: str
    label: str
    hint: str
    #: "1회 약 N원" at this depth — an estimate (None without a rate).
    estimate_krw: int | None
    #: "(최대 M원)" — the cap this depth runs under.
    max_krw: int


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
    #: The 도구 panel's other prices (fix-composer-toolbar): one page read
    #: and one code run at typical sizes, in won. None without a rate.
    web_fetch_krw_per_use: int | None = None
    code_execution_krw_per_use: int | None = None
    #: 생각 과정 보기's "+약 N원" (chat-thinking-view): 0 = 추가 비용 없음
    #: (Opus thinks anyway), None without a rate. Basis as above.
    thinking_extra_krw: int | None = None
    thinking_basis: str = "formula"
    #: 생각 깊이 steps this model offers, in order. Empty: the model has no
    #: effort parameter — "이 모델은 깊이 조절이 없어요", and none is sent.
    levels: list[DepthOption] = []
    #: What runs when it has none: 보통's room and cap.
    flat_max_krw: int | None = None
    #: One line when a depth needs thinking on (Sonnet 5.5 at 최고).
    depth_note: str = ""


class ChatInfo(BaseModel):
    """What the Chat screen needs to know about how replies are made.

    Never the key. The models carry their estimated cost per reply in
    won — what a member needs to choose — but not the dollar prices.
    """

    #: True while CLAUDE_PROVIDER is mock — the screen says 테스트 모드.
    is_mock: bool
    rate_limit_per_minute: int
    max_message_length: int
    #: 웹 페이지 읽기 bounds (tool-cap-defaults) — quoted in the member's
    #: toggle dialog, so the copy never hardcodes an amount.
    web_fetch_max_uses: int
    web_fetch_max_content_tokens: int
    #: 웹 검색: searches per reply (fix-real-web-search) — same reason.
    web_search_max_uses: int = 5
    #: The models this member may pick, in catalogue order.
    models: list["ChatModelOption"] = []
    #: What a new conversation uses. None only with an empty catalogue.
    default_model_id: int | None = None
    #: The member's own default (Profile › 기본 모델, quality-tuning Q1):
    #: model and depth a new conversation starts with.
    member_default_model_id: int | None = None
    member_default_depth: str = "medium"
