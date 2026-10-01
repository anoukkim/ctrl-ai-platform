"""Admin routes.

Only the video model master exists in Phase 1. Every route here is behind
`require_admin`, which checks the role on the backend — hiding a button in
the frontend is not authorization.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import User, VideoModel
from app.schemas.video import VideoModelAdminRead, VideoModelAdminUpdate

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
    summary="Change a model's switches",
)
def update_video_model(
    model_id: int,
    payload: VideoModelAdminUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> VideoModel:
    model = db.get(VideoModel, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="모델을 찾을 수 없습니다.")

    changes = payload.model_dump(exclude_unset=True)

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
