"""CtrlAIApps — the published apps (ctrlaiapps-publish).

Signed-in members read the listing and a detail page and may report an
app. Every query comes from `app_publish.published_listing()`, which
filters on the project's `deleted_at` (CLAUDE.md section 10).
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.uploads import file_response
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import AccountStatus, AppFavorite, BuilderProject, User
from app.schemas.apps import AppFavoriteSet, AppListing, AppReportCreate
from app.services import app_manifest, app_publish, app_runtime, thumbnails
from app.services.storage import get_storage

router = APIRouter(prefix="/apps", tags=["apps"])


def shared_lists_of(project: BuilderProject) -> bool:
    """Whether the published version's `ctrlai.json` declares a shared list
    (ui-improvements): the detail page's note then says other members can
    read what is posted. A manifest that will not parse counts as none —
    the listing must never fail over one app's file."""
    version = project.published_version
    if version is None:
        return False
    # Only the manifest is read — never the whole file list of every row.
    manifest = next((content for path, content in version.files if path == app_manifest.MANIFEST_FILE), None)
    if manifest is None:
        return False
    try:
        return any(entry.kind == "shared" for entry in app_manifest.parse({app_manifest.MANIFEST_FILE: str(manifest)}))
    except app_manifest.ManifestError:
        return False


def favorites_of(db: Session, user: User) -> set[int]:
    """The project ids this member keeps as 즐겨찾기."""
    return set(db.scalars(select(AppFavorite.project_id).where(AppFavorite.user_id == user.id)))


def listing_of(
    db: Session, settings: Settings, project: BuilderProject, favorites: set[int] | None = None
) -> AppListing:
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
        shared_lists=shared_lists_of(project),
        favorite=project.id in favorites if favorites else False,
        thumbnail_at=project.published_thumbnail_at,
        uses_ai=project.published_uses_ai,
        ai_access=project.ai_access,
    )


def _listed(db: Session, slug: str) -> BuilderProject:
    project = db.scalar(app_publish.published_listing().where(BuilderProject.app_slug == slug))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="앱을 찾을 수 없습니다.")
    return project


@router.get("", response_model=list[AppListing], summary="Every published app, newest update first")
def list_apps(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> list[AppListing]:
    rows = db.scalars(app_publish.published_listing().order_by(BuilderProject.published_at.desc()))
    favorites = favorites_of(db, user)
    return [listing_of(db, settings, row, favorites) for row in rows]


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
    favorites = favorites_of(db, user)
    return [listing_of(db, settings, row, favorites) for row in rows]


@router.get("/{slug}", response_model=AppListing, summary="One published app")
def read_app(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> AppListing:
    return listing_of(db, settings, _listed(db, slug), favorites_of(db, user))


@router.get("/{slug}/thumbnail", summary="The published version's thumbnail (WebP)")
def read_thumbnail(
    slug: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """A picture, never a page: sent with the file headers every stored
    upload gets. 404 while the app has none (the card draws its cover)."""
    project = _listed(db, slug)
    data = thumbnails.load_published(get_storage(settings), project)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="썸네일이 아직 없어요.")
    return file_response(data, thumbnails.MEDIA_TYPE, f"{slug}.webp", inline=True)


@router.post(
    "/{slug}/favorite",
    response_model=AppListing,
    summary="즐겨찾기: keep a published app first on my CtrlAIApps list",
)
def set_favorite(
    slug: str,
    payload: AppFavoriteSet,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> AppListing:
    """Any signed-in member: a favourite is a reading preference, not a
    creation (ui-improvements). Setting what is already set changes
    nothing; the row is the member's own and never shown to the maker."""
    project = _listed(db, slug)
    row = db.scalar(
        select(AppFavorite).where(AppFavorite.user_id == user.id, AppFavorite.project_id == project.id)
    )
    if payload.on and row is None:
        db.add(AppFavorite(user_id=user.id, project_id=project.id))
        try:
            db.commit()
        except IntegrityError:
            # The same member's other tab got there first: already set.
            db.rollback()
            project = _listed(db, slug)
    elif not payload.on and row is not None:
        db.delete(row)
        db.commit()
    return listing_of(db, settings, project, favorites_of(db, user))


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
