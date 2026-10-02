"""Video Generator routes: the member-facing model list and projects.

No provider is called here. Creating a version records the attempt and
marks it ready; a real Higgsfield call replaces that in Phase 6.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_active_member
from app.db.session import get_db
from app.models import User, VideoModel, VideoProject, VideoVersion
from app.schemas.video import (
    VideoModelRead,
    VideoProjectCreate,
    VideoProjectDetail,
    VideoProjectRead,
    VideoProjectUpdate,
    VideoVersionCreate,
    VideoVersionRead,
)
from app.services.work import InvalidNameError, clean_name

router = APIRouter(prefix="/video", tags=["video"])


def _owned_project(project_id: int, db: Session, user: User) -> VideoProject:
    """Load one live project of this member's, or 404.

    "Someone else's" and "deleted" both answer 404, for the same reason
    Builder does: the member is told it is gone, so every route has to
    agree that it is gone.
    """
    project = db.scalar(
        select(VideoProject).where(
            VideoProject.id == project_id,
            VideoProject.owner_user_id == user.id,
            VideoProject.deleted_at.is_(None),
        )
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="프로젝트를 찾을 수 없습니다.")
    return project


def _checked_name(raw: str) -> str:
    """`clean_name`, as a 400 with a Korean sentence — see Builder's copy."""
    try:
        return clean_name(raw)
    except InvalidNameError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error


def _allowed_models(db: Session) -> list[VideoModel]:
    """Models a member may choose.

    Both switches must be on. This is the single place that rule lives, so
    a hidden model cannot leak through a different route.
    """
    return list(
        db.scalars(
            select(VideoModel)
            .where(VideoModel.enabled.is_(True), VideoModel.member_visible.is_(True))
            .order_by(VideoModel.sort_order, VideoModel.id)
        )
    )


@router.get("/models", response_model=list[VideoModelRead], summary="Models I may use")
def list_models(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[VideoModel]:
    return _allowed_models(db)


@router.get("/projects", response_model=list[VideoProjectRead], summary="List my video projects")
def list_projects(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VideoProject]:
    return list(
        db.scalars(
            select(VideoProject)
            .where(
                VideoProject.owner_user_id == user.id,
                VideoProject.deleted_at.is_(None),
            )
            .order_by(VideoProject.updated_at.desc())
        )
    )


@router.post(
    "/projects",
    response_model=VideoProjectRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a video project",
)
def create_project(
    payload: VideoProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> VideoProject:
    model_id = payload.selected_model_id
    if model_id is not None and model_id not in {m.id for m in _allowed_models(db)}:
        # Refuse a model the member is not allowed to use, even if the id
        # exists: the allowlist is enforced on the backend, not the form.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="사용할 수 없는 모델입니다.",
        )

    project = VideoProject(
        owner_user_id=user.id,
        name=_checked_name(payload.name),
        prompt=payload.prompt,
        selected_model_id=model_id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get(
    "/projects/{project_id}",
    response_model=VideoProjectDetail,
    summary="Get a video project with its versions",
)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VideoProject:
    return _owned_project(project_id, db, user)


@router.patch(
    "/projects/{project_id}",
    response_model=VideoProjectDetail,
    summary="Update a video project",
)
def update_project(
    project_id: int,
    payload: VideoProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> VideoProject:
    """Edit a project — prompt, model, final version.

    Participating members only. This is how the prompt is saved before a
    generation, so leaving it open would let a member who is not
    participating drive the workspace right up to the provider call.
    """
    project = _owned_project(project_id, db, user)
    changes = payload.model_dump(exclude_unset=True)

    if "name" in changes:
        changes["name"] = _checked_name(changes["name"])

    if "selected_model_id" in changes and changes["selected_model_id"] is not None:
        if changes["selected_model_id"] not in {m.id for m in _allowed_models(db)}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="사용할 수 없는 모델입니다.",
            )

    if "final_version_id" in changes and changes["final_version_id"] is not None:
        owned_version_ids = {version.id for version in project.versions}
        if changes["final_version_id"] not in owned_version_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="이 프로젝트의 버전이 아닙니다.",
            )

    for field, value in changes.items():
        setattr(project, field, value)

    db.commit()
    db.refresh(project)
    return project


@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a video project",
)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> None:
    """Delete a video project. The owner, while participating, only.

    Video had no delete route at all until now, so the only way to lose a
    project was for an admin to remove the row by hand. It mirrors
    Builder's exactly, including the soft delete: the versions stay, so a
    restore brings back every attempt rather than an empty shell.
    """
    project = _owned_project(project_id, db, user)
    project.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.post(
    "/projects/{project_id}/versions",
    response_model=VideoVersionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Record a generation attempt",
)
def create_version(
    project_id: int,
    settings: VideoVersionCreate | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> VideoVersion:
    """Add a version using the project's current prompt and model.

    Phase 1 records the attempt only — nothing is generated. The row is
    marked ready so the workspace has something to show; Phase 6 will
    create it as `queued` and let a provider job move it along.

    The length, aspect ratio and sound come from the request because they
    live in the workspace's controls rather than on the project. They are
    checked against the chosen model's capabilities here: a browser can
    send anything, so a model that only does 9:16 must refuse 16:9 on the
    server, not merely grey the button out.
    """
    project = _owned_project(project_id, db, user)

    allowed = _allowed_models(db)
    auto_selected = project.selected_model_id is None
    model = next((m for m in allowed if m.id == project.selected_model_id), None)
    if model is None:
        # "Auto": fall back to the first allowed model. Real Auto-selection
        # logic is a later phase.
        auto_selected = True
        model = allowed[0] if allowed else None
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="사용할 수 있는 영상 모델이 없습니다.",
        )

    asked = settings or VideoVersionCreate()
    capabilities = model.capabilities or {}

    durations = capabilities.get("durations") or []
    if asked.duration_seconds is not None and durations and asked.duration_seconds not in durations:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{model.display_name} 모델은 {asked.duration_seconds}초를 지원하지 않습니다."
            ),
        )

    aspects = capabilities.get("aspect_ratios") or []
    if asked.aspect_ratio is not None and aspects and asked.aspect_ratio not in aspects:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{model.display_name} 모델은 {asked.aspect_ratio} 비율을 지원하지 않습니다.",
        )

    # A model with no sound can only produce a silent version. This is not
    # an error — the screen already says so — so it is corrected quietly.
    sound = asked.sound
    if sound and not capabilities.get("sound", True):
        sound = False

    version = VideoVersion(
        project_id=project.id,
        provider=model.provider,
        model_id=model.model_id,
        prompt_snapshot=project.prompt,
        duration_seconds=asked.duration_seconds,
        aspect_ratio=asked.aspect_ratio,
        sound=sound,
        auto_selected=auto_selected,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    db.refresh(project)
    return version
