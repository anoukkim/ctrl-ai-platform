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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import (
    ChatAction,
    ChatMessage,
    ChatMessageStatus,
    ChatRole,
    Conversation,
    UsageFeature,
    User,
)
from app.services import calibration, chat_limits, pricing, providers
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


def build_context(
    history: list[ChatMessage], new_text: str, settings: Settings
) -> tuple[list[dict[str, str]], int]:
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
    """
    turns: list[tuple[str, str]] = []
    for message in history:
        if not message.content.strip():
            continue
        if message.role is ChatRole.ASSISTANT and message.status is ChatMessageStatus.REFUSED:
            continue
        turns.append((message.role.value, message.content))
    turns.append((ChatRole.USER.value, new_text))

    merged: list[dict[str, str]] = []
    for role, text in turns:
        if merged and merged[-1]["role"] == role:
            merged[-1]["content"] += "\n\n" + text
        else:
            merged.append({"role": role, "content": text})

    budget = settings.chat_context_tokens - estimate_tokens(CHAT_SYSTEM_PROMPT)
    new_cost = estimate_tokens(new_text) + _MESSAGE_OVERHEAD
    if new_cost > budget:
        raise ChatRefusal(
            "메시지가 너무 깁니다. 나누어서 보내 주세요.",
            status_code=400,
        )
    # An unanswered earlier message joined to this one may not fit; the
    # new message alone always does.
    if estimate_tokens(merged[-1]["content"]) + _MESSAGE_OVERHEAD > budget:
        merged[-1] = {"role": ChatRole.USER.value, "content": new_text}

    costs = [estimate_tokens(message["content"]) + _MESSAGE_OVERHEAD for message in merged]
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

    return merged[start:], sum(costs[start:]) + estimate_tokens(CHAT_SYSTEM_PROMPT)


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
    try:
        _, estimated_input = build_context(history, "", settings)
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
    merged: list[dict[str, str]], costs: list[int], budget: int
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


@dataclass
class TurnState:
    """What the stream produced, filled in as it runs."""

    raw_text: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0
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
) -> PreparedTurn:
    """Every check that can refuse a message, then the message saved.

    Raises `ChatRefusal`, `usage.InsufficientBudgetError`,
    `usage.NoQuarterError` or `pricing.PricingError`. None of them has
    spent anything.
    """
    text = text.strip()
    if not text:
        raise ChatRefusal("메시지를 입력해 주세요.", status_code=400)

    check_rate_limit(db, user, settings)
    price = pricing.price_for(db, model, cache_ttl=settings.cache_ttl)

    history = messages_of(db, conversation)
    messages, estimated_input = build_context(history, text, settings)

    # The input estimate, calibrated against this model's recent real
    # replies (never above the one-token-per-character figure); the output
    # side stays the full maximum, so this is still a worst case.
    calibrated_input = calibration.for_model(db, model.model_id).calibrated_input(estimated_input)

    # The per-reply cost cap (token-guard): worked out *before* the call
    # as a smaller `max_tokens`, so the API itself stops at the cap and
    # reports real usage — the charge is exact, with no estimate of an
    # aborted stream. Thinking tokens count toward `max_tokens` and are
    # billed as output, so the cap covers them too.
    limits = chat_limits.current(db)
    max_tokens = settings.chat_max_output_tokens
    reply_cap_krw: int | None = None
    if limits.reply_cap_krw > 0:
        affordable_output = chat_limits.output_budget(
            price, limits.reply_cap_krw, calibrated_input
        )
        if affordable_output < 1:
            # The input alone reaches the cap: refuse free of charge, with
            # the same advice as the long-history warning.
            raise ChatRefusal(
                f"대화가 길어져 입력만으로 1회 비용 한도({limits.reply_cap_krw:,}원)에 "
                "닿아요. 새 대화로 시작해 주세요.",
                status_code=400,
            )
        if affordable_output < max_tokens:
            max_tokens = affordable_output
            reply_cap_krw = limits.reply_cap_krw

    worst_case = price.worst_case_krw(calibrated_input, max_tokens)
    usage_service.ensure_affordable(db, user=user, amount_krw=worst_case, settings=settings)

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
        conversation.title = short_title(text, TITLE_LENGTH)
    conversation.last_message_at = now
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
        ),
        price=price,
        model_id=model.model_id,
        estimated_input_tokens=estimated_input,
        is_mock=is_mock,
        reply_cap_krw=reply_cap_krw,
    )


@dataclass
class TurnResult:
    message: ChatMessage | None
    charged_krw: int
    error: ClaudeError | None = None
    #: The composer's long-history warning after this reply, so the screen
    #: updates without refetching the whole conversation (token-guard).
    long_history: LongHistory | None = None


def _status_for(state: TurnState) -> ChatMessageStatus:
    if state.stopped:
        return ChatMessageStatus.STOPPED
    if state.stop_reason == "refusal":
        return ChatMessageStatus.REFUSED
    if state.stop_reason == "max_tokens":
        return ChatMessageStatus.TRUNCATED
    return ChatMessageStatus.COMPLETE


def finish_turn(
    db: Session, settings: Settings, turn: PreparedTurn, state: TurnState
) -> TurnResult:
    """Charge what was used and save the reply — or, on an error, neither.

    Runs after the stream, however it ended. Loads its rows by id rather
    than reusing objects from `prepare_turn`: the request's session may
    have been closed in between.
    """
    label_suffix = " (mock)" if turn.is_mock else ""

    if state.error is not None:
        providers.record_failure(db, "claude", state.error.kind, state.error.detail)
        db.commit()
        return TurnResult(message=None, charged_krw=0, error=state.error)

    user = db.get(User, turn.user_id)
    conversation = db.get(Conversation, turn.conversation_id)
    assert user is not None

    action, action_title = action_of(state.raw_text)
    text = visible_text(state.raw_text)
    status = _status_for(state)

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
            written = turn.estimated_input_tokens
        else:
            input_tokens = turn.estimated_input_tokens
    output_tokens = state.output_tokens
    if state.stopped:
        output_tokens = max(output_tokens, estimate_tokens(state.raw_text))

    charged = 0
    event_id: int | None = None
    if input_tokens or output_tokens or written or read:
        amount = turn.price.krw(input_tokens, output_tokens, written, read)
        try:
            result = usage_service.charge(
                db,
                user=user,
                amount_krw=amount,
                provider="claude",
                feature=UsageFeature.CHAT.value,
                model_id=turn.model_id,
                provider_units=input_tokens + output_tokens + written + read,
                provider_unit="tokens",
                provider_cost=turn.price.usd(input_tokens, output_tokens, written, read).quantize(
                    Decimal("0.000001")
                ),
                provider_currency="USD",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_write_tokens=written if turn.request.cache_ttl is not None else None,
                cache_read_tokens=read if turn.request.cache_ttl is not None else None,
                estimated_input_tokens=turn.estimated_input_tokens,
                exchange_rate_krw=turn.price.usd_krw,
                conversation_id=conversation.id if conversation else None,
                commit=False,
                cap_to_available=True,
                settings=settings,
            )
            charged = result.event.charged_krw
            event_id = result.event.id
        except usage_service.NoQuarterError:
            # The quarter closed while the reply was streaming. There is no
            # quarter to charge against; the reply is still the member's.
            charged = 0

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
            # The whole prompt, cached or not — what the reply was written from.
            input_tokens=input_tokens + written + read,
            output_tokens=output_tokens,
            # Stopped by the per-reply cap, not the global limit — so the
            # screen can say so, after a reload too (token-guard).
            capped_krw=(
                turn.reply_cap_krw if state.stop_reason == "max_tokens" else None
            ),
            usage_event_id=event_id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(message)
        conversation.last_message_at = message.created_at

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
    return TurnResult(message=message, charged_krw=charged, long_history=long_history)
