"""Admin › AI Models — the chat model catalogue (chat-model-choice).

Grouped by provider (admin-and-nav-cleanup, 2026-10-14). A provider with
no adapter yet (`chat_models.PROVIDERS`, `ready=False`) is 연결 준비 중:
its rows may be added and priced but never opened or made the default.

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
from app.schemas.pricing import (
    ChatModelAdminRead,
    ChatModelCreate,
    ChatProviderRead,
    ChatModelUpdate,
    ModelCalibrationRead,
)
from app.services import audit, calibration, chat_models, pricing

router = APIRouter(prefix="/admin/chat-models", tags=["admin"])

#: A provider model id: lower-case letters, digits, dots, dashes and
#: slashes (a hosted model such as deepseek/deepseek-v4.1-flash).
MODEL_ID = re.compile(r"^[a-z0-9][a-z0-9./\-]{1,119}$")

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
    "cache_read_usd_per_mtok",
    "visibility",
    "sort_order",
    "is_default",
    # Server tools (chat-plus-tools): opening one changes what members can
    # spend, so it is audited like a price.
    "tools_web_search",
    "tools_web_fetch",
    "tools_code_execution",
    "web_search_usd_per_call",
)


def _read(row: ChatModel, db: Session) -> ChatModelAdminRead:
    result = ChatModelAdminRead.model_validate(row)
    estimate = pricing.reply_estimate(db, chat_models.ChosenModel.of(row), pricing.current_rate(db))
    result.estimated_reply_krw = estimate.krw
    result.estimate_basis = estimate.basis
    result.estimate_samples = estimate.samples
    info = chat_models.provider_info(row.provider)
    result.provider_label = info.label
    result.provider_ready = info.ready
    return result


def _snapshot(row: ChatModel) -> dict:
    return {
        field: (
            getattr(row, field).value
            if field == "visibility"
            else str(getattr(row, field))
            if field.endswith(("_mtok", "_per_call"))
            else getattr(row, field)
        )
        for field in _AUDITED
    }


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


@router.get(
    "/providers",
    response_model=list[ChatProviderRead],
    summary="The providers, in display order, and whether each is connected",
)
def list_providers(_: User = Depends(require_admin)) -> list[ChatProviderRead]:
    return [
        ChatProviderRead(id=info.id, label=info.label, ready=info.ready)
        for info in chat_models.PROVIDERS.values()
    ]


@router.get("", response_model=list[ChatModelAdminRead], summary="The whole catalogue")
def list_chat_models(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[ChatModelAdminRead]:
    return [_read(row, db) for row in chat_models.all_models(db)]


@router.get(
    "/calibration",
    response_model=list[ModelCalibrationRead],
    summary="Estimates against real replies, per model (cost-calibration)",
)
def read_calibration(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[ModelCalibrationRead]:
    """Read-only. Built from the ledger; nothing calls a provider."""
    rate = pricing.current_rate(db)
    rows = []
    for row in chat_models.all_models(db):
        measured = calibration.for_model(db, row.model_id)
        rows.append(
            ModelCalibrationRead(
                model_id=row.model_id,
                label=row.label,
                samples=measured.samples,
                calibrated=measured.calibrated,
                input_ratio=measured.input_ratio,
                input_factor=measured.input_factor,
                avg_prompt_tokens=measured.avg_prompt_tokens,
                avg_estimated_tokens=measured.avg_estimated_tokens,
                avg_output_tokens=measured.avg_output_tokens,
                avg_reply_krw=measured.avg_reply_krw,
                median_reply_krw=measured.median_reply_krw,
                formula_reply_krw=pricing.typical_reply_krw(chat_models.ChosenModel.of(row), rate),
                cache_hit_rate=measured.cache_hit_rate,
            )
        )
    return rows


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
    if provider not in chat_models.PROVIDERS:
        raise _bad(f"알 수 없는 제공자입니다: {provider}")
    try:
        chat_models.check_open(provider, payload.visibility)
    except chat_models.ModelChoiceError as error:
        raise _bad(str(error)) from error
    if not MODEL_ID.match(model_id):
        raise _bad("모델 ID는 영문 소문자, 숫자, 점(.), 대시(-), 슬래시(/)만 쓸 수 있습니다.")
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
        cache_read_usd_per_mtok=payload.cache_read_usd_per_mtok,
        visibility=payload.visibility,
        is_default=False,
        sort_order=payload.sort_order,
        tools_web_search=payload.tools_web_search,
        tools_web_fetch=payload.tools_web_fetch,
        tools_code_execution=payload.tools_code_execution,
        web_search_usd_per_call=payload.web_search_usd_per_call,
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
            f"AI 모델 추가: {row.label} ({provider}/{model_id}) — 입력 "
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
    # A provider with no adapter first: its own reason, before the others.
    # Only when this change opens the row or makes it the default — a
    # price-only edit of a row that is already open (stray old data) is
    # not what the rule is for, and closing such a row must stay possible.
    if "visibility" in changes or becomes_default:
        try:
            chat_models.check_open(row.provider, visibility, default=becomes_default)
        except chat_models.ModelChoiceError as error:
            raise _bad(str(error)) from error
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
        if "cache_read_usd_per_mtok" in changed:
            parts.append(f"캐시 읽기 ${row.cache_read_usd_per_mtok} (100만 토큰당)")
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
