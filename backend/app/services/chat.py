"""Chat: conversations, one member message at a time, and what it costs.

A message goes through two steps, and the split is the important part:

1. **`prepare_turn`** — before Claude is called. Checks the per-member
   rate limit, prices the call, trims the history to the context limit,
   and checks the Build budget against the **worst case** (the trimmed
   input plus the maximum reply). Anything refused here costs nothing,
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
    BudgetCategory,
    ChatAction,
    ChatMessage,
    ChatMessageStatus,
    ChatRole,
    Conversation,
    UsageFeature,
    User,
)
from app.services import pricing, providers
from app.services import usage as usage_service
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

#: How a reply asks for an action button. See `CHAT_SYSTEM_PROMPT`.
ACTION_MARKER = re.compile(r"\[\[action:(builder|video)(?:\|([^\]\n]*))?\]\]")


class MarkerFilter:
    """Keeps the action marker out of what the member sees, while streaming.

    The marker arrives in pieces like everything else, so the screen would
    otherwise show "[[act" for a moment. Text is passed through until a
    `[` that could begin a marker; from there it is held back until the
    stream ends, when `finish()` strips the marker (if it was one) and
    returns whatever was held.
    """

    def __init__(self) -> None:
        self._held = ""
        self.raw = ""

    def feed(self, text: str) -> str:
        self.raw += text
        if self._held:
            self._held += text
            return ""
        start = text.find("[[")
        if start == -1 and text.endswith("["):
            start = len(text) - 1
        if start == -1:
            return text
        self._held = text[start:]
        return text[:start]

    def finish(self) -> str:
        """Whatever was held back, with the marker (if it was one) removed."""
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

    kept: list[dict[str, str]] = []
    total = 0
    for message in reversed(merged):
        cost = estimate_tokens(message["content"]) + _MESSAGE_OVERHEAD
        if kept and total + cost > budget:
            break
        kept.append(message)
        total += cost
    kept.reverse()
    while kept and kept[0]["role"] != ChatRole.USER.value:
        total -= estimate_tokens(kept[0]["content"]) + _MESSAGE_OVERHEAD
        kept.pop(0)

    return kept, total + estimate_tokens(CHAT_SYSTEM_PROMPT)


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
    model_id: str
    estimated_input_tokens: int


@dataclass
class TurnState:
    """What the stream produced, filled in as it runs."""

    raw_text: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
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
    model_id: str,
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
    price = pricing.price_for(db, model_id, settings)

    history = messages_of(db, conversation)
    messages, estimated_input = build_context(history, text, settings)

    worst_case = price.krw(estimated_input, settings.chat_max_output_tokens)
    usage_service.ensure_affordable(
        db, user=user, category=BudgetCategory.BUILD, amount_krw=worst_case
    )

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
            max_tokens=settings.chat_max_output_tokens,
        ),
        price=price,
        model_id=model_id,
        estimated_input_tokens=estimated_input,
    )


@dataclass
class TurnResult:
    message: ChatMessage | None
    charged_krw: int
    error: ClaudeError | None = None


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
    mock = turn.model_id == "mock"
    label_suffix = " (mock)" if mock else ""

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
    # estimate stands in.
    input_tokens = state.input_tokens or (turn.estimated_input_tokens if state.stopped else 0)
    output_tokens = state.output_tokens
    if state.stopped:
        output_tokens = max(output_tokens, estimate_tokens(state.raw_text))

    charged = 0
    event_id: int | None = None
    if input_tokens or output_tokens:
        amount = turn.price.krw(input_tokens, output_tokens)
        try:
            result = usage_service.charge(
                db,
                user=user,
                category=BudgetCategory.BUILD,
                amount_krw=amount,
                provider="claude",
                feature=UsageFeature.CHAT.value,
                model_id=turn.model_id,
                provider_units=input_tokens + output_tokens,
                provider_unit="tokens",
                provider_cost=turn.price.usd(input_tokens, output_tokens).quantize(
                    Decimal("0.000001")
                ),
                provider_currency="USD",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                exchange_rate_krw=turn.price.usd_krw,
                conversation_id=conversation.id if conversation else None,
                commit=False,
                cap_to_available=True,
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
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            usage_event_id=event_id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(message)
        conversation.last_message_at = message.created_at

    providers.record_success(db, "claude", f"채팅 답변{label_suffix}")
    db.commit()
    if message is not None:
        db.refresh(message)
    return TurnResult(message=message, charged_krw=charged)
