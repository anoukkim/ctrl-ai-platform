"""Admin routes: the video model catalogue.

Every route here is behind `require_admin`, which checks the role on the
backend — hiding a button in the frontend is not authorization.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import AuditAction, User, VideoModel
from app.schemas.video import (
    CatalogError,
    VideoModelAdminRead,
    VideoModelAdminUpdate,
    parse_capabilities,
)
from app.services import audit

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get(
    "/video-models",
    response_model=list[VideoModelAdminRead],
    summary="All video models, including hidden ones",
)
def list_video_models(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[VideoModel]:
    return list(db.scalars(select(VideoModel).order_by(VideoModel.sort_order, VideoModel.id)))


@router.patch(
    "/video-models/{model_id}",
    response_model=VideoModelAdminRead,
    summary="Change a model's switches or its catalogue entry",
)
def update_video_model(
    model_id: int,
    payload: VideoModelAdminUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> VideoModel:
    model = db.get(VideoModel, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="모델을 찾을 수 없습니다.")

    changes = payload.model_dump(exclude_unset=True)

    if "capabilities" in changes:
        raw = changes.pop("capabilities")
        if raw is not None:
            try:
                caps = parse_capabilities(raw)
            except CatalogError as error:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
                ) from error
            # An admin saving the entry is an admin standing behind its
            # prices, so they stop being placeholders.
            caps.prices_are_examples = False
            before = model.capabilities
            model.capabilities = caps.model_dump()
            # Prices move money, so the change is on the record — with
            # both sides, because the next question is always "what was it?"
            audit.record(
                db,
                actor=admin,
                action=AuditAction.VIDEO_MODEL_UPDATED,
                target_type="video_model",
                target_id=model.id,
                target_label=model.display_name,
                summary=f"{model.display_name}의 길이·비율·화질·가격 설정을 바꿨습니다.",
                detail={"before": before, "after": model.capabilities},
            )

    # A hidden model cannot be offered to members, so turning `enabled`
    # off also takes it off the member list. Keeping the two switches
    # independent otherwise lets an admin disable a model temporarily
    # without losing the "members may pick this" setting.
    if changes.get("enabled") is False:
        changes["member_visible"] = False

    for field, value in changes.items():
        setattr(model, field, value)

    db.commit()
    db.refresh(model)
    return model
