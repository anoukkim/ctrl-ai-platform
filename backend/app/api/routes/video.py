"""Video Generator routes: the member-facing model list and projects.

No provider is called here. Creating a version records the attempt and
marks it ready; a real Higgsfield call replaces that in Phase 6.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User, VideoModel, VideoProject, VideoVersion
from app.schemas.video import (
    VideoModelRead,
    VideoProjectCreate,
    VideoProjectDetail,
    VideoProjectRead,
    VideoProjectUpdate,
    VideoVersionRead,
)

router = APIRouter(prefix="/video", tags=["video"])


def _owned_project(project_id: int, db: Session, user: User) -> VideoProject:
    project = db.scalar(
        select(VideoProject).where(
            VideoProject.id == project_id,
            VideoProject.owner_user_id == user.id,
        )
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="프로젝트를 찾을 수 없습니다.")
    return project


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
def list_models(db: Session = Depends(get_db)) -> list[VideoModel]:
    return _allowed_models(db)


@router.get("/projects", response_model=list[VideoProjectRead], summary="List my video projects")
def list_projects(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VideoProject]:
    return list(
        db.scalars(
            select(VideoProject)
            .where(VideoProject.owner_user_id == user.id)
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
    user: User = Depends(get_current_user),
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
        name=payload.name,
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
    user: User = Depends(get_current_user),
) -> VideoProject:
    project = _owned_project(project_id, db, user)
    changes = payload.model_dump(exclude_unset=True)

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


@router.post(
    "/projects/{project_id}/versions",
    response_model=VideoVersionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Record a generation attempt",
)
def create_version(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VideoVersion:
    """Add a version using the project's current prompt and model.

    Phase 1 records the attempt only — nothing is generated. The row is
    marked ready so the workspace has something to show; Phase 6 will
    create it as `queued` and let a provider job move it along.
    """
    project = _owned_project(project_id, db, user)

    allowed = _allowed_models(db)
    model = next((m for m in allowed if m.id == project.selected_model_id), None)
    if model is None:
        # "Auto": fall back to the first allowed model. Real Auto-selection
        # logic is a later phase.
        model = allowed[0] if allowed else None
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="사용할 수 있는 영상 모델이 없습니다.",
        )

    version = VideoVersion(
        project_id=project.id,
        provider=model.provider,
        model_id=model.model_id,
        prompt_snapshot=project.prompt,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    db.refresh(project)
    return version
