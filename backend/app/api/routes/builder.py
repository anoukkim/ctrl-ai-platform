"""Project Builder routes.

Every query is scoped to the current member. There is deliberately no
"fetch any project by id" path: `_owned_project` is the only way a row is
loaded, and it always filters by owner — and now by `deleted_at IS NULL`,
so a deleted project is invisible to its owner through every route rather
than only the ones that remembered to check.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_active_member
from app.db.session import get_db
from app.models import BuilderProject, User
from app.schemas.builder import (
    BuilderProjectCreate,
    BuilderProjectRead,
    BuilderProjectUpdate,
)
from app.services.work import InvalidNameError, clean_name

router = APIRouter(prefix="/builder", tags=["builder"])


def _owned_project(project_id: int, db: Session, user: User) -> BuilderProject:
    """Load one live project, or 404 if it is missing *or* someone else's.

    A member must not be able to tell the difference between "does not
    exist" and "belongs to another member", so both answer 404. A deleted
    project answers 404 as well: from the member's side it is gone, and
    only an admin route can still see it.
    """
    project = db.scalar(
        select(BuilderProject).where(
            BuilderProject.id == project_id,
            BuilderProject.owner_user_id == user.id,
            BuilderProject.deleted_at.is_(None),
        )
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="프로젝트를 찾을 수 없습니다.")
    return project


def _checked_name(raw: str) -> str:
    """`clean_name`, with the refusal turned into a 400 the screen can show.

    400 rather than FastAPI's own 422: a validation error body carries a
    *list* under `detail`, and the frontend only renders a string. The
    member would see "요청이 실패했습니다 (HTTP 422)" instead of being told
    what is wrong with the name.
    """
    try:
        return clean_name(raw)
    except InvalidNameError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error


@router.get("/projects", response_model=list[BuilderProjectRead], summary="List my projects")
def list_projects(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BuilderProject]:
    return list(
        db.scalars(
            select(BuilderProject)
            .where(
                BuilderProject.owner_user_id == user.id,
                BuilderProject.deleted_at.is_(None),
            )
            .order_by(BuilderProject.updated_at.desc())
        )
    )


@router.post(
    "/projects",
    response_model=BuilderProjectRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a project",
)
def create_project(
    payload: BuilderProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> BuilderProject:
    project = BuilderProject(
        owner_user_id=user.id,
        name=_checked_name(payload.name),
        description=payload.description,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=BuilderProjectRead, summary="Get a project")
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BuilderProject:
    return _owned_project(project_id, db, user)


@router.patch("/projects/{project_id}", response_model=BuilderProjectRead, summary="Update a project")
def update_project(
    project_id: int,
    payload: BuilderProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> BuilderProject:
    """Edit a project. Participating members only — see `require_active_member`.

    Renaming comes through here rather than a route of its own: the
    workspace title, the ▾ menu and the library's item menu are three ways
    to send the same PATCH, and one of them being able to set a name the
    others cannot would be a bug waiting to happen.
    """
    project = _owned_project(project_id, db, user)
    changes = payload.model_dump(exclude_unset=True)

    if "name" in changes:
        changes["name"] = _checked_name(changes["name"])

    for field, value in changes.items():
        setattr(project, field, value)

    db.commit()
    db.refresh(project)
    return project


@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project",
)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> None:
    """Delete a project. The owner, while participating, only.

    Deleting is a change to the member's work, not a read, so it follows
    the same rule as creating and editing. A member who is not
    participating keeps everything they made and can still read it.

    The row is marked, not removed — see `SoftDeleteMixin`. Nothing here
    touches `UsageEvent`: money already spent on this project stays
    recorded, and stays attached to it.
    """
    project = _owned_project(project_id, db, user)
    project.deleted_at = datetime.now(timezone.utc)
    db.commit()
