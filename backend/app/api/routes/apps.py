"""CtrlAIApps — the published apps (ctrlaiapps-publish).

Signed-in members read the listing and a detail page and may report an
app. Every query comes from `app_publish.published_listing()`, which
filters on the project's `deleted_at` (CLAUDE.md section 10).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import AccountStatus, BuilderProject, User
from app.schemas.apps import AppListing, AppReportCreate
from app.services import app_publish, app_runtime

router = APIRouter(prefix="/apps", tags=["apps"])


def listing_of(db: Session, settings: Settings, project: BuilderProject) -> AppListing:
    owner = db.get(User, project.owner_user_id)
    former = owner is None or owner.account_status is AccountStatus.FORMER
    return AppListing(
        id=project.id,
        slug=project.app_slug or "",
        name=project.name,
        description=project.description,
        author_name="탈퇴 회원" if former else owner.display_name,
        author_username="" if former else owner.username,
        version_number=project.published_version_number or 0,
        published_at=project.published_at,
        publish_note=project.publish_note,
        app_url=app_runtime.public_url(settings, project),
    )


def _listed(db: Session, slug: str) -> BuilderProject:
    project = db.scalar(app_publish.published_listing().where(BuilderProject.app_slug == slug))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="앱을 찾을 수 없습니다.")
    return project


@router.get("", response_model=list[AppListing], summary="Every published app, newest update first")
def list_apps(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> list[AppListing]:
    rows = db.scalars(app_publish.published_listing().order_by(BuilderProject.published_at.desc()))
    return [listing_of(db, settings, row) for row in rows]


@router.get("/mine", response_model=list[AppListing], summary="The signed-in member's own published apps")
def list_my_apps(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> list[AppListing]:
    """Profile › 내가 만든 앱 (owner-polish 3). The same listing query as
    CtrlAIApps — published, `deleted_at IS NULL` — narrowed to the caller,
    so Profile shows exactly the cards the store shows for them. Declared
    before `/{slug}` so "mine" is never read as an app's address."""
    rows = db.scalars(
        app_publish.published_listing()
        .where(BuilderProject.owner_user_id == user.id)
        .order_by(BuilderProject.published_at.desc())
    )
    return [listing_of(db, settings, row) for row in rows]


@router.get("/{slug}", response_model=AppListing, summary="One published app")
def read_app(
    slug: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> AppListing:
    return listing_of(db, settings, _listed(db, slug))


@router.post(
    "/{slug}/report",
    status_code=status.HTTP_201_CREATED,
    summary="신고: flag a published app for the admin",
)
def report_app(
    slug: str,
    payload: AppReportCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Any signed-in member — reading and reporting are not creating, so
    a member sitting out the quarter may still flag a harmful app."""
    project = _listed(db, slug)
    try:
        app_publish.report(db, user, project, payload.reason)
    except app_publish.PublishError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    db.commit()
    return {"detail": "신고를 받았어요. 관리자가 확인할게요."}
