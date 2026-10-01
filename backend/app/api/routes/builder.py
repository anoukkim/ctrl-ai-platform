"""Project Builder routes.

Every query is scoped to the current member. There is deliberately no
"fetch any project by id" path: `_owned_project` is the only way a row is
loaded, and it always filters by owner.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import BuilderProject, User
from app.schemas.builder import (
    BuilderProjectCreate,
    BuilderProjectRead,
    BuilderProjectUpdate,
)

router = APIRouter(prefix="/builder", tags=["builder"])


def _owned_project(project_id: int, db: Session, user: User) -> BuilderProject:
    """Load one project, or 404 if it is missing *or* someone else's.

    A member must not be able to tell the difference between "does not
    exist" and "belongs to another member", so both answer 404.
    """
    project = db.scalar(
        select(BuilderProject).where(
            BuilderProject.id == project_id,
            BuilderProject.owner_user_id == user.id,
        )
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="프로젝트를 찾을 수 없습니다.")
    return project


@router.get("/projects", response_model=list[BuilderProjectRead], summary="List my projects")
def list_projects(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BuilderProject]:
    return list(
        db.scalars(
            select(BuilderProject)
            .where(BuilderProject.owner_user_id == user.id)
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
    user: User = Depends(get_current_user),
) -> BuilderProject:
    project = BuilderProject(
        owner_user_id=user.id,
        name=payload.name,
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
    user: User = Depends(get_current_user),
) -> BuilderProject:
    project = _owned_project(project_id, db, user)

    for field, value in payload.model_dump(exclude_unset=True).items():
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
    user: User = Depends(get_current_user),
) -> None:
    project = _owned_project(project_id, db, user)
    db.delete(project)
    db.commit()
