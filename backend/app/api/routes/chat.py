"""Chat — a member's conversations with Claude (Phase 2).

Who may do what:

* **Reading** (the list, one conversation) needs only a signed-in member.
  A member who is not participating this quarter keeps their past
  conversations, as they keep every other piece of their work.
* **Everything that writes** — a new conversation, a message, rename,
  delete — needs `require_active_member`, as every create, edit and
  delete route does.

Every query is scoped to the signed-in member: another member's
conversation is a 404, not a 403, so its existence is not revealed.

Sending a message streams the reply as Server-Sent Events:

    event: start   data: {"user_message": {...}}
    event: delta   data: {"text": "..."}          (many)
    event: done    data: {"message": {...} | null, "charged_krw": 12}
    event: error   data: {"detail": "한국어 문장", "kind": "timeout"}

Anything refused *before* Claude is called — rate limit, budget, a
missing price — is an ordinary JSON error response instead, with nothing
spent.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import update
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_current_user, require_active_member
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import Conversation, ProviderErrorKind, UsageEvent, User
from app.schemas.chat import (
    MAX_MESSAGE_LENGTH,
    ChatInfo,
    ChatMessageCreate,
    ChatMessageRead,
    ConversationCreate,
    ConversationDetail,
    ConversationRead,
    ConversationUpdate,
)
from app.services import chat as chat_service
from app.services import pricing
from app.services import usage as usage_service
from app.services.claude_provider import (
    ClaudeError,
    StreamEnd,
    TextDelta,
    UsageUpdate,
    get_claude_provider,
)

router = APIRouter(prefix="/chat", tags=["chat"])

NOT_FOUND = "대화를 찾을 수 없습니다."


def _owned(db: Session, user: User, conversation_id: int) -> Conversation:
    conversation = chat_service.owned_conversation(db, user, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return conversation


@router.get("/info", response_model=ChatInfo, summary="How replies are made — mock or real")
def chat_info(
    _: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> ChatInfo:
    return ChatInfo(
        is_mock=settings.provider_is_mock("claude"),
        rate_limit_per_minute=settings.chat_rate_limit_per_minute,
        max_message_length=MAX_MESSAGE_LENGTH,
    )


@router.get("/conversations", response_model=list[ConversationRead])
def list_conversations(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[Conversation]:
    return chat_service.list_conversations(db, user)


@router.post(
    "/conversations", response_model=ConversationRead, status_code=status.HTTP_201_CREATED
)
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> Conversation:
    conversation = Conversation(user_id=user.id, title=payload.title.strip())
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def read_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConversationDetail:
    conversation = _owned(db, user, conversation_id)
    return ConversationDetail(
        **ConversationRead.model_validate(conversation).model_dump(),
        messages=[
            ChatMessageRead.model_validate(message)
            for message in chat_service.messages_of(db, conversation)
        ],
    )


@router.patch("/conversations/{conversation_id}", response_model=ConversationRead)
def rename_conversation(
    conversation_id: int,
    payload: ConversationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> Conversation:
    conversation = _owned(db, user, conversation_id)
    title = payload.title.strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="대화 이름을 입력해 주세요."
        )
    conversation.title = title
    db.commit()
    db.refresh(conversation)
    return conversation


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> Response:
    """A real delete — see `app/models/chat.py`. Its usage events stay."""
    conversation = _owned(db, user, conversation_id)
    # Its usage events stay, detached. Done here as well as by the foreign
    # key's ON DELETE SET NULL, so it holds on any database.
    db.execute(
        update(UsageEvent)
        .where(UsageEvent.conversation_id == conversation.id)
        .values(conversation_id=None)
    )
    db.delete(conversation)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------- sending


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


#: Reply tasks still running. See `send_message`.
_RUNNING: set[asyncio.Task] = set()


def _finish(session_factory, settings: Settings, turn, state) -> chat_service.TurnResult:
    """`finish_turn` in a session of its own.

    The request's session belongs to the request, which may already be
    over by the time a stopped reply is finished. The factory is the one
    the app resolves `get_db` to, so the tests' override is honoured.
    """
    sessions = session_factory()
    db = next(sessions)
    try:
        return chat_service.finish_turn(db, settings, turn, state)
    finally:
        sessions.close()


def _message_json(message) -> dict:
    return ChatMessageRead.model_validate(message).model_dump(mode="json")


@router.post(
    "/conversations/{conversation_id}/messages",
    summary="Send a message; the reply streams back as Server-Sent Events",
    responses={200: {"content": {"text/event-stream": {}}}},
)
def send_message(
    conversation_id: int,
    payload: ChatMessageCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    conversation = _owned(db, user, conversation_id)
    provider = get_claude_provider(settings)

    try:
        turn = chat_service.prepare_turn(
            db,
            settings,
            user=user,
            conversation=conversation,
            text=payload.content,
            model_id=provider.model_id,
        )
    except chat_service.ChatRefusal as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except usage_service.InsufficientBudgetError as error:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(error)
        ) from error
    except usage_service.NoQuarterError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except pricing.PricingError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error

    session_factory = request.app.dependency_overrides.get(get_db, get_db)
    stop = asyncio.Event()
    queue: asyncio.Queue[tuple[str, object]] = asyncio.Queue()

    async def produce() -> None:
        """Talk to Claude and finish the turn — always, however it ends.

        Runs as its own task rather than inside the response, so that a
        member closing the connection can only *ask* it to stop (`stop`).
        It then saves and charges what was produced. Left inside the
        response, a disconnect at the wrong moment abandoned the turn:
        nothing saved, nothing charged, though Claude had been paid.
        """
        state = chat_service.TurnState()
        marker = chat_service.MarkerFilter()
        try:
            async for event in provider.stream_chat(turn.request):
                if isinstance(event, TextDelta):
                    state.raw_text += event.text
                    visible = marker.feed(event.text)
                    if visible:
                        queue.put_nowait(("delta", visible))
                elif isinstance(event, UsageUpdate):
                    state.input_tokens = event.input_tokens
                    state.output_tokens = event.output_tokens
                elif isinstance(event, StreamEnd):
                    state.stop_reason = event.stop_reason
                # 중지 closes the connection. Checked between pieces, so
                # Claude stops generating — and the club stops paying —
                # straight away.
                if stop.is_set():
                    state.stopped = True
                    break
        except ClaudeError as error:
            state.error = error
        except Exception as error:  # noqa: BLE001 — anything else is still a failed call
            state.error = ClaudeError(ProviderErrorKind.UNKNOWN, type(error).__name__)

        result = await run_in_threadpool(_finish, session_factory, settings, turn, state)
        if result.error is None:
            rest = marker.finish()
            if rest.strip():
                queue.put_nowait(("delta", rest))
        queue.put_nowait(("end", result))

    async def relay() -> AsyncIterator[str]:
        # Started here, not in the route body: the route runs in a worker
        # thread, and a task needs the event loop.
        task = asyncio.create_task(produce())
        # The loop keeps only a weak reference to a task; this one must
        # outlive the response it was started for.
        _RUNNING.add(task)
        task.add_done_callback(_RUNNING.discard)
        try:
            yield _sse("start", {"user_message": _message_json(turn.user_message)})
            while True:
                kind, payload = await queue.get()
                if kind == "delta":
                    yield _sse("delta", {"text": payload})
                    continue
                result: chat_service.TurnResult = payload  # type: ignore[assignment]
                if result.error is not None:
                    yield _sse("error", {"detail": str(result.error), "kind": result.error.kind})
                else:
                    yield _sse(
                        "done",
                        {
                            "message": _message_json(result.message) if result.message else None,
                            "charged_krw": result.charged_krw,
                        },
                    )
                return
        finally:
            # Reached on a normal end, on cancellation, and on close.
            # Synchronous on purpose: nothing here may wait.
            stop.set()

    return StreamingResponse(
        relay(),
        media_type="text/event-stream",
        headers={
            # `no-transform` stops anything between here and the browser
            # from compressing the stream. Next.js's /api rewrite gzips
            # responses by default, and gzip holds the pieces back until
            # the reply is finished — the member would see nothing, then
            # everything at once. Measured 2026-10-07: first piece at
            # 0.46s (the end) with gzip, 0.06s without.
            "Cache-Control": "no-cache, no-transform",
            # Tells a reverse proxy (Caddy, nginx) not to buffer the stream.
            "X-Accel-Buffering": "no",
        },
    )
