"""Chat: conversations, one member message at a time, and what it costs.

A message goes through two steps, and the split is the important part:

1. **`prepare_turn`** — before Claude is called. Checks the per-member
   rate limit, prices the call at the conversation's model (see
   `services/chat_models.py`), trims the history to the context limit,
   and checks the member's wallet against the **worst case** (the trimmed
   input, priced as a cache write when caching is on, plus the maximum
   reply). Anything refused here costs nothing,
   because nothing has been sent. Only then is the member's message saved.
2. **`finish_turn`** — after the stream ends, however it ends. Charges
   the tokens actually used and saves the reply, in one transaction.

How a stream ends decides what happens:

| Ending | Reply saved | Charged |
| ------ | ----------- | ------- |
| finished, or cut off at the output limit | yes | the tokens used |
| the member pressed 중지 | the text so far | the tokens used so far |
| Claude declined | a refusal notice | the tokens used |
| an error | no | **nothing** — a failed call is never charged |

A stopped reply is charged because Claude has already produced — and the
club has already paid for — those tokens; only a *failure* is free.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import (
    ChatAction,
    ChatAttachment,
    ChatMessage,
    ChatMessageStatus,
    ChatRole,
    Conversation,
    FundingSource,
    ProviderErrorKind,
    UsageFeature,
    User,
)
from app.services import depth as depth_service
from app.services import attachments as attachments_service
from app.services import accounting, calibration, chat_limits, chat_tools, pricing, providers
from app.services import usage as usage_service
from app.services import chat_models as chat_models_service
from app.services.chat_models import ChosenModel
from app.services.claude_provider import (
    CHAT_SYSTEM_PROMPT,
    ChatRequest,
    ClaudeError,
    short_title,
)
from app.services.pricing import Price, estimate_tokens

#: Per-message overhead in the token estimate (role markers and the like).
_MESSAGE_OVERHEAD = 4

#: The longest title a conversation gets from its first message.
TITLE_LENGTH = 40


class ChatRefusal(Exception):
    """Refused before Claude was called. Korean message, HTTP status attached."""

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


# ------------------------------------------------------------- the marker

#: How a reply asks for an action button. See `CHAT_SYSTEM_PROMPT`. The
#: title is capped so the streaming filter (`_MARKER_LONGEST`) and the saved
#: reply always agree on what is a marker.
ACTION_MARKER = re.compile(r"\[\[action:(builder|video)(?:\|([^\]\n]{0,140}))?\]\]")


#: The start every marker shares, and the most a marker's title may run to
#: before the held text is let go as ordinary text.
_MARKER_START = "[[action:"
_MARKER_REST = re.compile(
    r"(b(u(i(l(d(er?)?)?)?)?)?|v(i(d(eo?)?)?)?)?|(builder|video)(\|[^\]\n]*)?\]?"
)
_MARKER_LONGEST = 160


def _could_become_marker(text: str) -> bool:
    """Whether `text` (starting with "[") may still turn into a marker."""
    if len(text) <= len(_MARKER_START):
        return _MARKER_START.startswith(text)
    if not text.startswith(_MARKER_START) or len(text) > _MARKER_LONGEST:
        return False
    return _MARKER_REST.fullmatch(text[len(_MARKER_START) :]) is not None


class MarkerFilter:
    """Keeps the action marker out of what the member sees, while streaming.

    The marker arrives in pieces like everything else, so the screen would
    otherwise show "[[act" for a moment. Text from a `[` is held back only
    while it can still become `[[action:…]]`; the moment it cannot — a
    Markdown link `[문서](…)`, `[[1, 2]]` in code, a line break, or more
    than a title's length — it is let go. A complete marker is dropped.
    (chat-plus-rendering: replies are Markdown now, so `[` is common, and
    holding everything after the first one froze the reply until the end.)
    """

    def __init__(self) -> None:
        self._held = ""
        self.raw = ""

    def feed(self, text: str) -> str:
        self.raw += text
        buffer = self._held + text
        self._held = ""
        shown: list[str] = []
        while buffer:
            start = buffer.find("[")
            if start == -1:
                shown.append(buffer)
                break
            shown.append(buffer[:start])
            buffer = buffer[start:]
            match = ACTION_MARKER.match(buffer)
            if match:
                buffer = buffer[match.end() :]
                continue
            if _could_become_marker(buffer):
                self._held = buffer
                break
            shown.append("[")
            buffer = buffer[1:]
        return "".join(shown)

    def finish(self) -> str:
        """Whatever was still held back at the end — never a whole marker."""
        rest = ACTION_MARKER.sub("", self._held)
        self._held = ""
        return rest


def action_of(raw: str) -> tuple[ChatAction | None, str]:
    """The action button a full reply asked for, and its suggested title."""
    match = ACTION_MARKER.search(raw)
    if match is None:
        return None, ""
    return ChatAction(match.group(1)), (match.group(2) or "").strip()[:100]


def visible_text(raw: str) -> str:
    """The full reply as the member sees it — marker removed, edges trimmed."""
    return ACTION_MARKER.sub("", raw).strip()


# ------------------------------------------------------------- conversations


def owned_conversation(db: Session, user: User, conversation_id: int) -> Conversation | None:
    """The member's own conversation, or None — never someone else's."""
    return db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id, Conversation.user_id == user.id
        )
    )


def list_conversations(db: Session, user: User) -> list[Conversation]:
    return list(
        db.scalars(
            select(Conversation)
            .where(Conversation.user_id == user.id)
            .order_by(Conversation.last_message_at.desc(), Conversation.id.desc())
        )
    )


def messages_of(db: Session, conversation: Conversation) -> list[ChatMessage]:
    return list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation.id)
            .order_by(ChatMessage.id)
        )
    )


# ------------------------------------------------------------- context


#: Reads an attachment's stored bytes. Passed in so this module stays free
#: of storage and the tests can hand in bytes directly.
AttachmentLoader = Callable[[ChatAttachment], bytes]


def build_context(
    history: list[ChatMessage],
    new_text: str,
    settings: Settings,
    *,
    attachments: dict[int, list[ChatAttachment]] | None = None,
    new_attachments: list[ChatAttachment] | None = None,
    load: AttachmentLoader | None = None,
    context_tokens: int | None = None,
) -> tuple[list[dict], int]:
    """The messages to send, newest kept, and their estimated input tokens.

    * Empty replies and refusals are left out — they carry nothing to
      continue from.
    * Neighbouring messages from the same side are joined. That happens
      when a reply failed: the member's earlier message has no answer,
      and the API needs the two sides to alternate.
    * The oldest messages go first when the limit is reached, and the
      result always starts with the member.
    * **Trimming moves in steps, not one message at a time.** Where the
      history starts depends only on the conversation's total length,
      rounded to a whole step (`_stable_start`). A window that slid by one message every
      turn would change the first message every turn — and with it the
      whole cached prefix, so a long conversation would pay a cache write
      for everything on every reply. With steps, the start stays put for
      many turns and only moves when the history outgrows the limit.
    * **Attachments** (chat-plus-files) travel with their message as
      content blocks, before its text, every turn while the message is in
      the window — which is why the composer shows what each later reply
      costs. They are counted apart from the text: the text keeps its
      `CHAT_CONTEXT_TOKENS` window, and the files in the window may add up
      to `CHAT_ATTACHMENT_CONTEXT_TOKENS`; past that, the oldest messages
      (and their files) drop out first. Their estimate is the stored
      `estimated_tokens` — the figure the browser showed.
    """
    attachments = attachments or {}
    # (role, text, files) per turn.
    turns: list[tuple[str, str, list[ChatAttachment]]] = []
    for message in history:
        files = attachments.get(message.id, [])
        if not message.content.strip() and not files:
            continue
        if message.role is ChatRole.ASSISTANT and message.status is ChatMessageStatus.REFUSED:
            continue
        turns.append((message.role.value, message.content, files))
    turns.append((ChatRole.USER.value, new_text, list(new_attachments or [])))

    merged: list[dict] = []  # {"role", "texts": [...], "files": [...]}
    for role, text, files in turns:
        if merged and merged[-1]["role"] == role:
            merged[-1]["texts"].append(text)
            merged[-1]["files"].extend(files)
        else:
            merged.append({"role": role, "texts": [text], "files": list(files)})

    def joined(entry: dict) -> str:
        return "\n\n".join(text for text in entry["texts"] if text)

    budget = (context_tokens or settings.chat_context_tokens) - estimate_tokens(CHAT_SYSTEM_PROMPT)
    new_cost = estimate_tokens(new_text) + _MESSAGE_OVERHEAD
    if new_cost > budget:
        raise ChatRefusal(
            "메시지가 너무 깁니다. 나누어서 보내 주세요.",
            status_code=400,
        )
    # An unanswered earlier message joined to this one may not fit; the
    # new message alone always does.
    if estimate_tokens(joined(merged[-1])) + _MESSAGE_OVERHEAD > budget:
        merged[-1] = {
            "role": ChatRole.USER.value,
            "texts": [new_text],
            "files": list(new_attachments or []),
        }

    file_budget = settings.chat_attachment_context_tokens
    file_costs = [sum(row.estimated_tokens for row in entry["files"]) for entry in merged]
    if file_costs[-1] > file_budget:
        raise ChatRefusal(
            "이 메시지에 붙인 파일이 한 번에 보내기에 너무 깁니다. 몇 개는 다음 메시지로 나누어 보내 주세요.",
            status_code=400,
        )

    costs = [estimate_tokens(joined(entry)) + _MESSAGE_OVERHEAD for entry in merged]
    start = _stable_start(merged, costs, budget)
    if start is None:
        # The newest exchange alone is longer than one step: keep the
        # newest messages that fit.
        start, total = len(merged) - 1, costs[-1]
        while start > 0 and total + costs[start - 1] <= budget:
            start -= 1
            total += costs[start]
    while start < len(merged) - 1 and merged[start]["role"] != ChatRole.USER.value:
        start += 1
    # The files in the window must fit too; older messages go first.
    while start < len(merged) - 1 and sum(file_costs[start:]) > file_budget:
        start += 1
        while start < len(merged) - 1 and merged[start]["role"] != ChatRole.USER.value:
            start += 1

    messages: list[dict] = []
    for entry in merged[start:]:
        text = joined(entry)
        if not entry["files"]:
            messages.append({"role": entry["role"], "content": text})
            continue
        if load is None:
            raise RuntimeError("attachments need a loader")
        blocks = [attachments_service.content_block(row, load(row)) for row in entry["files"]]
        if text:
            blocks.append({"type": "text", "text": text})
        messages.append({"role": entry["role"], "content": blocks})

    estimated = sum(costs[start:]) + sum(file_costs[start:]) + estimate_tokens(CHAT_SYSTEM_PROMPT)
    return messages, estimated


# ----------------------------------------------- the long-history warning


@dataclass(frozen=True)
class LongHistory:
    """What a long conversation adds to every reply (token-guard, point 4)."""

    #: The input estimate a reply would carry beyond the system prompt.
    history_tokens: int
    #: What that history adds to one reply — and what a new conversation
    #: saves — in won, at the cache-read price where caching is on.
    extra_krw: int


def long_history_info(
    db: Session,
    settings: Settings,
    history: list[ChatMessage],
    model: ChosenModel,
) -> LongHistory | None:
    """The composer's warning figures, or None while the history is short.

    Uses the same trimmed context, calibration and prices as the pre-check
    in `prepare_turn`, so the warning and the charge can never disagree
    about what "long" costs.
    """
    limits = chat_limits.current(db)
    if limits.long_history_tokens <= 0 or not history:
        return None
    # Files in the window are resent with every reply too (chat-plus-files),
    # so they count toward "long" — by their stored estimate; the bytes are
    # not needed to count, hence the empty loader.
    files: dict[int, list[ChatAttachment]] = {}
    for row in db.scalars(
        select(ChatAttachment)
        .where(
            ChatAttachment.conversation_id == history[0].conversation_id,
            ChatAttachment.message_id.is_not(None),
        )
        .order_by(ChatAttachment.id)
    ):
        files.setdefault(row.message_id, []).append(row)
    try:
        _, estimated_input = build_context(
            history, "", settings, attachments=files, load=lambda _row: b""
        )
    except ChatRefusal:  # pragma: no cover — "" never exceeds the budget
        return None
    measured = calibration.for_model(db, model.model_id)
    calibrated = measured.calibrated_input(estimated_input)
    if calibrated < limits.long_history_tokens:
        return None
    history_tokens = max(0, estimated_input - estimate_tokens(CHAT_SYSTEM_PROMPT))
    try:
        price = pricing.price_for(db, model, cache_ttl=settings.cache_ttl)
    except pricing.PricingError:
        return None
    extra = chat_limits.history_cost_krw(price, measured.calibrated_input(history_tokens))
    if extra <= 0:
        return None
    return LongHistory(history_tokens=history_tokens, extra_krw=extra)


#: When a conversation outgrows the limit, it is cut back to this share of
#: the limit at once — and then grows for that long before the start
#: moves again. 2 → half the limit; the cached prefix holds for roughly
#: half a limit's worth of conversation between moves.
_TRIM_STEPS = 2


def _stable_start(
    merged: list[dict], costs: list[int], budget: int
) -> int | None:
    """Where the history sent should start, or None if no step fits.

    The cut is a position in tokens counted from the conversation's first
    message, rounded *up* to a multiple of one step (`budget / _TRIM_STEPS`)
    and then to the next member message. It depends only on how long the
    whole conversation is, so it stays exactly where it is — and the cached
    prefix stays byte-identical — until the conversation has grown by a
    whole step. A sliding window would move it on every reply.
    """
    total = sum(costs)
    if total <= budget:
        return 0
    step = max(1, budget // _TRIM_STEPS)
    cut = -(-(total - budget) // step) * step  # ceiling to a whole step
    running = 0
    for index, message in enumerate(merged):
        if running >= cut and message["role"] == ChatRole.USER.value:
            return index
        running += costs[index]
    return None


# ------------------------------------------------------------- rate limit


def check_rate_limit(db: Session, user: User, settings: Settings) -> None:
    """At most `CHAT_RATE_LIMIT_PER_MINUTE` messages in any rolling minute.

    Counted from the member's own saved messages, so it holds across
    server restarts and across several server processes, with nothing new
    to run. A message refused here is not saved, so it does not count.
    """
    limit = settings.chat_rate_limit_per_minute
    if limit <= 0:
        return
    since = datetime.now(timezone.utc) - timedelta(minutes=1)
    recent = db.scalar(
        select(func.count(ChatMessage.id)).where(
            ChatMessage.user_id == user.id,
            ChatMessage.role == ChatRole.USER,
            ChatMessage.created_at >= since,
        )
    )
    if (recent or 0) >= limit:
        raise ChatRefusal(
            f"메시지를 너무 빨리 보내고 있어요. 1분에 {limit}개까지 보낼 수 있습니다. "
            "잠시 후 다시 보내 주세요.",
            status_code=429,
        )


# ------------------------------------------------------------- the turn


@dataclass
class PreparedTurn:
    conversation_id: int
    user_id: int
    user_message: ChatMessage
    request: ChatRequest
    price: Price
    #: The catalogue model the reply uses — recorded on the reply and on
    #: its usage event. Under the mock too: the mock is priced as it.
    model_id: str
    estimated_input_tokens: int
    #: The mock answered rather than Claude — for the Admin status board.
    is_mock: bool = False
    #: Set when the per-reply cap, not the global output limit, decided
    #: `max_tokens` (token-guard): the cap in force, in won. A reply that
    #: then ends with stop_reason "max_tokens" stopped at the cap.
    reply_cap_krw: int | None = None
    #: The running-cost estimate's two halves (live-cost-display): the
    #: input side in won, priced the way the pre-check prices it, and the
    #: output price per 1,000 tokens in won. The screen adds
    #: `tokens(streamed text) × rate` and labels the sum 약.
    estimate_base_krw: int = 0
    won_per_1k_output: float = 0.0
    #: Server tools this turn sends (chat-plus-tools) and the per-search
    #: dollar price the fee is charged at.
    tools: tuple[str, ...] = ()
    web_search_usd_per_call: Decimal = Decimal("0.01")
    #: 생각 깊이 the reply runs at (quality-tuning Q1); None: the model has none.
    depth: str | None = None
    #: feat-auto-continue: the figures a continuation call is planned from —
    #: the level's room and call cap, the whole reply's ceiling (0 = never
    #: continue), the calibrated input of the first call and the tool
    #: reserves the cap and the wallet check carry.
    level_max_tokens: int = 0
    level_cap_krw: int = 0
    total_cap_krw: int = 0
    calibrated_input_tokens: int = 0
    cap_tool_extra_krw: int = 0
    tool_extra_krw: int = 0


#: How the server asks Claude to go on after a cut (feat-auto-continue).
#: The system prompt's rule names this prefix; the mock answers it with
#: the rest of the reply it cut.
CONTINUE_PROMPT = (
    "[이어서] 방금 답이 길이 제한에 닿아 끊겼어요. 인사말이나 요약 없이, "
    "끊긴 바로 다음 글자부터 그대로 이어서 써 주세요."
)


@dataclass
class TurnState:
    """What the stream produced, filled in as it runs."""

    raw_text: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0
    #: Billed web searches (chat-plus-tools) — the fee rides on these.
    web_search_count: int = 0
    #: Pages fetched — no fee, recorded in the ledger.
    web_fetch_count: int = 0
    #: [{"title": str, "url": str}, ...] the reply cited, saved with it.
    sources: list[dict[str, str]] | None = None
    #: Claude's summarized thinking (chat-thinking-view), saved with the
    #: reply for display only.
    thinking: str = ""
    stop_reason: str | None = None
    stopped: bool = False
    error: ClaudeError | None = None


def prepare_turn(
    db: Session,
    settings: Settings,
    *,
    user: User,
    conversation: Conversation,
    text: str,
    model: ChosenModel,
    is_mock: bool = False,
    attachment_ids: list[int] | None = None,
    load: AttachmentLoader | None = None,
) -> PreparedTurn:
    """Every check that can refuse a message, then the message saved.

    Raises `ChatRefusal`, `usage.InsufficientBudgetError`,
    `usage.NoQuarterError` or `pricing.PricingError`. None of them has
    spent anything.

    `attachment_ids` must be this member's files uploaded to this
    conversation and not sent yet; they become the message's files.
    """
    text = text.strip()
    new_files = _pending_files(db, user, conversation, attachment_ids or [], settings)
    if not text and not new_files:
        raise ChatRefusal("메시지를 입력해 주세요.", status_code=400)

    check_rate_limit(db, user, settings)
    price = pricing.price_for(db, model, cache_ttl=settings.cache_ttl)
    limits = chat_limits.current(db)
    # 생각 깊이 (quality-tuning Q1): the conversation's, else the member's
    # default; the server turns the name into effort, room and cap.
    level, effort = depth_service.resolve(
        limits.depth_levels, "chat", model.model_id, conversation.depth or user.default_depth
    )

    history = messages_of(db, conversation)
    messages, estimated_input = build_context(
        history,
        text,
        settings,
        attachments=files_by_message(db, conversation),
        new_attachments=new_files,
        load=load,
        context_tokens=limits.context_tokens,
    )

    # The input estimate, calibrated against this model's recent real
    # replies (never above the one-token-per-character figure); the output
    # side stays the full maximum, so this is still a worst case.
    calibrated_input = calibration.for_model(db, model.model_id).calibrated_input(estimated_input)

    # The per-reply cost cap (token-guard): worked out *before* the call
    # as a smaller `max_tokens`, so the API itself stops at the cap and
    # reports real usage — the charge is exact, with no estimate of an
    # aborted stream. Thinking tokens count toward `max_tokens` and are
    # billed as output, so the cap covers them too.
    # Server tools (chat-plus-tools): sent only when the member's toggle
    # AND the model's switch are both on. Their worst case joins every
    # money check below, so neither the wallet nor the cap can be passed
    # by a fee the tokens did not show.
    tools = chat_tools.tools_in_force(conversation, model)
    # The wallet covers a turn's full possible cost (fees + the fetch
    # cap); the per-reply cap reserves every enabled tool's worst case —
    # fees AND result tokens (the owner's rule) — so a tooled reply's
    # charge stays inside the cap (`chat_tools.cap_extra_krw`). The fetch
    # bounds are the admin's 채팅 한도 settings (tool-cap-defaults).
    tool_extra = chat_tools.worst_case_extra_krw(
        price,
        tools,
        model.web_search_usd_per_call,
        fetch_max_uses=limits.web_fetch_max_uses,
        fetch_max_content_tokens=limits.web_fetch_max_content_tokens,
        search_max_uses=limits.web_search_max_uses,
    )
    cap_tool_extra = chat_tools.cap_extra_krw(
        price,
        tools,
        model.web_search_usd_per_call,
        fetch_max_uses=limits.web_fetch_max_uses,
        fetch_max_content_tokens=limits.web_fetch_max_content_tokens,
        search_max_uses=limits.web_search_max_uses,
    )

    max_tokens = level.max_tokens
    reply_cap_krw: int | None = None
    if level.cap_krw > 0:
        affordable_output = chat_limits.output_budget(
            price, level.cap_krw - cap_tool_extra, calibrated_input
        )
        if affordable_output < 1:
            # The input (and any tool worst case) alone reaches the cap:
            # refuse free of charge, naming what to change.
            if cap_tool_extra > 0:
                names = ", ".join(chat_tools.LABELS[kind] for kind in tools)
                raise ChatRefusal(
                    f"켜 둔 도구({names})의 최대 비용까지 치면 1회 비용 한도"
                    f"({level.cap_krw:,}원)에 닿아요. 도구를 끄고 보내거나, "
                    "관리자가 1회 비용 한도를 올려야 쓸 수 있어요.",
                    status_code=400,
                )
            raise ChatRefusal(
                f"대화가 길어져 입력만으로 1회 비용 한도({level.cap_krw:,}원)에 "
                "닿아요. 새 대화로 시작하거나 생각 깊이를 높여 주세요.",
                status_code=400,
            )
        if affordable_output < max_tokens:
            max_tokens = affordable_output
            reply_cap_krw = level.cap_krw

    worst_case = price.worst_case_krw(calibrated_input, max_tokens) + tool_extra
    usage_service.ensure_affordable(db, user=user, amount_krw=worst_case, settings=settings)

    # The running-cost estimate (live-cost-display): the input side once,
    # priced like the pre-check (cache write when caching is on), plus a
    # per-1,000-output-token rate the screen multiplies as text arrives.
    estimate_base_krw = price.worst_case_krw(calibrated_input, 0)
    won_per_1k_output = float(price.output_usd_per_mtok * price.usd_krw) / 1000

    now = datetime.now(timezone.utc)
    message = ChatMessage(
        conversation_id=conversation.id,
        user_id=user.id,
        role=ChatRole.USER,
        content=text,
        status=ChatMessageStatus.COMPLETE,
        created_at=now,
    )
    db.add(message)
    if not conversation.title:
        conversation.title = short_title(
            text or ", ".join(row.original_name for row in new_files), TITLE_LENGTH
        )
    conversation.last_message_at = now
    db.flush()
    for row in new_files:
        row.message_id = message.id
    db.commit()
    db.refresh(message)

    return PreparedTurn(
        conversation_id=conversation.id,
        user_id=user.id,
        user_message=message,
        request=ChatRequest(
            system=CHAT_SYSTEM_PROMPT,
            messages=messages,
            max_tokens=max_tokens,
            model=model.model_id,
            cache_ttl=settings.cache_ttl,
            tools=tools,
            fetch_max_uses=limits.web_fetch_max_uses,
            fetch_max_content_tokens=limits.web_fetch_max_content_tokens,
            search_max_uses=limits.web_search_max_uses,
            show_thinking=conversation.show_thinking,
            effort=effort,
            timeout_seconds=float(limits.timeout_seconds),
        ),
        price=price,
        model_id=model.model_id,
        estimated_input_tokens=estimated_input,
        is_mock=is_mock,
        reply_cap_krw=reply_cap_krw,
        estimate_base_krw=estimate_base_krw,
        won_per_1k_output=won_per_1k_output,
        tools=tools,
        web_search_usd_per_call=model.web_search_usd_per_call,
        depth=level.name if effort else None,
        level_max_tokens=level.max_tokens,
        level_cap_krw=level.cap_krw,
        total_cap_krw=level.total_cap_krw,
        calibrated_input_tokens=calibrated_input,
        cap_tool_extra_krw=cap_tool_extra,
        tool_extra_krw=tool_extra,
    )


# ------------------------------------------------- automatic continuation


@dataclass(frozen=True)
class Continuation:
    """The next call of a reply that stopped at `max_tokens`."""

    request: ChatRequest
    estimated_input_tokens: int
    #: The running-cost estimate's input half for this call, in won.
    estimate_base_krw: int


@dataclass(frozen=True)
class ContinuationStop:
    """Why the server will not continue: "total_cap" (the whole reply's
    ceiling) or "wallet" (the member cannot afford the next call); the
    Korean sentence the screen shows."""

    reason: str
    note: str


def plan_continuation(
    db: Session, settings: Settings, turn: PreparedTurn, raw_so_far: str, charged_so_far_krw: int
) -> Continuation | ContinuationStop:
    """Plan the next call after a cut — or say why there is none.

    The next call sends the history, the partial reply as the assistant's
    turn and `CONTINUE_PROMPT`; it runs under the same per-call cap (a
    smaller `max_tokens` again, now with the partial counted as input) and
    the wallet is checked for its worst case like any call. Two stops:
    the whole reply's ceiling (`total_cap_krw`, the admin's 전체 한도) and
    the wallet. Nothing here spends anything.
    """
    if turn.total_cap_krw <= 0:
        return ContinuationStop("total_cap", "")
    added = pricing.estimate_tokens(raw_so_far) + pricing.estimate_tokens(CONTINUE_PROMPT)
    estimated_input = turn.estimated_input_tokens + added
    calibrated_input = turn.calibrated_input_tokens + added

    max_tokens = turn.level_max_tokens
    if turn.level_cap_krw > 0:
        affordable = chat_limits.output_budget(
            turn.price, turn.level_cap_krw - turn.cap_tool_extra_krw, calibrated_input
        )
        if affordable < 1:
            return ContinuationStop(
                "total_cap",
                f"이어 쓰려면 지금까지 쓴 글만으로 1회 비용 한도({turn.level_cap_krw:,}원)에 닿아 여기서 멈췄어요.",
            )
        max_tokens = min(max_tokens, affordable)

    worst_case = turn.price.worst_case_krw(calibrated_input, max_tokens) + turn.tool_extra_krw
    if charged_so_far_krw + worst_case > turn.total_cap_krw:
        return ContinuationStop(
            "total_cap",
            f"답장이 전체 비용 한도({turn.total_cap_krw:,}원)에 닿아 여기서 멈췄어요. "
            "'이어서 쓰기'로 이어 받을 수 있어요.",
        )
    user = db.get(User, turn.user_id)
    assert user is not None
    try:
        usage_service.ensure_affordable(db, user=user, amount_krw=worst_case, settings=settings)
    except (usage_service.InsufficientBudgetError, usage_service.NoQuarterError) as error:
        return ContinuationStop("wallet", f"{error} 답장은 여기까지 저장했어요.")

    messages = [
        *turn.request.messages,
        {"role": "assistant", "content": raw_so_far},
        {"role": "user", "content": CONTINUE_PROMPT},
    ]
    request = replace(turn.request, messages=messages, max_tokens=max_tokens)
    return Continuation(
        request=request,
        estimated_input_tokens=estimated_input,
        estimate_base_krw=turn.price.worst_case_krw(calibrated_input, 0),
    )


def files_by_message(db: Session, conversation: Conversation) -> dict[int, list[ChatAttachment]]:
    """The conversation's sent files, by message."""
    grouped: dict[int, list[ChatAttachment]] = {}
    for row in db.scalars(
        select(ChatAttachment)
        .where(
            ChatAttachment.conversation_id == conversation.id,
            ChatAttachment.message_id.is_not(None),
        )
        .order_by(ChatAttachment.id)
    ):
        grouped.setdefault(row.message_id, []).append(row)
    return grouped


def _pending_files(
    db: Session, user: User, conversation: Conversation, ids: list[int], settings: Settings
) -> list[ChatAttachment]:
    """The files named by `ids`: this member's, this conversation's, unsent."""
    if not ids:
        return []
    if len(set(ids)) > settings.chat_attachments_per_message:
        raise ChatRefusal("한 번에 5개까지 올릴 수 있습니다.", status_code=400)
    rows = list(
        db.scalars(
            select(ChatAttachment)
            .where(
                ChatAttachment.id.in_(set(ids)),
                ChatAttachment.user_id == user.id,
                ChatAttachment.conversation_id == conversation.id,
                ChatAttachment.message_id.is_(None),
            )
            .order_by(ChatAttachment.id)
        )
    )
    if len(rows) != len(set(ids)):
        raise ChatRefusal("첨부한 파일을 찾을 수 없습니다. 다시 올려 주세요.", status_code=400)
    return rows


@dataclass(frozen=True)
class ReplyUsage:
    """What the ledger recorded for one reply — the receipt's numbers.

    The cache fields are None when caching is off, exactly as on the
    usage event, so the receipt never shows a 캐시 읽기 line the ledger
    does not have.
    """

    input_tokens: int
    output_tokens: int
    cache_write_tokens: int | None
    cache_read_tokens: int | None
    #: Billed web searches and their fee in won (chat-plus-tools). Zero
    #: when no tool ran — the receipt then shows no 검색 line.
    web_search_count: int = 0
    tool_fee_krw: int = 0
    #: The receipt's won split (cost-clarity), from the ledger row:
    #: `accounting.receipt_fields`.
    split: dict | None = None
    #: Written with 생각 과정 보기 on (chat-thinking-view).
    thinking_shown: bool = False


@dataclass
class TurnResult:
    message: ChatMessage | None
    charged_krw: int
    error: ClaudeError | None = None
    #: The composer's long-history warning after this reply, so the screen
    #: updates without refetching the whole conversation (token-guard).
    long_history: LongHistory | None = None
    #: The receipt's token split (live-cost-display). None when nothing
    #: was used — then there is nothing to show.
    usage: ReplyUsage | None = None
    #: 동아리 지원 remaining after this charge, from the same locked
    #: transaction — the sidebar updates from it without another request.
    #: None when nothing was charged.
    wallet_remaining_krw: int | None = None
    #: feat-auto-continue: how many calls wrote the reply, and the Korean
    #: sentence for a reply the server stopped continuing (None otherwise).
    segments: int = 1
    stop_note: str | None = None


def _status_for(state: TurnState) -> ChatMessageStatus:
    if state.stopped:
        return ChatMessageStatus.STOPPED
    if state.stop_reason == "refusal":
        return ChatMessageStatus.REFUSED
    if state.stop_reason == "max_tokens":
        return ChatMessageStatus.TRUNCATED
    return ChatMessageStatus.COMPLETE


def _safe_sources(sources: list[dict] | None) -> list[dict] | None:
    """Only http(s) sources are saved — anything else is dropped.

    The provider's citations become clickable links on the member's
    screen; a javascript: or data: URL there would run as the member
    (chat-plus-tools review round 2). Filtered at save time, the one
    place every path goes through. The reply's own text is untouched.
    """
    if not sources:
        return None
    safe = [
        source
        for source in sources
        if str(source.get("url", "")).lower().startswith(("http://", "https://"))
    ]
    return safe or None


@dataclass
class SegmentCharge:
    """One call of a reply, settled: what the ledger took (feat-auto-continue
    splits a long reply into calls, each its own charge)."""

    event_id: int | None
    charged_krw: int
    input_tokens: int
    output_tokens: int
    cache_write_tokens: int
    cache_read_tokens: int
    web_search_count: int
    tool_fee_krw: int
    split: dict | None
    wallet_remaining_krw: int | None
    #: The call's stream state — text, thinking, sources, how it ended.
    state: TurnState


def settle_segment(
    db: Session,
    settings: Settings,
    turn: PreparedTurn,
    state: TurnState,
    *,
    estimated_input_tokens: int | None = None,
) -> SegmentCharge:
    """Charge one call for what it used — `usage.charge()` once, as before.

    `estimated_input_tokens` is the call's own input estimate (a
    continuation's grows with the partial reply); it stands in only for a
    call stopped before any usage arrived.
    """
    user = db.get(User, turn.user_id)
    conversation = db.get(Conversation, turn.conversation_id)
    assert user is not None
    estimated = turn.estimated_input_tokens if estimated_input_tokens is None else estimated_input_tokens

    # A stopped stream has not reported its output count yet; the text
    # received stands in for it, generously. Its input count arrived with
    # the first event — or, if it was stopped even before that, the
    # estimate stands in, priced as the dearer cache write when caching
    # is on.
    input_tokens = state.input_tokens
    written = state.cache_write_tokens
    read = state.cache_read_tokens
    if state.stopped and not (input_tokens or written or read):
        if turn.request.cache_ttl is not None:
            written = estimated
        else:
            input_tokens = estimated
    output_tokens = state.output_tokens
    if state.stopped:
        output_tokens = max(output_tokens, estimate_tokens(state.raw_text))

    charged = 0
    event_id: int | None = None
    split: dict | None = None
    wallet_remaining: int | None = None
    # The tool fee (chat-plus-tools): billed searches at the catalogue's
    # per-search price. Exact, not an estimate — the provider reported the
    # count with its usage.
    tool_fee = chat_tools.search_fee_krw(
        turn.price, turn.web_search_usd_per_call, state.web_search_count
    )
    if input_tokens or output_tokens or written or read:
        amount = turn.price.krw(input_tokens, output_tokens, written, read) + tool_fee
        try:
            result = usage_service.charge(
                db,
                user=user,
                amount_krw=amount,
                provider="claude",
                feature=UsageFeature.CHAT.value,
                model_id=turn.model_id,
                depth=turn.depth,
                provider_units=input_tokens + output_tokens + written + read,
                provider_unit="tokens",
                provider_cost=(
                    turn.price.usd(input_tokens, output_tokens, written, read)
                    + Decimal(state.web_search_count) * turn.web_search_usd_per_call
                ).quantize(Decimal("0.000001")),
                provider_currency="USD",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_write_tokens=written if turn.request.cache_ttl is not None else None,
                cache_read_tokens=read if turn.request.cache_ttl is not None else None,
                estimated_input_tokens=estimated,
                exchange_rate_krw=turn.price.usd_krw,
                conversation_id=conversation.id if conversation else None,
                web_search_count=state.web_search_count or None,
                web_fetch_count=state.web_fetch_count or None,
                thinking_shown=True if turn.request.show_thinking else None,
                tool_fee_krw=tool_fee or None,
                cost=turn.price.split(input_tokens, output_tokens, written, read).with_tools(
                    Decimal(state.web_search_count) * turn.web_search_usd_per_call
                ),
                commit=False,
                cap_to_available=True,
                settings=settings,
            )
            charged = result.event.charged_krw
            event_id = result.event.id
            split = accounting.receipt_fields(result.event)
            # The sidebar shows the 동아리 지원 wallet, so only a
            # community-funded charge may carry a figure for it: after a
            # personal-funded one (top-ups on) the screen must refetch,
            # or its personal balance goes stale.
            if result.funding_source is FundingSource.COMMUNITY:
                wallet_remaining = result.community_remaining_krw
        except usage_service.NoQuarterError:
            # The quarter closed while the reply was streaming. There is no
            # quarter to charge against; the reply is still the member's.
            charged = 0
    db.commit()
    return SegmentCharge(
        event_id=event_id,
        charged_krw=charged,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_write_tokens=written,
        cache_read_tokens=read,
        web_search_count=state.web_search_count,
        tool_fee_krw=tool_fee,
        split=split,
        wallet_remaining_krw=wallet_remaining,
        state=state,
    )


def _sum_splits(splits: list[dict | None]) -> dict | None:
    """The receipt's won split for the whole reply: the calls' added up."""
    present = [split for split in splits if split]
    if not present:
        return None
    out: dict = {}
    for split in present:
        for key, value in split.items():
            if key == "split_estimated":
                out[key] = bool(out.get(key)) or bool(value)
            elif isinstance(value, (int, float)) and not isinstance(value, bool):
                out[key] = round(out.get(key, 0) + value, 4)
            else:
                out.setdefault(key, value)
    return out


def save_reply(
    db: Session,
    settings: Settings,
    turn: PreparedTurn,
    segments: list[SegmentCharge],
    *,
    stop: ContinuationStop | None = None,
) -> TurnResult:
    """Save the reply the calls produced — one message, however many calls.

    The text is the calls' joined as one; the status comes from the last
    call (stopped · refused · cut) and from why the server did not go on
    (`stop`: the whole reply's ceiling or the wallet → 잘림, with the
    ceiling recorded as `capped_krw` so the screen can say why). The
    receipt is the calls' ledger rows added up.
    """
    user = db.get(User, turn.user_id)
    conversation = db.get(Conversation, turn.conversation_id)
    assert user is not None
    last = segments[-1].state
    raw_text = "".join(segment.state.raw_text for segment in segments)
    thinking = "\n\n".join(s.state.thinking.strip() for s in segments if s.state.thinking.strip())
    sources: list[dict] = []
    seen: set[str] = set()
    for segment in segments:
        for source in segment.state.sources or []:
            if source.get("url") not in seen:
                seen.add(source.get("url"))
                sources.append(source)

    action, action_title = action_of(raw_text)
    text = visible_text(raw_text)
    status = _status_for(last)
    capped: int | None = None
    if status is ChatMessageStatus.TRUNCATED:
        # Cut at a cost ceiling: the whole reply's (after continuations)
        # or — with continuation off — the call's own (token-guard).
        if stop is not None and stop.reason == "total_cap":
            capped = turn.total_cap_krw or turn.reply_cap_krw
        elif stop is None:
            capped = turn.reply_cap_krw
    elif stop is not None and stop.reason == "wallet" and status is ChatMessageStatus.COMPLETE:
        status = ChatMessageStatus.TRUNCATED

    charged = sum(segment.charged_krw for segment in segments)
    event_ids = [segment.event_id for segment in segments if segment.event_id is not None]
    wallet_remaining = next(
        (segment.wallet_remaining_krw for segment in reversed(segments) if segment.wallet_remaining_krw is not None),
        None,
    )
    input_tokens = sum(s.input_tokens + s.cache_write_tokens + s.cache_read_tokens for s in segments)
    output_tokens = sum(s.output_tokens for s in segments)

    message: ChatMessage | None = None
    if conversation is not None and (text or status is ChatMessageStatus.REFUSED):
        message = ChatMessage(
            conversation_id=conversation.id,
            user_id=user.id,
            role=ChatRole.ASSISTANT,
            content=text,
            status=status,
            action=action if status is not ChatMessageStatus.REFUSED else None,
            action_title=action_title,
            model_id=turn.model_id,
            depth=turn.depth,
            # The whole prompt, cached or not — what the reply was written from.
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            capped_krw=capped,
            sources=_safe_sources(sources),
            thinking=thinking or None,
            usage_event_id=event_ids[0] if event_ids else None,
            segment_event_ids=event_ids if len(event_ids) > 1 else None,
            created_at=datetime.now(timezone.utc),
        )
        db.add(message)
        conversation.last_message_at = message.created_at

    label_suffix = " (mock)" if turn.is_mock else ""
    providers.record_success(db, "claude", f"채팅 답변{label_suffix}")
    db.commit()
    if message is not None:
        db.refresh(message)

    long_history = None
    if conversation is not None:
        try:
            model = chat_models_service.for_conversation(db, settings, user, conversation)
            long_history = long_history_info(
                db, settings, messages_of(db, conversation), model
            )
        except (chat_models_service.ModelChoiceError, pricing.PricingError):
            long_history = None

    usage: ReplyUsage | None = None
    # Only what the ledger actually recorded gets a receipt: with no
    # event (the quarter closed mid-stream) a 0원 receipt would claim a
    # charge the ledger does not have, and vanish on reload.
    if event_ids:
        cached = turn.request.cache_ttl is not None
        usage = ReplyUsage(
            input_tokens=sum(s.input_tokens for s in segments),
            output_tokens=output_tokens,
            cache_write_tokens=sum(s.cache_write_tokens for s in segments) if cached else None,
            cache_read_tokens=sum(s.cache_read_tokens for s in segments) if cached else None,
            web_search_count=sum(s.web_search_count for s in segments),
            tool_fee_krw=sum(s.tool_fee_krw for s in segments),
            split=_sum_splits([s.split for s in segments]),
            thinking_shown=turn.request.show_thinking,
        )
    return TurnResult(
        message=message,
        charged_krw=charged,
        long_history=long_history,
        usage=usage,
        wallet_remaining_krw=wallet_remaining,
        segments=len(segments),
        stop_note=stop.note if stop is not None and stop.note else None,
    )


def finish_turn(
    db: Session, settings: Settings, turn: PreparedTurn, state: TurnState
) -> TurnResult:
    """Charge what was used and save the reply — or, on an error, neither.

    One call's worth: `settle_segment` then `save_reply`. The route uses
    the two directly when it continues a cut reply (feat-auto-continue).
    """
    if state.error is not None:
        if state.error.kind != ProviderErrorKind.BUSY:
            # BUSY is our own concurrency limit (PART F): the provider was
            # never called, so the status board must not blame it.
            providers.record_failure(db, "claude", state.error.kind, state.error.detail)
        db.commit()
        return TurnResult(message=None, charged_krw=0, error=state.error)
    segment = settle_segment(db, settings, turn, state)
    return save_reply(db, settings, turn, [segment])
