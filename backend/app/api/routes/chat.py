"""Chat — a member's conversations with Claude (Phase 2).

Who may do what:

* **Reading** (the list, one conversation) needs only a signed-in member.
  A member who is not participating this quarter keeps their past
  conversations, as they keep every other piece of their work.
* **Everything that writes** — a new conversation, a message, rename or
  a change of model, delete — needs `require_active_member`, as every
  create, edit and delete route does.

Which model a reply uses is the conversation's (`chat_model_id`), chosen
from the catalogue in `services/chat_models.py`; a model this member may
not use is a Korean 400, refused before anything is spent.

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

import anyio
import anyio.from_thread
from datetime import datetime, timezone
import logging
import json
from decimal import ROUND_CEILING, Decimal
from collections.abc import AsyncIterator


from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_current_user, require_active_member
from app.services.quiet import quiet_update
from app.api.uploads import clean_upload_name, file_response, read_upload_body
from app.core.config import Settings, get_settings
from app.db.session import get_db, release_before_stream
from app.models import (
    ChatRun,
    AttachmentKind,
    ChatAttachment,
    ChatModel,
    ChatModelVisibility,
    Conversation,
    ProviderErrorKind,
    UsageEvent,
    User,
)
from app.schemas.chat import (
    AttachmentEstimate,
    AttachmentRead,
    AttachmentUploaded,
    MAX_MESSAGE_LENGTH,
    ChatInfo,
    ChatModelOption,
    ChatMessageCreate,
    ChatMessageRead,
    ConversationCreate,
    ConversationDetail,
    ConversationRead,
    ConversationPinSet,
    ConversationUpdate,
    LiveRunRead,
    LongHistoryRead,
    ReplyReceipt,
    RunningRead,
    StopRead,
)
from app.schemas.builder import EmptyBody
from app.services import chat_runs, depth as depth_service
from app.services import attachments as attachments_service
from app.services import chat as chat_service
from app.services import chat_limits, chat_tools, provider_limiter
from app.services import chat_models, pricing
from app.services import usage as usage_service
from app.services.storage import get_storage
from app.services.claude_provider import (
    ClaudeError,
    StreamEnd,
    TextDelta,
    ThinkingDelta,
    ToolSources,
    ToolStatus,
    UsageUpdate,
    get_claude_provider,
)

#: Content types a browser may send cross-origin without a preflight —
#: refused for every POST by `JsonOnlyMiddleware`; checked here again so
#: the upload route is safe on its own.

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

NOT_FOUND = "대화를 찾을 수 없습니다."


def _owned(db: Session, user: User, conversation_id: int) -> Conversation:
    conversation = chat_service.owned_conversation(db, user, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return conversation


def _model_error(error: chat_models.ModelChoiceError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=str(error))


def _receipts_for(db: Session, messages: list) -> dict[int, ReplyReceipt]:
    """Each reply's ledger figures, by usage-event id (live-cost-display).

    One query for the whole conversation. A reply whose event is gone —
    or that never had one (a refusal) — simply has no receipt.
    """
    # feat-auto-continue: a reply written in several calls adds up every
    # call's event; the receipt is keyed by the first (`usage_event_id`).
    groups = {
        m.usage_event_id: list(m.segment_event_ids or [m.usage_event_id])
        for m in messages
        if m.usage_event_id is not None
    }
    if not groups:
        return {}
    return {
        first: ReplyReceipt(**figures)
        for first, figures in chat_service.receipts_for_groups(db, groups).items()
    }


@router.get(
    "/info", response_model=ChatInfo, summary="How replies are made, and the models to pick from"
)
def chat_info(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> ChatInfo:
    rate = pricing.current_rate(db)
    default = chat_models.default_row(db)
    limits = chat_limits.current(db)
    member_default = user.default_chat_model_id
    if member_default is not None and not any(row.id == member_default for row in chat_models.models_for(db, user)):
        member_default = None
    return ChatInfo(
        is_mock=settings.provider_is_mock("claude"),
        rate_limit_per_minute=settings.chat_rate_limit_per_minute,
        max_message_length=MAX_MESSAGE_LENGTH,
        web_fetch_max_uses=limits.web_fetch_max_uses,
        web_fetch_max_content_tokens=limits.web_fetch_max_content_tokens,
        web_search_max_uses=limits.web_search_max_uses,
        models=[_option(db, row, default, rate, limits) for row in chat_models.models_for(db, user)],
        default_model_id=default.id if default else None,
        member_default_model_id=member_default,
        member_default_depth=user.default_depth or depth_service.DEFAULT_LEVEL,
    )


def _option(db: Session, row, default, rate, limits=None) -> ChatModelOption:
    chosen = chat_models.ChosenModel.of(row)
    estimate = pricing.reply_estimate(db, chosen, rate)
    thinking = pricing.thinking_estimate(db, chosen, rate)
    fetch_krw, code_krw = pricing.tool_use_krw(chosen, rate)
    search_krw = None
    if rate is not None:
        search_krw = int(
            (Decimal(row.web_search_usd_per_call) * Decimal(rate.krw_per_unit)).to_integral_value(
                rounding=ROUND_CEILING
            )
        )
    return ChatModelOption(
        id=row.id,
        model_id=row.model_id,
        label=row.label,
        description=row.description,
        admin_only=row.visibility is ChatModelVisibility.ADMIN,
        is_default=default is not None and row.id == default.id,
        estimated_reply_krw=estimate.krw,
        estimate_basis=estimate.basis,
        estimate_samples=estimate.samples,
        tools_web_search=row.tools_web_search,
        tools_web_fetch=row.tools_web_fetch,
        tools_code_execution=row.tools_code_execution,
        web_search_krw_per_call=search_krw,
        web_fetch_krw_per_use=fetch_krw,
        code_execution_krw_per_use=code_krw,
        thinking_extra_krw=thinking.krw,
        thinking_basis=thinking.basis,
        levels=depth_service.options(
            limits.depth_levels if limits else None, "chat", row.model_id, estimate.krw
        ),
        flat_max_krw=depth_service.table(limits.depth_levels if limits else None, "chat")[
            depth_service.DEFAULT_LEVEL
        ].cap_krw,
        depth_note=depth_service.note_for(row.model_id),
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
    settings: Settings = Depends(get_settings),
) -> Conversation:
    if payload.chat_model_id is not None:
        try:
            model_id: int | None = chat_models.checked_choice(db, user, payload.chat_model_id).id
        except chat_models.ModelChoiceError as error:
            raise _model_error(error) from error
    else:
        # The member's own default (Profile › 기본 모델) while they may use
        # it, else the catalogue's.
        mine = db.get(ChatModel, user.default_chat_model_id) if user.default_chat_model_id else None
        default = mine if mine is not None and chat_models.may_use(mine, user) else chat_models.default_row(db)
        model_id = default.id if default else None
    conversation = Conversation(
        user_id=user.id, title=payload.title.strip(), chat_model_id=model_id
    )
    # The welcome screen's 도구 choices (fix-new-chat-tools): a tool is
    # turned on only when the chosen model allows it, exactly as PATCH.
    wanted = {
        "use_web_search": payload.use_web_search,
        "use_web_fetch": payload.use_web_fetch,
        "use_code_execution": payload.use_code_execution,
    }
    if any(wanted.values()):
        try:
            model = chat_models.for_conversation(db, settings, user, conversation)
        except chat_models.ModelChoiceError as error:
            raise _model_error(error) from error
        allowed = {
            "use_web_search": model.tools_web_search,
            "use_web_fetch": model.tools_web_fetch,
            "use_code_execution": model.tools_code_execution,
        }
        for field, value in wanted.items():
            if value and not allowed[field]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="이 모델에서는 쓸 수 없는 도구입니다. 모델을 바꾸거나 도구를 꺼 주세요.",
                )
            setattr(conversation, field, value)
    conversation.show_thinking = payload.show_thinking
    # 생각 깊이 (quality-tuning Q1): the welcome screen's choice, else the
    # member's default. A name only — never a number.
    conversation.depth = payload.depth or user.default_depth
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def read_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> ConversationDetail:
    conversation = _owned(db, user, conversation_id)
    # background-runs: first, so a reply a restart cut is saved and listed.
    live = chat_runs.current(db, user, conversation.id)
    messages = chat_service.messages_of(db, conversation)
    # The composer's long-history warning (token-guard). A model or price
    # problem never breaks reading a conversation — the warning just stays
    # away, and sending will say what is wrong.
    long_history = None
    try:
        model = chat_models.for_conversation(db, settings, user, conversation)
        long_history = chat_service.long_history_info(db, settings, messages, model)
    except (chat_models.ModelChoiceError, pricing.PricingError):
        long_history = None
    receipts = _receipts_for(db, messages)
    return ConversationDetail(
        **ConversationRead.model_validate(conversation).model_dump(),
        messages=[
            ChatMessageRead.model_validate(message).model_copy(
                update={"receipt": receipts.get(message.usage_event_id)}
            )
            for message in messages
        ],
        long_history=(
            LongHistoryRead(
                history_tokens=long_history.history_tokens,
                extra_krw=long_history.extra_krw,
            )
            if long_history
            else None
        ),
        running=(
            LiveRunRead(run_id=live.id, text=live.text, thinking=live.thinking, started_at=live.started_at)
            if live is not None
            else None
        ),
    )


@router.patch("/conversations/{conversation_id}", response_model=ConversationRead)
def update_conversation(
    conversation_id: int,
    payload: ConversationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> Conversation:
    """Rename, change the model, or flip a tool toggle. Later replies only."""
    conversation = _owned(db, user, conversation_id)
    toggles = {
        "use_web_search": payload.use_web_search,
        "use_web_fetch": payload.use_web_fetch,
        "use_code_execution": payload.use_code_execution,
    }
    if (
        payload.title is None
        and payload.chat_model_id is None
        and payload.show_thinking is None
        and payload.depth is None
        and all(value is None for value in toggles.values())
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="바꿀 내용을 보내 주세요."
        )
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="대화 이름을 입력해 주세요."
            )
        conversation.title = title
    if payload.chat_model_id is not None:
        try:
            conversation.chat_model_id = chat_models.checked_choice(
                db, user, payload.chat_model_id
            ).id
        except chat_models.ModelChoiceError as error:
            raise _model_error(error) from error
    if payload.depth is not None:
        conversation.depth = payload.depth
    if any(value is not None for value in toggles.values()):
        # Turning a tool ON needs the conversation's model to allow it —
        # otherwise the toggle would promise something no reply delivers.
        # Turning one OFF is always allowed.
        try:
            model = chat_models.for_conversation(db, settings, user, conversation)
        except chat_models.ModelChoiceError as error:
            raise _model_error(error) from error
        allowed = {
            "use_web_search": model.tools_web_search,
            "use_web_fetch": model.tools_web_fetch,
            "use_code_execution": model.tools_code_execution,
        }
        for field, value in toggles.items():
            if value is None:
                continue
            if value and not allowed[field]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="이 모델에서는 쓸 수 없는 도구입니다. 모델을 바꾸거나 도구를 꺼 주세요.",
                )
            setattr(conversation, field, value)
    if payload.show_thinking is not None:
        # Every current Claude model can show its thinking, so this needs
        # no per-model check; what it costs is on the toggle.
        conversation.show_thinking = payload.show_thinking
    db.commit()
    db.refresh(conversation)
    return conversation


@router.post(
    "/conversations/{conversation_id}/pin",
    response_model=ConversationRead,
    summary="맨 위에 고정 / 고정 해제 (chat-pins)",
)
def set_pinned(
    conversation_id: int,
    payload: ConversationPinSet,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Conversation:
    """The same 고정 as a Builder or Video project: a reading preference of
    the owner, open while not participating, `updated_at` and
    `last_message_at` untouched — a pin never moves a conversation's date.
    The timestamp orders the 고정됨 group (newest pin first)."""
    conversation = _owned(db, user, conversation_id)
    quiet_update(db, conversation, pinned_at=datetime.now(timezone.utc) if payload.on else None)
    db.commit()
    db.refresh(conversation)
    return conversation


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
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
    # Its files go with it: the rows here, the bytes once the delete has
    # committed (chat-plus-files).
    files = list(
        db.scalars(select(ChatAttachment).where(ChatAttachment.conversation_id == conversation.id))
    )
    keys = [row.storage_key for row in files if row.storage_key]
    for row in files:
        db.delete(row)
    db.delete(conversation)
    db.commit()
    attachments_service.delete_bytes(get_storage(settings), keys)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------- attachments


def _estimate(db: Session, settings: Settings, user: User, conversation: Conversation) -> AttachmentEstimate:
    """What the files waiting in the composer add, for this conversation's model."""
    tokens = sum(
        row.estimated_tokens
        for row in attachments_service.pending_for(db, user.id, conversation.id)
    )
    try:
        model = chat_models.for_conversation(db, settings, user, conversation)
        price = pricing.price_for(db, model, cache_ttl=settings.cache_ttl)
        reply = pricing.reply_estimate(db, model, pricing.current_rate(db)).krw
    except (chat_models.ModelChoiceError, pricing.PricingError):
        return AttachmentEstimate(tokens=tokens, with_files_krw=None, each_later_krw=None)
    if not tokens:
        return AttachmentEstimate(tokens=0, with_files_krw=reply, each_later_krw=0)
    # The first reply writes the files to the cache (or pays full input
    # with caching off); each later reply re-reads them.
    cached = settings.cache_ttl is not None
    first = price.krw(0 if cached else tokens, 0, tokens if cached else 0, 0)
    later = price.krw(0 if cached else tokens, 0, 0, tokens if cached else 0)
    return AttachmentEstimate(
        tokens=tokens,
        with_files_krw=(reply or 0) + first if reply is not None else None,
        each_later_krw=later,
    )


def _owned_attachment(db: Session, user: User, attachment_id: int) -> ChatAttachment:
    row = db.get(ChatAttachment, attachment_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="파일을 찾을 수 없습니다.")
    return row


@router.post(
    "/conversations/{conversation_id}/attachments",
    response_model=AttachmentUploaded,
    status_code=status.HTTP_201_CREATED,
    summary="Attach one file to the next message (the body is the file's bytes)",
)
async def upload_attachment(
    conversation_id: int,
    request: Request,
    name: str = Query(min_length=1, max_length=255),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> AttachmentUploaded:
    """One file per request, its bytes as the body and its name in `?name=`.

    Read only up to the largest limit plus one byte: a larger upload is
    refused without being held in memory. Checked completely — kind, size,
    pages, count, quotas — before anything is stored.
    """
    conversation = _owned(db, user, conversation_id)
    largest = max(
        settings.chat_attachment_image_max_mb,
        settings.chat_attachment_pdf_max_mb,
        settings.chat_attachment_text_max_mb,
    )
    data = await read_upload_body(
        request,
        largest * attachments_service.MB,
        attachments_service.too_big(largest),
        "파일은 application/octet-stream 형식으로 보내 주세요.",
    )
    original = clean_upload_name(name, "file")

    try:
        checked = await run_in_threadpool(attachments_service.check_file, original, data, settings)
        attachments_service.check_room(db, user.id, conversation.id, checked, settings)
    except attachments_service.AttachmentRefusal as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=str(refusal)) from refusal

    row = ChatAttachment(
        user_id=user.id,
        conversation_id=conversation.id,
        kind=checked.kind,
        media_type=checked.media_type,
        original_name=original,
        stored_size=len(checked.data),
        page_count=checked.page_count,
        width=checked.width,
        height=checked.height,
        estimated_tokens=checked.estimated_tokens,
    )
    db.add(row)
    db.flush()
    row.storage_key = attachments_service.storage_key(row)
    get_storage(settings).save(row.storage_key, checked.data)
    db.commit()
    db.refresh(row)
    return AttachmentUploaded(
        attachment=AttachmentRead.model_validate(row),
        estimate=_estimate(db, settings, user, conversation),
    )


@router.get(
    "/conversations/{conversation_id}/attachments/estimate",
    response_model=AttachmentEstimate,
    summary="What the files waiting in the composer add",
)
def attachment_estimate(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> AttachmentEstimate:
    return _estimate(db, settings, user, _owned(db, user, conversation_id))


@router.get(
    "/conversations/{conversation_id}/attachments/pending",
    response_model=list[AttachmentRead],
    summary="Files uploaded and not sent yet",
)
def pending_attachments(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ChatAttachment]:
    conversation = _owned(db, user, conversation_id)
    return attachments_service.pending_for(db, user.id, conversation.id)


@router.delete(
    "/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a file not sent yet (✕ in the composer)",
)
def delete_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> Response:
    row = _owned_attachment(db, user, attachment_id)
    if row.message_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 보낸 파일은 지울 수 없습니다. 대화를 지우면 함께 지워집니다.",
        )
    key = row.storage_key
    db.delete(row)
    db.commit()
    attachments_service.delete_bytes(get_storage(settings), [key])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/attachments/{attachment_id}/file", summary="The stored copy of an attached file")
def attachment_file(
    attachment_id: int,
    download: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The member's own file — read and download work while not taking part
    this quarter. Images are shown inline (the bubble's thumbnail) unless
    `download`; everything else is always a download."""
    row = _owned_attachment(db, user, attachment_id)
    try:
        data = get_storage(settings).load(row.storage_key)
    except (FileNotFoundError, OSError) as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="파일을 찾을 수 없습니다.") from error
    inline = row.kind is AttachmentKind.IMAGE and not download
    media_type = row.media_type if row.kind in (AttachmentKind.IMAGE, AttachmentKind.PDF) else "application/octet-stream"
    return file_response(data, media_type, row.original_name, inline)


# ------------------------------------------------------------- sending


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


#: Seconds without a reply event before the stream sends a keepalive
#: comment. Well under the Next.js proxy's 30-second idle limit.
KEEPALIVE_SECONDS = 10.0

#: Reply tasks still running. See `send_message`.
_RUNNING: set[asyncio.Task] = set()

#: background-runs: this process's running replies, so 중지 that reaches
#: the same process stops at once (another process sees the row's flag
#: within `chat_runs.FLUSH_SECONDS`).
_STOPS: dict[int, tuple[asyncio.AbstractEventLoop, asyncio.Event]] = {}


def _in_session(session_factory, work):
    """Run `work(db)` in a session of its own.

    The request's session belongs to the request, which may already be
    over by the time a stopped reply is finished. The factory is the one
    the app resolves `get_db` to, so the tests' override is honoured.
    """
    sessions = session_factory()
    db = next(sessions)
    try:
        return work(db)
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
    # background-runs: one running reply per member — the row other pages
    # and processes see (the text so far, 중지, the running dot).
    try:
        run = chat_runs.begin(db, user, conversation)
    except chat_runs.RunRefused as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    run_id = run.id

    try:
        # Checked before anything else: a model this member may not use is
        # refused whatever the budget says.
        model = chat_models.for_conversation(db, settings, user, conversation)
        chat_models.require_adapter(model)
        provider = get_claude_provider(settings)
        storage = get_storage(settings)
        turn = chat_service.prepare_turn(
            db,
            settings,
            user=user,
            conversation=conversation,
            text=payload.content,
            model=model,
            is_mock=settings.provider_is_mock("claude"),
            attachment_ids=payload.attachment_ids,
            load=lambda row: storage.load(row.storage_key),
        )
    except Exception as error:
        # Refused before Claude was called: there is no run.
        db.rollback()
        chat_runs.abandon(db, run_id)
        if isinstance(error, chat_models.ModelChoiceError):
            raise _model_error(error) from error
        if isinstance(error, chat_service.ChatRefusal):
            raise HTTPException(status_code=error.status_code, detail=str(error)) from error
        if isinstance(error, usage_service.InsufficientBudgetError):
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(error)) from error
        if isinstance(error, usage_service.NoQuarterError):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
        if isinstance(error, pricing.PricingError):
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
        raise
    chat_runs.attach_user_message(db, run_id, turn.user_message.id)

    # PART F: the club has one key; one process keeps at most this many
    # provider calls in flight. Read here, while the request's session is
    # open; checked just before the stream starts.
    concurrency_limit = chat_limits.current(db).provider_concurrency

    session_factory = request.app.dependency_overrides.get(get_db, get_db)
    # One database step of this reply at a time — the reply's task and its
    # flusher both write; never two of them on one session at once.
    db_turns = asyncio.Lock()

    async def in_db(work):
        async with db_turns:
            return await run_in_threadpool(_in_session, session_factory, work)

    stop = asyncio.Event()
    queue: asyncio.Queue[tuple[str, object]] = asyncio.Queue()
    # background-runs: what the reply shows so far, for the run row (other
    # pages re-attach to it), and the end of the task for the flusher.
    shown = {"text": "", "thinking": ""}
    finished = asyncio.Event()

    def show(kind: str, piece: str) -> None:
        shown["text" if kind == "delta" else "thinking"] += piece
        queue.put_nowait((kind, piece))

    async def flusher() -> None:
        """Every half second: the text so far and a heartbeat into the run
        row, and 중지 out of it — pressed on this page or any other, in
        this process or the other one."""
        while not finished.is_set():
            try:
                await asyncio.wait_for(finished.wait(), chat_runs.FLUSH_SECONDS)
                return
            except asyncio.TimeoutError:
                pass
            text, thinking = shown["text"], shown["thinking"]
            try:
                asked = await in_db(lambda db: chat_runs.flush(db, run_id, text, thinking)
                )
            except Exception:  # noqa: BLE001 — a missed beat is retried in half a second
                logger.exception("flushing chat run %s failed", run_id)
                continue
            if asked:
                stop.set()

    async def end_run(result: chat_service.TurnResult) -> None:
        """The row says how the reply ended — after it was saved and charged."""
        finished.set()
        message = result.message
        if message is None:
            state = "failed"
        elif getattr(message.status, "value", message.status) == "stopped":
            state = "stopped"
        else:
            state = "done"
        try:
            await in_db(lambda db: chat_runs.finish(
                    db,
                    run_id,
                    state,
                    message_id=message.id if message is not None else None,
                    text=message.content if message is not None else shown["text"],
                    thinking=shown["thinking"],
                    error=str(result.error) if result.error is not None else "",
                ),
            )
        except Exception:  # noqa: BLE001 — the sweep ends it later
            logger.exception("ending chat run %s failed", run_id)

    async def produce() -> None:
        """Talk to Claude and finish the turn — always, however it ends.

        Runs as its own task rather than inside the response, so that a
        member closing the connection can only *ask* it to stop (`stop`).
        It then saves and charges what was produced. Left inside the
        response, a disconnect at the wrong moment abandoned the turn:
        nothing saved, nothing charged, though Claude had been paid.

        feat-auto-continue (owner-polish 11): a call that stops at
        `max_tokens` is **continued by the server** — the partial goes back
        as the assistant's turn with `CONTINUE_PROMPT`, under the same
        per-call cap, each call charged on its own with the wallet checked
        first — until the reply ends, the member presses 중지, the whole
        reply reaches the admin's 전체 한도, or the wallet runs short. The
        pieces are saved and shown as one reply.
        """
        marker = chat_service.MarkerFilter()
        # background-runs: the run's liveness lock, held on a connection of
        # its own until the run row says how it ended — the sweep never ends
        # a reply whose process is alive, however late its heartbeat.
        bind = await in_db(lambda db: db.get_bind())
        liveness = await run_in_threadpool(chat_runs.hold, bind, chat_runs.CHAT_LOCK, run_id)
        try:
            await produce_turn(marker)
        finally:
            await run_in_threadpool(chat_runs.release, liveness, chat_runs.CHAT_LOCK, run_id)

    async def produce_turn(marker) -> None:
        # A slot under the process-wide provider limit, waited for off the
        # event loop. Refused: a BUSY error — the provider was never
        # called, nothing is charged, and the status board is not marked.
        if not await run_in_threadpool(provider_limiter.acquire, concurrency_limit):
            state = chat_service.TurnState()
            state.error = ClaudeError(ProviderErrorKind.BUSY, "provider concurrency limit")
            result = await in_db(lambda db: chat_service.finish_turn(db, settings, turn, state)
            )
            await end_run(result)
            queue.put_nowait(("end", result))
            return

        beat = asyncio.create_task(flusher())
        _RUNNING.add(beat)
        beat.add_done_callback(_RUNNING.discard)
        segments: list[chat_service.SegmentCharge] = []
        request = turn.request
        estimated_input = turn.estimated_input_tokens
        stop_reason: chat_service.ContinuationStop | None = None
        error: ClaudeError | None = None
        try:
            while True:
                state = chat_service.TurnState()
                try:
                    async for event in provider.stream_chat(request):
                        if isinstance(event, TextDelta):
                            state.raw_text += event.text
                            visible = marker.feed(event.text)
                            if visible:
                                show("delta", visible)
                        elif isinstance(event, ThinkingDelta):
                            # 생각 과정 보기 (chat-thinking-view): shown as it comes,
                            # saved with the reply, never sent back to Claude.
                            state.thinking += event.text
                            show("thinking", event.text)
                        elif isinstance(event, UsageUpdate):
                            state.input_tokens = event.input_tokens
                            state.output_tokens = event.output_tokens
                            state.cache_write_tokens = event.cache_write_tokens
                            state.cache_read_tokens = event.cache_read_tokens
                            state.web_search_count = event.web_search_count
                            state.web_fetch_count = event.web_fetch_count
                        elif isinstance(event, ToolStatus):
                            # 검색 중… / 페이지 읽는 중… / 코드 실행 중… — the
                            # screen's line while a server tool runs. A finished
                            # use carries what it just added in won, so the
                            # running 약 N원 jumps the moment it lands (the
                            # ledger's receipt still settles the real figure).
                            added = 0
                            if event.status == "done" and (event.result_tokens or event.searches):
                                added = turn.price.krw(event.result_tokens, 0) + (
                                    chat_tools.search_fee_krw(
                                        turn.price, turn.web_search_usd_per_call, event.searches
                                    )
                                )
                            queue.put_nowait(
                                ("tool", {"kind": event.kind, "status": event.status, "added_krw": added})
                            )
                        elif isinstance(event, ToolSources):
                            state.sources = [
                                {
                                    "title": source[0],
                                    "url": source[1],
                                    "cited": bool(source[2]) if len(source) > 2 else False,
                                }
                                for source in event.sources
                            ]
                        elif isinstance(event, StreamEnd):
                            state.stop_reason = event.stop_reason
                        # 중지 closes the connection. Checked between pieces, so
                        # Claude stops generating — and the club stops paying —
                        # straight away.
                        if stop.is_set():
                            state.stopped = True
                            break
                except ClaudeError as caught:
                    state.error = caught
                except Exception as caught:  # noqa: BLE001 — anything else is still a failed call
                    state.error = ClaudeError(ProviderErrorKind.UNKNOWN, type(caught).__name__)

                if state.error is not None:
                    error = state.error
                    break
                # This call's charge — one `usage.charge()` per call, as always.
                segment = await in_db(lambda db, st=state, est=estimated_input: chat_service.settle_segment(
                        db, settings, turn, st, estimated_input_tokens=est
                    ),
                )
                segments.append(segment)
                if state.stopped or state.stop_reason != "max_tokens":
                    break
                # 중지 while the call was being settled: no next call — the
                # reply is 중지됨 at what was written (security review).
                if stop.is_set():
                    state.stopped = True
                    break
                # Cut by the call cap: plan the next call, or say why not.
                raw_so_far = "".join(part.state.raw_text for part in segments)
                # What the member saw taken (the screen's 지금까지 N원) and
                # what the calls really cost — the ceiling is held against
                # the cost, so a charge the wallet could only part-cover
                # does not make room for another call.
                charged_so_far = sum(part.charged_krw for part in segments)
                cost_so_far = sum(part.cost_krw for part in segments)
                # The provider's own figures for the call just made (its
                # input, cached or not, plus what it wrote) are the next
                # call's input — tighter than re-estimating.
                measured = (
                    segment.input_tokens + segment.cache_write_tokens + segment.cache_read_tokens
                ) if (segment.input_tokens or segment.cache_write_tokens or segment.cache_read_tokens) else 0
                plan = await in_db(lambda db: chat_service.plan_continuation(
                        db, settings, turn, raw_so_far, cost_so_far,
                        measured_input_tokens=measured, calls_so_far=len(segments),
                        raw_last_call=segment.state.raw_text,
                    ),
                )
                if isinstance(plan, chat_service.ContinuationStop):
                    stop_reason = plan
                    break
                if stop.is_set():
                    state.stopped = True
                    break
                request = plan.request
                estimated_input = plan.estimated_input_tokens
                queue.put_nowait(
                    (
                        "continue",
                        {
                            "segment": len(segments) + 1,
                            "charged_so_far_krw": charged_so_far,
                            "estimate": {
                                "base_krw": plan.estimate_base_krw,
                                "won_per_1k_output": turn.won_per_1k_output,
                            },
                        },
                    )
                )
        finally:
            provider_limiter.release()

        try:
            if error is not None and not segments:
                failed = chat_service.TurnState()
                failed.error = error
                result = await in_db(lambda db: chat_service.finish_turn(db, settings, turn, failed)
                )
                await end_run(result)
                queue.put_nowait(("end", result))
                return
            if error is not None:
                # A continuation failed after earlier calls were paid: keep what
                # was written — the failed call's text too, since the screen
                # already showed it (charged nothing) — as a cut reply, say why,
                # and tell the status board.
                segments.append(chat_service.unsettled_segment(state))
                stop_reason = chat_service.ContinuationStop(
                    "error",
                    f"답장을 이어 쓰다 오류가 났어요: {error} 여기까지 저장했고, 오류가 난 부분은 청구되지 않았어요.",
                )
            result = await in_db(lambda db: chat_service.save_reply(db, settings, turn, segments, stop=stop_reason, error=error),
            )
        except Exception:  # noqa: BLE001 — a bug here must not leave the member's stream hanging
            logger.exception("finishing a chat turn failed")
            result = chat_service.TurnResult(
                message=None, charged_krw=0, error=ClaudeError(ProviderErrorKind.UNKNOWN, "finish failed")
            )
        if result.error is None:
            rest = marker.finish()
            if rest.strip():
                show("delta", rest)
        await end_run(result)
        queue.put_nowait(("end", result))

    def start() -> None:
        """Runs on the event loop (the route itself runs in a worker
        thread). Started here, before the response — a page that goes away
        before the first byte must not leave a run that nothing produces."""
        _STOPS[run_id] = (asyncio.get_running_loop(), stop)
        task = asyncio.create_task(produce())
        task.add_done_callback(lambda _task: _STOPS.pop(run_id, None))
        # However the task ends, the flusher stops beating (a run whose task
        # died without saying so is ended by the sweep).
        task.add_done_callback(lambda _task: finished.set())
        # The loop keeps only a weak reference to a task; this one must
        # outlive the response it was started for.
        _RUNNING.add(task)
        task.add_done_callback(_RUNNING.discard)

    anyio.from_thread.run_sync(start)

    async def relay() -> AsyncIterator[str]:
        try:
            yield _sse(
                "start",
                {
                    "user_message": _message_json(turn.user_message),
                    # The running-cost estimate's two halves
                    # (live-cost-display); the screen adds 글자 수 × rate
                    # and labels the sum 약.
                    "estimate": {
                        "base_krw": turn.estimate_base_krw,
                        "won_per_1k_output": turn.won_per_1k_output,
                    },
                },
            )
            while True:
                try:
                    kind, payload = await asyncio.wait_for(queue.get(), KEEPALIVE_SECONDS)
                except asyncio.TimeoutError:
                    # Nothing from Claude for a while — a server-side search
                    # or fetch is running. An SSE comment keeps every hop
                    # (Caddy, the Next.js /api proxy, which drops a request
                    # after 30 s without data) from closing the stream;
                    # the browser's reader ignores it (fix-real-web-search).
                    yield ": keepalive\n\n"
                    continue
                if kind == "delta":
                    yield _sse("delta", {"text": payload})
                    continue
                if kind == "tool":
                    yield _sse("tool", payload)  # type: ignore[arg-type]
                    continue
                if kind == "thinking":
                    yield _sse("thinking", {"text": payload})
                    continue
                if kind == "continue":
                    # feat-auto-continue: the server goes on by itself — the
                    # screen shows "이어서 쓰는 중… 지금까지 N원".
                    yield _sse("continue", payload)  # type: ignore[arg-type]
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
                            # The receipt's split and the wallet after the
                            # charge (live-cost-display) — the ledger's
                            # figures, never the estimate's.
                            "usage": (
                                {
                                    "input_tokens": result.usage.input_tokens,
                                    "output_tokens": result.usage.output_tokens,
                                    "cache_write_tokens": result.usage.cache_write_tokens,
                                    "cache_read_tokens": result.usage.cache_read_tokens,
                                    # chat-plus-tools: the receipt's 검색 line.
                                    "web_search_count": result.usage.web_search_count,
                                    "tool_fee_krw": result.usage.tool_fee_krw,
                                    # chat-thinking-view: the receipt's note.
                                    "thinking_shown": result.usage.thinking_shown,
                                    # cost-clarity: the same reply by part,
                                    # in won, from the ledger row.
                                    **(result.usage.split or {}),
                                }
                                if result.usage
                                else None
                            ),
                            "wallet_remaining_krw": result.wallet_remaining_krw,
                            # feat-auto-continue: how many calls wrote the
                            # reply, and why the server stopped continuing.
                            "segments": result.segments,
                            "stop_note": result.stop_note,
                            # token-guard: the composer's warning, fresh
                            # after this reply, without refetching.
                            "long_history": (
                                {
                                    "history_tokens": result.long_history.history_tokens,
                                    "extra_krw": result.long_history.extra_krw,
                                }
                                if result.long_history
                                else None
                            ),
                        },
                    )
                return
        finally:
            # background-runs: leaving the page (a closed connection) no
            # longer stops the reply — only 중지 does (`stop_reply`). The
            # task finishes, saves and charges as it would have.
            pass

    release_before_stream(db, request)
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


# ------------------------------------------------------------- background-runs


@router.get("/running", response_model=RunningRead, summary="What is running now: the live reply and builds")
def running(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> RunningRead:
    """background-runs: the running dots on the Chat list, the sidebar and
    the Builder cards come from here, not from the page — a reply or a
    build keeps going after the member leaves."""
    found = chat_runs.running_for(db, user)
    return RunningRead(conversations=found.conversations, projects=found.projects)


@router.post(
    "/conversations/{conversation_id}/stop",
    response_model=StopRead,
    summary="중지: stop the reply being written (from this page or any other)",
)
def stop_reply(
    conversation_id: int,
    payload: EmptyBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StopRead:
    """Leaving the page no longer stops a reply; this does. The reply is
    saved with what was written and charged for what was produced, as 중지
    always was. Any member may stop their own reply, taking part or not —
    stopping only ever saves money."""
    conversation = _owned(db, user, conversation_id)
    run = chat_runs.request_stop(db, user, conversation.id)
    if run is None:
        return StopRead(stopping=False)
    local = _STOPS.get(run.id)
    if local is not None:
        loop, event = local
        loop.call_soon_threadsafe(event.set)
    return StopRead(stopping=True)


#: How often a re-attached page reads the run row.
LIVE_POLL_SECONDS = 0.4


@router.get(
    "/conversations/{conversation_id}/live",
    summary="Re-attach to a reply still being written (Server-Sent Events)",
    responses={200: {"content": {"text/event-stream": {}}}},
)
def follow_reply(
    conversation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """background-runs: a page that comes back mid-reply reads the run row —
    `snapshot` (the text so far), then `delta` / `thinking` as it grows,
    then `done` (the saved message's id; the page reloads the conversation
    for the receipt) or `error`. Read only: nothing here charges, so
    watching a reply from two tabs never charges it twice. 204 when
    nothing is running."""
    conversation = _owned(db, user, conversation_id)
    run = chat_runs.current(db, user, conversation.id)
    if run is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    run_id = run.id
    user_id = user.id
    session_factory = request.app.dependency_overrides.get(get_db, get_db)

    def read(db: Session):
        db.expire_all()
        row = db.get(ChatRun, run_id)
        if row is not None and row.status == "running" and not chat_runs.is_fresh(row):
            member = db.get(User, user_id)
            if member is not None:
                chat_runs.sweep(db, user_id=member.id)
            row = db.get(ChatRun, run_id)
        if row is None:
            return None
        return (row.status, row.text, row.thinking, row.message_id, row.error)

    async def watch() -> AsyncIterator[str]:
        sent_text = 0
        sent_thinking = 0
        quiet = 0.0
        first = True
        while True:
            seen = await run_in_threadpool(_in_session, session_factory, read)
            if seen is None:
                yield _sse("error", {"detail": "답장을 찾을 수 없어요."})
                return
            state, text, thinking, message_id, error = seen
            if first:
                yield _sse("snapshot", {"text": text, "thinking": thinking})
                sent_text, sent_thinking, first = len(text), len(thinking), False
            else:
                if len(thinking) > sent_thinking:
                    yield _sse("thinking", {"text": thinking[sent_thinking:]})
                    sent_thinking = len(thinking)
                    quiet = 0.0
                if len(text) > sent_text:
                    yield _sse("delta", {"text": text[sent_text:]})
                    sent_text = len(text)
                    quiet = 0.0
            if state != "running":
                if message_id is not None:
                    yield _sse("done", {"message_id": message_id, "status": state})
                else:
                    yield _sse("error", {"detail": error or "답장을 저장하지 못했어요."})
                return
            await asyncio.sleep(LIVE_POLL_SECONDS)
            quiet += LIVE_POLL_SECONDS
            if quiet >= KEEPALIVE_SECONDS:
                yield ": keepalive\n\n"
                quiet = 0.0

    release_before_stream(db, request)
    return StreamingResponse(
        watch(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )

