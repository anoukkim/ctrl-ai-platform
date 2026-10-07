"""Admin › Claude Models — the chat model catalogue (chat-model-choice).

Which models members may pick in Chat, what each costs, and which one is
the default. Every change is written to the audit log with both sides:
a price, who may pick a model, and the default all move what members
spend.

Two rules keep the catalogue usable, enforced here:

* **There is always a default, and it is open to members.** Setting
  `is_default` makes a model the default (and only one model is); a
  model can only become the default while it is open to members; and the
  default cannot be closed or made admin-only — choose another default
  first. Unsetting the flag directly is refused for the same reason.
* **A model is never deleted.** Past replies and usage events name it;
  `disabled` takes it out of every picker instead.

Admin-only, and — like every other Admin screen — not gated on
participation.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import AuditAction, ChatModel, ChatModelVisibility, User
from app.schemas.pricing import ChatModelAdminRead, ChatModelCreate, ChatModelUpdate
from app.services import audit, chat_models, pricing

router = APIRouter(prefix="/admin/chat-models", tags=["admin"])

#: A provider model id: lower-case letters, digits, dots and dashes.
MODEL_ID = re.compile(r"^[a-z0-9][a-z0-9.\-]{1,119}$")

VISIBILITY_LABEL = {
    ChatModelVisibility.MEMBERS: "회원에게 공개",
    ChatModelVisibility.ADMIN: "관리자만",
    ChatModelVisibility.DISABLED: "사용 안 함",
}

#: The fields an update may change, as the audit log names them.
_AUDITED = (
    "label",
    "description",
    "input_usd_per_mtok",
    "output_usd_per_mtok",
    "visibility",
    "sort_order",
    "is_default",
)


def _read(row: ChatModel, db: Session) -> ChatModelAdminRead:
    result = ChatModelAdminRead.model_validate(row)
    result.estimated_reply_krw = pricing.typical_reply_krw(
        chat_models.ChosenModel.of(row), pricing.current_rate(db)
    )
    return result


def _snapshot(row: ChatModel) -> dict:
    return {
        field: (
            getattr(row, field).value
            if field == "visibility"
            else str(getattr(row, field))
            if field.endswith("_mtok")
            else getattr(row, field)
        )
        for field in _AUDITED
    }


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


@router.get("", response_model=list[ChatModelAdminRead], summary="The whole catalogue")
def list_chat_models(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[ChatModelAdminRead]:
    return [_read(row, db) for row in chat_models.all_models(db)]


@router.post(
    "",
    response_model=ChatModelAdminRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a model (closed until opened)",
)
def create_chat_model(
    payload: ChatModelCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ChatModelAdminRead:
    provider = payload.provider.strip()
    model_id = payload.model_id.strip()
    if provider not in chat_models.KNOWN_PROVIDERS:
        raise _bad(
            f"제공자 {provider}는 아직 연결되지 않았습니다. "
            f"지금은 {', '.join(chat_models.KNOWN_PROVIDERS)}만 쓸 수 있습니다."
        )
    if not MODEL_ID.match(model_id):
        raise _bad("모델 ID는 영문 소문자, 숫자, 점(.)과 대시(-)만 쓸 수 있습니다.")
    exists = db.scalar(
        select(ChatModel.id).where(ChatModel.provider == provider, ChatModel.model_id == model_id)
    )
    if exists is not None:
        raise _bad("이미 목록에 있는 모델입니다.")

    row = ChatModel(
        provider=provider,
        model_id=model_id,
        label=payload.label.strip(),
        description=payload.description.strip(),
        input_usd_per_mtok=payload.input_usd_per_mtok,
        output_usd_per_mtok=payload.output_usd_per_mtok,
        visibility=payload.visibility,
        is_default=False,
        sort_order=payload.sort_order,
    )
    db.add(row)
    db.flush()
    audit.record(
        db,
        actor=admin,
        action=AuditAction.CHAT_MODEL_CREATED,
        target_type="chat_model",
        target_id=row.id,
        target_label=row.label,
        summary=(
            f"Claude 모델 추가: {row.label} ({provider}/{model_id}) — 입력 "
            f"${row.input_usd_per_mtok} · 출력 ${row.output_usd_per_mtok} (100만 토큰당), "
            f"{VISIBILITY_LABEL[row.visibility]}"
        ),
        detail={"after": _snapshot(row)},
    )
    db.commit()
    db.refresh(row)
    return _read(row, db)


@router.patch("/{chat_model_id}", response_model=ChatModelAdminRead, summary="Change a model")
def update_chat_model(
    chat_model_id: int,
    payload: ChatModelUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ChatModelAdminRead:
    row = db.get(ChatModel, chat_model_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="모델을 찾을 수 없습니다.")

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise _bad("바꿀 내용을 보내 주세요.")

    if changes.get("is_default") is False:
        raise _bad("기본 모델을 바꾸려면 다른 모델을 기본으로 정하세요.")
    becomes_default = changes.pop("is_default", False) and not row.is_default
    visibility = changes.get("visibility", row.visibility)
    if (row.is_default or becomes_default) and visibility is not ChatModelVisibility.MEMBERS:
        raise _bad(
            "기본 모델은 회원에게 공개되어 있어야 합니다. "
            "다른 모델을 먼저 기본으로 정한 뒤 바꿔 주세요."
            if row.is_default
            else "회원에게 공개된 모델만 기본으로 정할 수 있습니다."
        )

    before = _snapshot(row)
    for field, value in changes.items():
        setattr(row, field, value.strip() if field in ("label", "description") else value)
    if becomes_default:
        db.execute(
            update(ChatModel).where(ChatModel.id != row.id).values(is_default=False)
        )
        row.is_default = True
    after = _snapshot(row)

    changed = [field for field in _AUDITED if before[field] != after[field]]
    if changed:
        parts = []
        if "input_usd_per_mtok" in changed or "output_usd_per_mtok" in changed:
            parts.append(
                f"요금 입력 ${row.input_usd_per_mtok} · 출력 ${row.output_usd_per_mtok} "
                "(100만 토큰당)"
            )
        if "visibility" in changed:
            parts.append(VISIBILITY_LABEL[row.visibility])
        if "is_default" in changed:
            parts.append("기본 모델로 지정")
        if {"label", "description", "sort_order"} & set(changed):
            parts.append("이름·설명·순서")
        audit.record(
            db,
            actor=admin,
            action=AuditAction.CHAT_MODEL_UPDATED,
            target_type="chat_model",
            target_id=row.id,
            target_label=row.label,
            summary=f"{row.label}: " + ", ".join(parts),
            detail={
                "before": {field: before[field] for field in changed},
                "after": {field: after[field] for field in changed},
            },
        )
    db.commit()
    db.refresh(row)
    return _read(row, db)
