"""이미지 만들기 in Chat (image-generation).

A reply may offer an 이미지 만들기 card (`[[action:image|…]]`, see
`chat.ACTION_MARKER`). The card lists the models (`GET /chat/image-models`)
and makes one picture per press (`POST /chat/messages/{id}/images`): the
price is checked before the provider is asked, the picture is checked as
an image, and the charge, the attachment row and the stored file land
together — a refusal or a failure costs nothing.

The picture is a `ChatAttachment` on the reply that offered it, so it is
listed, shown and downloaded like any other file in the conversation, and
deleted with it.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_image_open
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import AttachmentKind, ChatAttachment, ChatMessage, User, UserRole
from app.models.chat import ChatAction, ChatRole
from app.models.usage import UsageFeature
from app.schemas.chat import AttachmentRead
from app.schemas.image import ImageCreate, ImageModelList, ImageModelRead
from app.services import attachments as attachments_service
from app.services import chat as chat_service
from app.services import feature_switches, image_catalog
from app.services import usage as usage_service
from app.services.image_provider import (
    ImageRefusedError,
    ImageRequest,
    ProviderUnavailableError,
    get_image_provider,
)
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

#: Pictures one card may make — enough to try a few, not a way to fill
#: the member's file quota from a single reply.
MAX_IMAGES_PER_CARD = 10

_FORMATS = {"PNG": ("image/png", "png"), "JPEG": ("image/jpeg", "jpg"), "WEBP": ("image/webp", "webp")}


GONE = "대화가 지워져서 그림을 붙일 수 없어요. 돈은 빠져나가지 않았어요."


def _made_on(db: Session, message_id: int) -> int:
    return (
        db.query(ChatAttachment)
        .filter(ChatAttachment.message_id == message_id, ChatAttachment.generated_model.is_not(None))
        .count()
    )


def _too_many() -> str:
    return f"이 카드에서는 이미지를 {MAX_IMAGES_PER_CARD}장까지 만들 수 있어요. 새로 물어봐 주세요."


class ImageMade(BaseModel):
    attachment: AttachmentRead
    charged_krw: int


@router.get("/image-models", response_model=ImageModelList, summary="What the 이미지 만들기 card offers")
def image_models(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> ImageModelList:
    return ImageModelList(
        models=[ImageModelRead.model_validate(m) for m in image_catalog.allowed_models(db)],
        open=user.role is UserRole.ADMIN or feature_switches.is_open(db, feature_switches.IMAGE),
        mock=settings.provider_is_mock("image"),
    )


def _offering_message(db: Session, user: User, message_id: int) -> ChatMessage:
    """The member's own reply that offered a card — anything else is a 404."""
    message = db.get(ChatMessage, message_id)
    if message is None or chat_service.owned_conversation(db, user, message.conversation_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="메시지를 찾을 수 없습니다.")
    if message.role is not ChatRole.ASSISTANT or message.action is not ChatAction.IMAGE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="이 메시지에서는 이미지를 만들 수 없습니다."
        )
    return message


@router.post(
    "/messages/{message_id}/images",
    response_model=ImageMade,
    status_code=status.HTTP_201_CREATED,
    summary="Make one picture from an 이미지 만들기 card — spends the wallet",
)
def make_image(
    message_id: int,
    payload: ImageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_image_open),
    settings: Settings = Depends(get_settings),
) -> ImageMade:
    message = _offering_message(db, user, message_id)
    made = _made_on(db, message.id)
    if made >= MAX_IMAGES_PER_CARD:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_too_many())

    prompt = " ".join(payload.prompt.split())
    if not prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="그림 설명을 적어 주세요.")
    try:
        model = image_catalog.pick_model(db, payload.model)
        chosen = image_catalog.resolve(model, payload)
    except image_catalog.SettingsError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    if payload.expected_krw is not None and payload.expected_krw != chosen.price_krw:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"가격이 바뀌었어요 — 지금은 한 장에 {chosen.price_krw:,}원이에요. 확인하고 다시 눌러 주세요.",
        )

    # Before the provider is asked: money, then room for the file.
    try:
        usage_service.ensure_affordable(db, user=user, amount_krw=chosen.price_krw, settings=settings)
    except usage_service.InsufficientBudgetError as error:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(error)) from error
    except usage_service.NoQuarterError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    if attachments_service.member_bytes(db, user.id) >= settings.chat_attachment_member_quota_mb * attachments_service.MB:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=attachments_service.QUOTA_FULL)

    try:
        result = get_image_provider(settings).generate(
            ImageRequest(
                model_id=model.model_id, prompt=prompt, size=chosen.size, aspect_ratio=chosen.aspect_ratio
            )
        )
    except ImageRefusedError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    except ProviderUnavailableError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error

    # The member may have deleted the conversation while the picture was
    # being drawn (seconds to minutes): then there is nothing to attach to.
    if chat_service.owned_conversation(db, user, message.conversation_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=GONE)

    # What came back must really be a picture; it is stored as it came
    # (full size — the reason for asking), never re-encoded into a smaller one.
    try:
        image, fmt = attachments_service.decode_image(result.data)
        width, height = image.size
    except Exception as error:  # noqa: BLE001 — anything undecodable is the provider's failure
        logger.warning("Image provider returned undecodable data: %s", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="이미지를 받지 못했어요. 다시 시도해 주세요. 돈은 빠져나가지 않았어요.",
        ) from error
    if fmt not in _FORMATS:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="이미지를 받지 못했어요. 다시 시도해 주세요. 돈은 빠져나가지 않았어요.",
        )
    media_type, extension = _FORMATS[fmt]

    if attachments_service.member_bytes(db, user.id) + len(result.data) > (
        settings.chat_attachment_member_quota_mb * attachments_service.MB
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=attachments_service.QUOTA_FULL)
    if attachments_service.total_bytes(db) + len(result.data) > settings.chat_attachment_total_limit_gb * 1024 * attachments_service.MB:
        raise HTTPException(status_code=507, detail=attachments_service.SERVER_FULL)

    row = ChatAttachment(
        user_id=user.id,
        conversation_id=message.conversation_id,
        message_id=message.id,
        kind=AttachmentKind.IMAGE,
        media_type=media_type,
        original_name=f"ctrlai-image-{message.id}-{made + 1}.{extension}",
        stored_size=len(result.data),
        width=width,
        height=height,
        # Never sent back to Claude (chat.build_context), so it adds nothing.
        estimated_tokens=0,
        generated_model=model.model_id,
        prompt=prompt,
    )
    db.add(row)
    db.flush()
    row.storage_key = attachments_service.storage_key(row)

    try:
        charged = usage_service.charge(
            db,
            user=user,
            amount_krw=chosen.price_krw,
            provider=model.provider,
            feature=UsageFeature.IMAGE_GENERATE.value,
            model_id=model.model_id,
            provider_units=1,
            provider_unit="images",
            provider_cost=chosen.usd,
            conversation_id=message.conversation_id,
            commit=False,
            settings=settings,
        )
    except usage_service.InsufficientBudgetError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(error)) from error
    except usage_service.NoQuarterError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except IntegrityError as error:
        # The conversation was deleted while the picture was being made.
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=GONE) from error

    # Counted again under the wallet lock `charge()` holds, so two presses
    # at once cannot both slip under the limit.
    if _made_on(db, message.id) > MAX_IMAGES_PER_CARD:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_too_many())

    storage = get_storage(settings)
    try:
        storage.save(row.storage_key, result.data)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        attachments_service.delete_bytes(storage, [row.storage_key])
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=GONE) from error
    except Exception:
        db.rollback()
        attachments_service.delete_bytes(storage, [row.storage_key])
        raise
    db.refresh(row)
    return ImageMade(attachment=AttachmentRead.model_validate(row), charged_krw=charged.event.charged_krw)
