"""Project Builder routes.

Every query is scoped to the current member. There is deliberately no
"fetch any project by id" path: `_owned_project` is the only way a row is
loaded, and it always filters by owner — and now by `deleted_at IS NULL`,
so a deleted project is invisible to its owner through every route rather
than only the ones that remembered to check.
"""

import logging
from datetime import date, datetime, timezone
from urllib.parse import quote

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_active_member
from app.db.session import get_db
from app.models import (
    BuilderProject,
    BuilderProjectFile,
    BuilderProjectStatus,
    BuilderProjectVersion,
    User,
)
from app.schemas.builder import (
    BuilderProjectCreate,
    BuilderProjectFromChat,
    BuilderProjectRead,
    BuilderProjectUpdate,
)
from app.core.config import Settings, get_settings
from app.schemas.builder import (
    BuilderFileRead,
    EditEstimateRead,
    GenerateRead,
    GenerateRequest,
    PublishRequest,
    RestoreRead,
    VersionLabel,
    StarterEstimateRead,
    StarterRead,
    StarterRequest,
    VersionRead,
)
from app.services import (
    app_publish,
    app_runtime,
    builder_edit,
    builder_starter,
    builder_versions,
    chat_models,
    pricing,
    project_zip,
)
from app.services import usage as usage_service
from app.services.claude_provider import ClaudeError, get_claude_provider
from app.services.work import InvalidNameError, clean_name

router = APIRouter(prefix="/builder", tags=["builder"])

logger = logging.getLogger(__name__)


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


#: The library's three filters: 전체 / Draft / 게시됨.
LibraryFilter = Literal["all", "draft", "published"]


@router.get("/projects", response_model=list[BuilderProjectRead], summary="List my projects")
def list_projects(
    status_filter: LibraryFilter = Query(default="all", alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BuilderProject]:
    """The member's own projects, newest first.

    `status` is the library's filter, exactly as the member sees it:
    `all`, `draft` (everything not yet published — draft, building
    and ready) or `published`.
    """
    query = select(BuilderProject).where(
        BuilderProject.owner_user_id == user.id,
        BuilderProject.deleted_at.is_(None),
    )
    if status_filter == "published":
        query = query.where(BuilderProject.status == BuilderProjectStatus.PUBLISHED)
    elif status_filter == "draft":
        query = query.where(BuilderProject.status != BuilderProjectStatus.PUBLISHED)
    return list(
        db.scalars(
            query.order_by(BuilderProject.updated_at.desc())
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


#: The largest HTML block Chat previews (chat-plus-artifacts); a bigger one
#: shows as code only, so it is never offered to the Builder either.
FROM_CHAT_MAX_BYTES = 200_000


@router.post(
    "/projects/from-chat",
    response_model=BuilderProjectRead,
    status_code=status.HTTP_201_CREATED,
    summary="Builder로 보내기: a project whose index.html is a chat reply's HTML block",
)
def create_project_from_chat(
    payload: BuilderProjectFromChat,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> BuilderProject:
    """The one Builder route that writes a file from the browser
    (chat-plus-artifacts). Free — nothing is generated; the member's own
    reply is copied. `require_active_member` like creating a project."""
    if len(payload.html.encode("utf-8")) > FROM_CHAT_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="페이지가 너무 커서(200KB 초과) Builder로 보낼 수 없습니다.",
        )
    try:
        name = clean_name(payload.name)
    except InvalidNameError:
        name = "채팅에서 만든 페이지"
    project = BuilderProject(
        owner_user_id=user.id,
        name=name,
        description=payload.description.strip()[:2000],
    )
    db.add(project)
    db.flush()
    db.add(BuilderProjectFile(project_id=project.id, path="index.html", content=payload.html))
    db.flush()
    builder_versions.snapshot(db, project, "채팅에서 가져옴", {"index.html": payload.html})
    _refresh_runtime(db, settings, project)
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


@router.get(
    "/projects/{project_id}/download",
    summary="Download the project's files as a ZIP",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}, "description": "The project as a ZIP"}},
)
def download_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Pack this project's files and send them back as one archive.

    **`get_current_user`, not `require_active_member`** — and that is the
    point of the feature. A member who did not join this quarter cannot
    create or edit, but their work is theirs: taking a copy out has to
    keep working, or "their projects remain" (CLAUDE.md section 10) is a
    promise the product does not keep.

    A deleted project is not downloadable: `_owned_project` already
    answers 404 for it, the same answer the member gets everywhere else.

    The archive is built in memory. Builder projects are small source
    trees, and `project_zip` caps the total so one request cannot
    allocate without bound.
    """
    project = _owned_project(project_id, db, user)

    rows = db.scalars(
        select(BuilderProjectFile).where(BuilderProjectFile.project_id == project.id)
    )
    try:
        payload = project_zip.build(project.name, [(row.path, row.content) for row in rows])
    except project_zip.ProjectTooLargeError as error:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(error)
        ) from error

    filename = project_zip.safe_filename(project.name, date.today(), "zip")

    # Both forms of the name, on purpose. `filename*` carries the Korean
    # one as UTF-8 and is what every current browser reads; the plain
    # `filename` is the ASCII fallback for anything that does not, and
    # without it such a client saves the response as the route's last
    # path segment — a file called "download" with no extension.
    disposition = f'attachment; filename="project-{project.id}.zip"; ' + (
        f"filename*=UTF-8''{quote(filename)}"
    )

    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": disposition},
    )


@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project",
)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
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
    # A deleted project stops being served at once (CLAUDE.md section 10:
    # deleted work never resurfaces) and is off CtrlAIApps; restored, it
    # comes back unpublished, to be published again on purpose.
    if project.published_version_id is not None:
        app_publish.unpublish(db, settings, project)
    app_runtime.remove(settings, project)
    db.commit()


# ------------------------------------------------------------ 예시 앱


@router.get(
    "/projects/{project_id}/files",
    response_model=list[BuilderFileRead],
    summary="A project's files",
)
def list_files(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BuilderProjectFile]:
    """Open to a member not participating this quarter: their work is
    theirs to read, as the ZIP download is."""
    project = _owned_project(project_id, db, user)
    return list(
        db.scalars(
            select(BuilderProjectFile)
            .where(BuilderProjectFile.project_id == project.id)
            .order_by(BuilderProjectFile.path)
        )
    )


@router.get(
    "/starter-estimate",
    response_model=StarterEstimateRead,
    summary="What a starter app costs, before making one",
)
def starter_estimate(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    config: Settings = Depends(get_settings),
) -> StarterEstimateRead:
    try:
        figures = builder_starter.estimate(db, config)
    except (pricing.PricingError, chat_models.ModelChoiceError) as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))
    return StarterEstimateRead(
        estimated_krw=figures.estimated_krw,
        worst_case_krw=figures.worst_case_krw,
        model_label=figures.model_label,
    )


@router.post(
    "/projects/{project_id}/starter",
    response_model=StarterRead,
    status_code=status.HTTP_201_CREATED,
    summary="Have Claude make a small starter app in an empty project",
)
def create_starter(
    project_id: int,
    payload: StarterRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> StarterRead:
    """Static files only, checked before they are stored; charged to the
    member's wallet like any Claude call. See `services/builder_starter.py`."""
    project = _owned_project(project_id, db, user)
    try:
        result = builder_starter.create_starter(
            db,
            config,
            get_claude_provider(config),
            user=user,
            project=project,
            idea=payload.idea,
            is_mock=config.provider_is_mock("claude"),
        )
    except builder_starter.StarterError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except usage_service.InsufficientBudgetError as error:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(error)) from error
    except usage_service.NoQuarterError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except chat_models.ModelChoiceError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except (ClaudeError, pricing.PricingError) as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    _refresh_runtime(db, config, project)
    db.commit()
    return StarterRead(
        files=[BuilderFileRead.model_validate(row) for row in result.files],
        summary=result.summary,
        charged_krw=result.charged_krw,
    )


# ------------------------------------------------ builder-static-runtime


def _refresh_runtime(db: Session, settings: Settings, project: BuilderProject) -> None:
    """Write the project's files to the apps origin after a change, when
    the runtime is on. A failure here never undoes the change: the preview
    falls back to running the files inside the page, and 미리보기 갱신
    can try again (it shows the reason)."""
    if not app_runtime.enabled(settings):
        return
    files = builder_versions.current_files(db, project)
    if "index.html" not in files:
        return
    try:
        app_runtime.write_draft(db, settings, project, files)
    except (app_runtime.AppRuntimeError, OSError) as error:
        logger.warning("app runtime write failed for project %s: %s", project.id, error)


def _version_read(version: BuilderProjectVersion, project: BuilderProject | None = None) -> VersionRead:
    return VersionRead(
        number=version.number,
        note=version.note,
        created_at=version.created_at,
        file_count=len(version.files),
        total_bytes=sum(len(str(content).encode("utf-8")) for _path, content in version.files),
        label=version.label,
        pinned=version.pinned,
        published=project is not None and project.published_version_id == version.id,
    )


def _file_rows(db: Session, project: BuilderProject) -> list[BuilderFileRead]:
    return [
        BuilderFileRead.model_validate(row)
        for row in db.scalars(
            select(BuilderProjectFile)
            .where(BuilderProjectFile.project_id == project.id)
            .order_by(BuilderProjectFile.path)
        )
    ]


@router.get(
    "/projects/{project_id}/generate-estimate",
    response_model=EditEstimateRead,
    summary="What 만들기 / 고치기 costs, before pressing it",
)
def generate_estimate(
    project_id: int,
    request: str = Query(default="", max_length=2000),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    config: Settings = Depends(get_settings),
) -> EditEstimateRead:
    project = _owned_project(project_id, db, user)
    try:
        figures = builder_edit.estimate(db, config, project, request)
    except (pricing.PricingError, chat_models.ModelChoiceError) as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))
    return EditEstimateRead(
        estimated_krw=figures.estimated_krw,
        worst_case_krw=figures.worst_case_krw,
        model_label=figures.model_label,
        max_output_tokens=figures.max_output_tokens,
    )


@router.post(
    "/projects/{project_id}/generate",
    response_model=GenerateRead,
    summary="만들기 / 고치기: Claude writes the project's files",
)
def generate(
    project_id: int,
    payload: GenerateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> GenerateRead:
    """Static files only, checked before they are stored; charged to the
    wallet by the token; saved as a new version. See `services/builder_edit.py`."""
    project = _owned_project(project_id, db, user)
    try:
        result = builder_edit.generate(
            db,
            config,
            get_claude_provider(config),
            user=user,
            project=project,
            request=payload.request,
            is_mock=config.provider_is_mock("claude"),
            style=payload.style,
        )
    except builder_starter.StarterError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except usage_service.InsufficientBudgetError as error:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(error)) from error
    except usage_service.NoQuarterError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except chat_models.ModelChoiceError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except (ClaudeError, pricing.PricingError) as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    _refresh_runtime(db, config, project)
    db.commit()
    db.refresh(project)
    db.refresh(result.version)
    return GenerateRead(
        files=_file_rows(db, project),
        changed=result.changed,
        summary=result.summary,
        charged_krw=result.charged_krw,
        version=_version_read(result.version, project),
        project=BuilderProjectRead.model_validate(project),
    )


@router.get(
    "/projects/{project_id}/versions",
    response_model=list[VersionRead],
    summary="A project's saved versions, newest first",
)
def list_versions(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VersionRead]:
    """Readable while not participating, like the files themselves."""
    project = _owned_project(project_id, db, user)
    return [
        _version_read(version, project) for version in builder_versions.list_versions(db, project)
    ]


@router.post(
    "/projects/{project_id}/versions/{number}/restore",
    response_model=RestoreRead,
    summary="되돌리기: the project's files as they were in one version",
)
def restore_version(
    project_id: int,
    number: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> RestoreRead:
    """Free — nothing is generated. Saved as a new version, so the state
    being left can be restored in turn."""
    project = _owned_project(project_id, db, user)
    try:
        version = builder_versions.restore(db, project, number)
    except builder_versions.VersionError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    _refresh_runtime(db, config, project)
    db.commit()
    db.refresh(project)
    db.refresh(version)
    return RestoreRead(
        files=_file_rows(db, project),
        version=_version_read(version, project),
        project=BuilderProjectRead.model_validate(project),
    )


@router.post(
    "/projects/{project_id}/runtime",
    response_model=BuilderProjectRead,
    summary="미리보기 갱신: write the project's files to the apps origin",
)
def refresh_runtime(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> BuilderProject:
    project = _owned_project(project_id, db, user)
    try:
        app_runtime.write_draft(db, config, project, builder_versions.current_files(db, project))
    except app_runtime.AppRuntimeError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    db.commit()
    db.refresh(project)
    return project


# ------------------------------------------------ ctrlaiapps-publish


@router.patch(
    "/projects/{project_id}/versions/{number}",
    response_model=VersionRead,
    summary="버전 저장: name or pin a version",
)
def label_version(
    project_id: int,
    number: int,
    payload: VersionLabel,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
) -> VersionRead:
    project = _owned_project(project_id, db, user)
    try:
        version = builder_versions.label(
            db, project, number, name=payload.label, pinned=payload.pinned
        )
    except builder_versions.VersionError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    db.commit()
    db.refresh(version)
    return _version_read(version, project)


@router.post(
    "/projects/{project_id}/publish",
    response_model=BuilderProjectRead,
    summary="게시 / 업데이트 게시: the newest version goes on CtrlAIApps",
)
def publish_project(
    project_id: int,
    payload: PublishRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> BuilderProject:
    """Participating members only, like any change. Free — nothing is
    generated. The public folder gets exactly that version's files."""
    project = _owned_project(project_id, db, user)
    if payload.name is not None and payload.name.strip() and payload.name.strip() != project.name:
        project.name = _checked_name(payload.name)
    try:
        app_publish.publish(
            db, config, project, description=payload.description, note=payload.note
        )
    except app_publish.PublishError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    db.commit()
    db.refresh(project)
    return project


@router.post(
    "/projects/{project_id}/unpublish",
    response_model=BuilderProjectRead,
    summary="게시 취소: off CtrlAIApps; every version stays",
)
def unpublish_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    config: Settings = Depends(get_settings),
) -> BuilderProject:
    """`get_current_user`, not `require_active_member`: taking one's own
    work *down* must keep working after a quarter ends, like the download."""
    project = _owned_project(project_id, db, user)
    app_publish.unpublish(db, config, project)
    db.commit()
    db.refresh(project)
    return project
