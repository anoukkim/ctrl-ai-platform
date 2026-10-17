"""Project Builder routes.

Every query is scoped to the current member. There is deliberately no
"fetch any project by id" path: `_owned_project` is the only way a row is
loaded, and it always filters by owner — and now by `deleted_at IS NULL`,
so a deleted project is invisible to its owner through every route rather
than only the ones that remembered to check.
"""

import asyncio

import anyio
import anyio.from_thread
import functools
import json
import logging
from datetime import datetime, timezone
from urllib.parse import quote

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_active_member
from app.api.uploads import clean_upload_name, file_response, read_upload_body
from app.db.session import get_db
from app.models import (
    BuilderGeneration,
    BuilderProject,
    BuilderProjectFile,
    BuilderProjectStatus,
    BuilderProjectStep,
    BuilderProjectVersion,
    User,
)
from app.schemas.builder import (
    AiAccessRequest,
    BuilderProjectCreate,
    BuilderProjectFromChat,
    BuilderProjectFromTemplate,
    BuilderProjectRead,
    BuilderProjectUpdate,
    ProjectPinSet,
    BuilderTemplateRead,
    EmptyBody,
)
from app.core.config import Settings, get_settings
from app.schemas.builder import (
    BuilderAssetRead,
    BuilderFileRead,
    BuilderReferenceRead,
    BuilderModelOption,
    EditEstimateRead,
    GenerationRead,
    GenerationRun,
    PlanRequest,
    PlanStep,
    GenerateRead,
    GenerateRequest,
    HandoffFile,
    HandoffRead,
    HistoryRead,
    PublishRequest,
    PublishSummaryRead,
    RestoreRead,
    SaveRead,
    StepGoRead,
    StepRead,
    VersionLabel,
    VersionSave,
    StarterEstimateRead,
    StarterRead,
    StarterRequest,
    VersionFileRead,
    VersionRead,
)
from app.services import (
    app_ai_access,
    app_publish,
    app_runtime,
    builder_edit,
    builder_files,
    builder_stages,
    builder_starter,
    builder_templates,
    builder_versions,
    chat_limits,
    chat_models,
    pricing,
    project_handoff,
    provider_limiter,
    publish_summary,
    project_zip,
)
from app.services import attachments as attachments_service
from app.services import builder_assets, builder_references, chat_carry, chat_runs, thumbnail_render, thumbnails
from app.services import usage as usage_service
from app.services.attachments import AttachmentRefusal
from app.services.quiet import quiet_update
from app.services.storage import get_storage
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
        # quality-tuning Q1: a new project starts at the member's default.
        chat_model_id=user.default_chat_model_id,
        depth=user.default_depth,
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
    (chat-plus-artifacts). Free to the member — the member's own reply is
    copied. `require_active_member` like creating a project.

    chat-to-builder-carry: the name is the page's own (`<title>` / first
    heading), else one tiny club-absorbed Claude call, else the name sent;
    the member's requests in that conversation become SPEC.md."""
    if len(payload.html.encode("utf-8")) > FROM_CHAT_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="페이지가 너무 커서(200KB 초과) Builder로 보낼 수 없습니다.",
        )
    asked = chat_carry.requirements(db, user, payload.conversation_id, payload.reply_id)
    candidate = chat_carry.page_name(payload.html)
    owned = payload.conversation_id is not None and chat_carry.owns(db, user, payload.conversation_id)
    if candidate is None and owned:
        # The one call this route may make, on the event loop (this route
        # runs in a worker thread); nothing else here waits on it.
        candidate = anyio.from_thread.run(
            functools.partial(
                chat_carry.claude_name, db, settings, get_claude_provider(settings), user=user, page=payload.html, asked=asked
            )
        )
    name = "채팅에서 만든 페이지"
    # From a conversation, the name sent (its cut title) is never used —
    # the page's own, Claude's, or the default (owner, 2026-10-17).
    # Without one (an API caller naming its project), the name sent comes first.
    options = (candidate,) if payload.conversation_id is not None else (payload.name, candidate)
    for option in options:
        if not option:
            continue
        try:
            name = clean_name(option)
            break
        except InvalidNameError:
            continue
    project = BuilderProject(
        owner_user_id=user.id,
        name=name,
        description=payload.description.strip()[:2000],
    )
    db.add(project)
    db.flush()
    files = {"index.html": payload.html}
    if asked:
        files[chat_carry.SPEC_PATH] = chat_carry.spec_md(name, asked)
    for path, content in files.items():
        db.add(BuilderProjectFile(project_id=project.id, path=path, content=content))
    db.flush()
    note = f"채팅에서 가져왔어요 · 요구사항 {len(asked)}개" if asked else "채팅에서 가져옴"
    builder_versions.snapshot(db, project, note, files, settings)
    _refresh_runtime(db, settings, project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/templates", response_model=list[BuilderTemplateRead], summary="The start screen's templates")
def list_templates(_: User = Depends(get_current_user)) -> list[BuilderTemplateRead]:
    return [
        BuilderTemplateRead(key=t.key, name=t.name, description=t.description, uses=list(t.uses))
        for t in builder_templates.TEMPLATES
    ]


@router.post(
    "/projects/from-template",
    response_model=BuilderProjectRead,
    status_code=status.HTTP_201_CREATED,
    summary="A project from a start-screen template (app-platform P4)",
)
def create_project_from_template(
    payload: BuilderProjectFromTemplate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> BuilderProject:
    """Like from-chat: the files are copied, nothing is generated, nothing
    is charged. The template's files are checked by the same rules as any
    project's, so a broken template can never reach the runtime."""
    template = builder_templates.get(payload.template)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="그런 템플릿이 없어요.")
    try:
        files = builder_templates.files_of(template)
    except (OSError, builder_files.FileRuleError) as error:
        logger.error("template %s unusable: %s", template.key, error)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="템플릿을 읽지 못했어요. 관리자에게 알려 주세요."
        ) from error
    project = BuilderProject(
        owner_user_id=user.id,
        name=_checked_name(payload.name) if payload.name.strip() else template.name,
        # No description: 게시 pre-fills CtrlAIApps's blurb from it, and the
        # template's start-screen line is not this member's app.
        description="",
        chat_model_id=user.default_chat_model_id,
        depth=user.default_depth,
    )
    db.add(project)
    db.flush()
    for path, content in files.items():
        db.add(BuilderProjectFile(project_id=project.id, path=path, content=content))
    db.flush()
    builder_versions.snapshot(db, project, f"템플릿: {template.name}", files, settings)
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
    if changes.get("chat_model_id") is not None:
        try:
            chat_models.checked_choice(db, user, changes["chat_model_id"])
        except chat_models.ModelChoiceError as error:
            raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    for key in ("chat_model_id", "depth"):
        # Clearing a choice is not offered: the picker always has one.
        if key in changes and changes[key] is None:
            del changes[key]
    for field, value in changes.items():
        setattr(project, field, value)

    db.commit()
    db.refresh(project)
    return project


@router.post(
    "/projects/{project_id}/pin",
    response_model=BuilderProjectRead,
    summary="맨 위에 고정 / 고정 해제 (ui-improvements)",
)
def set_pinned(
    project_id: int,
    payload: ProjectPinSet,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BuilderProject:
    """A pin is how the owner reads their own list, not a change to the
    work — so, like ★ on CtrlAIApps, it works while not taking part this
    quarter (`get_current_user`), and it never moves `updated_at`: a
    timestamp on the row, so "pinned first, then by date" has a date."""
    project = _owned_project(project_id, db, user)
    quiet_update(db, project, pinned_at=datetime.now(timezone.utc) if payload.on else None)
    db.commit()
    db.refresh(project)
    return project


def handoff_read(
    db: Session, project: BuilderProject, bundle: project_handoff.Bundle, *, with_content: bool = False
) -> HandoffRead:
    """The ZIP described — shared by the member's panel and the admin preview."""
    latest = builder_versions.latest(db, project)
    return HandoffRead(
        which=bundle.which,
        version_number=bundle.version_number,
        filename=bundle.filename,
        draft_version_number=latest.number if latest is not None else 0,
        published_version_number=project.published_version_number,
        files=[
            HandoffFile(
                path=path,
                bytes=len(content.encode("utf-8")),
                generated=path in bundle.generated,
                content=content if with_content else None,
            )
            for path, content in bundle.files.items()
        ],
        prompt=bundle.prompt,
        extra_marker=project_handoff.EXTRA_MARKER,
        extra_label=project_handoff.EXTRA_LABEL,
        max_extra=project_handoff.MAX_EXTRA,
        claude_code_first_line=project_handoff.CLAUDE_CODE_FIRST_LINE,
    )


def build_bundle(
    db: Session, project: BuilderProject, which: project_handoff.Which, extra: str
) -> project_handoff.Bundle:
    """`project_handoff.bundle`, its refusals turned into HTTP answers."""
    try:
        return project_handoff.bundle(db, project, which, extra)
    except project_handoff.HandoffError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except project_zip.ProjectTooLargeError as error:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(error)
        ) from error


@router.get(
    "/projects/{project_id}/download",
    summary="프로젝트 내려받기: the project as a ZIP, with README / CLAUDE.md / HANDOFF_PROMPT / HISTORY",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}, "description": "The project as a ZIP"}},
)
def download_project(
    project_id: int,
    version: project_handoff.Which = Query("draft"),
    extra: str = Query("", max_length=2000),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    config_for_zip: Settings = Depends(get_settings),
) -> Response:
    """Pack the chosen version (작업 중 by default, or 게시된 버전) with the
    guides that let the member carry on with their own Claude
    (`services/project_handoff.py`). `extra` fills the prompt's blank.

    **`get_current_user`, not `require_active_member`** — and that is the
    point of the feature. A member who did not join this quarter cannot
    create or edit, but their work is theirs: taking a copy out has to
    keep working, or "their projects remain" (CLAUDE.md section 10) is a
    promise the product does not keep.

    A deleted project is not downloadable: `_owned_project` already
    answers 404 for it, the same answer the member gets everywhere else.
    The archive is built in memory; `project_zip` caps the total.
    """
    project = _owned_project(project_id, db, user)
    bundle = build_bundle(db, project, version, extra)
    # builder-images (2): the app's pictures go in too (they belong to the
    # project, whichever version is downloaded).
    packed: dict[str, str | bytes] = dict(bundle.files)
    for path, data in builder_assets.contents(db, get_storage(config_for_zip), project).items():
        packed.setdefault(path, data)
    try:
        payload = project_zip.pack(packed)
    except project_zip.ProjectTooLargeError as error:  # pragma: no cover — bundle checked it
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(error)
        ) from error

    # Both forms of the name, on purpose. `filename*` carries the Korean
    # one as UTF-8 and is what every current browser reads; the plain
    # `filename` is the ASCII fallback for anything that does not, and
    # without it such a client saves the response as the route's last
    # path segment — a file called "download" with no extension.
    disposition = f'attachment; filename="{bundle.ascii_filename}"; ' + (
        f"filename*=UTF-8''{quote(bundle.filename)}"
    )

    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": disposition},
    )


@router.get(
    "/projects/{project_id}/handoff",
    response_model=HandoffRead,
    summary="내 Claude로 이어서 만들기: what the ZIP holds, and the prompt",
)
def project_handoff_read(
    project_id: int,
    version: project_handoff.Which = Query("draft"),
    extra: str = Query("", max_length=2000),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HandoffRead:
    """The file list (no contents) and the claude.ai prompt, for the panel.
    Open to inactive members, like the download itself."""
    project = _owned_project(project_id, db, user)
    return handoff_read(db, project, build_bundle(db, project, version, extra))


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
    user: User = Depends(get_current_user),
    config: Settings = Depends(get_settings),
) -> StarterEstimateRead:
    try:
        figures = builder_starter.estimate(db, config, user)
    except (pricing.PricingError, chat_models.ModelChoiceError) as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))
    return StarterEstimateRead(
        estimated_krw=figures.estimated_krw,
        worst_case_krw=figures.worst_case_krw,
        model_label=figures.model_label,
        depth=figures.depth,
        max_krw=figures.max_krw,
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
        return
    # draft-server-thumbnails: with THUMBNAIL_RENDERER=server the new working
    # copy is photographed by the worker too (the Builder card); the
    # in-browser capture still runs. Queued only once the caller commits:
    # the job reads the row in its own session, and a new project or a
    # first draft (slug just made) must be there to be read.
    thumbnail_render.enqueue_after_commit(db, settings, project.id, "draft")


def _version_read(
    version: BuilderProjectVersion,
    project: BuilderProject | None = None,
    generation: BuilderGeneration | None = None,
) -> VersionRead:
    made = generation is not None
    return VersionRead(
        request=generation.request if made else "",
        summary=generation.summary if made else "",
        changed_count=len(set(generation.files_done) | set(generation.check_fixed)) if made else None,
        charged_krw=generation.charged_krw if made else None,
        number=version.number,
        note=version.note,
        created_at=version.created_at,
        file_count=len(version.files),
        total_bytes=sum(len(str(content).encode("utf-8")) for _path, content in version.files),
        label=version.label,
        pinned=version.pinned,
        published=project is not None and project.published_version_id == version.id,
    )


def _step_read(
    step: BuilderProjectStep,
    project: BuilderProject,
    generation: BuilderGeneration | None = None,
) -> StepRead:
    made = generation is not None
    return StepRead(
        seq=step.seq,
        note=step.note,
        created_at=step.created_at,
        current=project.step_seq == step.seq,
        request=generation.request if made else "",
        summary=generation.summary if made else "",
        changed_count=len(set(generation.files_done) | set(generation.check_fixed)) if made else None,
        charged_krw=generation.charged_krw if made else None,
    )


def _history_read(db: Session, project: BuilderProject) -> HistoryRead:
    """The undo history, the generations that made its steps, and whether
    the working copy has unsaved work."""
    steps = builder_versions.list_steps(db, project)
    made_by = {
        generation.step_id: generation
        for generation in db.scalars(
            select(BuilderGeneration).where(
                BuilderGeneration.step_id.in_([step.id for step in steps] or [0]),
                BuilderGeneration.status == "done",
            )
        )
    }
    seqs = [step.seq for step in steps]
    at = project.step_seq
    reference = builder_versions.reference_version(db, project)
    newest = builder_versions.latest(db, project)
    return HistoryRead(
        steps=[_step_read(step, project, made_by.get(step.id)) for step in steps],
        can_undo=at is not None and any(seq < at for seq in seqs),
        can_redo=at is not None and any(seq > at for seq in seqs),
        unsaved=builder_versions.has_unsaved(db, project),
        reference_version_number=reference.number if reference is not None else None,
        latest_version_number=newest.number if newest is not None else None,
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
        figures = builder_edit.estimate(db, config, user, project, request)
    except (pricing.PricingError, chat_models.ModelChoiceError) as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))
    return EditEstimateRead(
        estimated_krw=figures.estimated_krw,
        worst_case_krw=figures.worst_case_krw,
        model_label=figures.model_label,
        max_output_tokens=figures.max_output_tokens,
        chat_model_id=figures.chat_model_id,
        depth=figures.depth,
        max_krw=figures.max_krw,
        models=[BuilderModelOption(**option) for option in figures.models],
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
    db.refresh(result.step)
    return GenerateRead(
        files=_file_rows(db, project),
        changed=result.changed,
        summary=result.summary,
        charged_krw=result.charged_krw,
        step=_step_read(result.step, project),
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
    versions = builder_versions.list_versions(db, project)
    # The generation that made each version, for the Claude panel's history.
    made_by = {
        generation.version_id: generation
        for generation in db.scalars(
            select(BuilderGeneration).where(
                BuilderGeneration.version_id.in_([version.id for version in versions]),
                BuilderGeneration.status == "done",
            )
        )
    }
    return [_version_read(version, project, made_by.get(version.id)) for version in versions]


@router.get(
    "/projects/{project_id}/versions/{number}/files",
    response_model=list[VersionFileRead],
    summary="이 버전 보기: a saved version's files, read-only",
)
def version_files(
    project_id: int,
    number: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VersionFileRead]:
    """Readable while not participating, like the files themselves. Free;
    nothing changes — the Builder previews these in the page."""
    project = _owned_project(project_id, db, user)
    try:
        version = builder_versions.find(db, project, number)
    except builder_versions.VersionError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    return [
        VersionFileRead(path=str(path), content=str(content))
        for path, content in sorted(version.files, key=lambda pair: str(pair[0]))
    ]


@router.post(
    "/projects/{project_id}/versions/{number}/restore",
    response_model=RestoreRead,
    summary="불러오기: make the working copy the files of one saved version",
)
def restore_version(
    project_id: int,
    number: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> RestoreRead:
    """Free — nothing is generated. Changes the working copy only
    (builder-snapshots): no version is made, and the state being left is a
    작업 step, so 실행 취소 brings it back. The Builder asks about unsaved
    work first; the server does not refuse."""
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
    "/projects/{project_id}/versions",
    response_model=SaveRead,
    summary="버전 저장: the working copy as the next saved version",
)
def save_version(
    project_id: int,
    payload: VersionSave,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> SaveRead:
    """Free. A version is only ever made here, by 게시, or when a project
    starts. Files equal to the version they stand on make nothing
    (`created: false`, the Builder says "이미 같아요")."""
    project = _owned_project(project_id, db, user)
    try:
        version, created = builder_versions.save(db, project, name=payload.label, settings=config)
    except builder_versions.VersionError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    db.commit()
    db.refresh(project)
    db.refresh(version)
    return SaveRead(created=created, version=_version_read(version, project), project=BuilderProjectRead.model_validate(project))


@router.get(
    "/projects/{project_id}/steps",
    response_model=HistoryRead,
    summary="The 작업 steps (실행 취소 / 다시 실행) and whether there is unsaved work",
)
def list_steps(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HistoryRead:
    """Readable while not participating, like the files themselves."""
    return _history_read(db, _owned_project(project_id, db, user))


@router.post(
    "/projects/{project_id}/steps/{seq}/restore",
    response_model=StepGoRead,
    summary="실행 취소 / 다시 실행 / 이 단계로: the working copy as it was at one step",
)
def restore_step(
    project_id: int,
    seq: int,
    payload: EmptyBody,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> StepGoRead:
    """Free; changes the working copy only. The Builder sends the
    neighbouring step for 실행 취소 / 다시 실행."""
    project = _owned_project(project_id, db, user)
    try:
        builder_versions.go_to_step(db, project, seq)
    except builder_versions.VersionError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    _refresh_runtime(db, config, project)
    db.commit()
    db.refresh(project)
    return StepGoRead(files=_file_rows(db, project), project=BuilderProjectRead.model_validate(project))


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


ThumbnailSpace = Literal["draft", "published"]


@router.post(
    "/projects/{project_id}/thumbnail",
    response_model=BuilderProjectRead,
    summary="Store a thumbnail captured in the maker's browser (the body is the image's bytes)",
)
async def upload_thumbnail(
    project_id: int,
    request: Request,
    space: ThumbnailSpace = Query(default="draft"),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> BuilderProject:
    """ui-improvements (owner-polish 4·5). The picture was drawn by the SDK
    inside the app frame and relayed by the shell; the server only checks
    and re-encodes it (`thumbnails.encode`). `draft` stamps the working
    copy; `published` stamps the version now published (409 without one).
    Raw bytes, like Chat's and feedback's uploads — the JSON-body rule's
    documented exception."""
    project = _owned_project(project_id, db, user)
    version = project.published_version if space == "published" else None
    if space == "published" and version is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=thumbnails.NOT_PUBLISHED)
    data = await read_upload_body(
        request, thumbnails.MAX_UPLOAD_BYTES, thumbnails.TOO_BIG, "썸네일은 application/octet-stream 형식으로 보내 주세요."
    )
    # fix-draft-thumbs: while the server renders, the browser's picture is
    # only the fallback — a current server picture is kept and the upload
    # is answered as accepted (nothing for the member to fix).
    server_on = thumbnail_render.enabled(settings)
    if (version is not None and not thumbnails.browser_may_replace_version(version, server_on)) or (
        version is None and not thumbnails.browser_may_replace_draft(project, server_on)
    ):
        return project
    storage = get_storage(settings)
    try:
        if version is not None:
            await run_in_threadpool(thumbnails.save_version, db, storage, project, version, data)
        else:
            await run_in_threadpool(thumbnails.save_draft, db, storage, project, data)
    except AttachmentRefusal as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=str(refusal)) from refusal
    db.commit()
    db.refresh(project)
    return project


@router.post(
    "/projects/{project_id}/thumbnail/choice",
    response_model=BuilderProjectRead,
    summary="썸네일 지정: the maker's own picture (the body is the image's bytes)",
)
async def choose_thumbnail(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> BuilderProject:
    """thumbnail-choice (owner, 2026-10-17). The picture the maker framed
    over the 미리보기 (or pasted) — checked and re-encoded like every
    upload, then shown on the Builder card and on CtrlAIApps instead of
    the automatic pictures until 자동으로 되돌리기. Raw bytes, like the
    other thumbnail upload (the JSON-body rule's documented exception)."""
    project = _owned_project(project_id, db, user)
    data = await read_upload_body(
        request, thumbnails.MAX_UPLOAD_BYTES, thumbnails.TOO_BIG, "썸네일은 application/octet-stream 형식으로 보내 주세요."
    )
    try:
        await run_in_threadpool(thumbnails.save_chosen, db, get_storage(settings), project, data)
    except AttachmentRefusal as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=str(refusal)) from refusal
    db.commit()
    db.refresh(project)
    return project


@router.post(
    "/projects/{project_id}/thumbnail/choice/reset",
    response_model=BuilderProjectRead,
    summary="자동으로 되돌리기: the automatic thumbnail shows again",
)
def reset_thumbnail_choice(
    project_id: int,
    payload: EmptyBody,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> BuilderProject:
    project = _owned_project(project_id, db, user)
    thumbnails.clear_chosen(db, get_storage(settings), project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects/{project_id}/thumbnail", summary="The project's thumbnail (WebP)")
def read_thumbnail(
    project_id: int,
    space: ThumbnailSpace = Query(default="draft"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Reading your own work: the draft's picture, or the published version's."""
    project = _owned_project(project_id, db, user)
    storage = get_storage(settings)
    data = (
        thumbnails.load_published(storage, project) if space == "published" else thumbnails.load_draft(storage, project)
    )
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="썸네일이 아직 없어요.")
    return file_response(data, thumbnails.MEDIA_TYPE, f"project-{project.id}-{space}.webp", inline=True)


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
            db, config, project, description=payload.description, note=payload.note, ai_access=payload.ai_access
        )
    except app_publish.PublishError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    db.commit()
    db.refresh(project)
    # thumbnail-render-worker: with THUMBNAIL_RENDERER=server the published
    # version is photographed by the server's own browser, in the
    # background, after this answer; the Builder's in-browser capture
    # still runs and is the fallback. A no-op while `browser`.
    thumbnail_render.enqueue(config, project.id)
    return project


@router.post(
    "/projects/{project_id}/publish-summary",
    response_model=PublishSummaryRead,
    summary="The 게시 dialog's pre-filled 설명 and 메모 (publish-summary)",
)
async def publish_summary_read(
    project_id: int,
    payload: EmptyBody,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> PublishSummaryRead:
    """A POST with a JSON body, like every route that writes or spends
    (CLAUDE.md §2): it may make a club-paid Claude call and keeps the
    result on the version. Free to the member, once per working version;
    never an error the dialog has to handle — an empty answer means
    "write your own"."""
    project = _owned_project(project_id, db, user)
    # app-ai-access: whether the working copy calls ctrlai.ai — the dialog
    # asks "다른 회원에게 AI 기능을 열까요?" only then.
    uses_ai = app_ai_access.uses_ai(builder_versions.current_files(db, project))
    hit = publish_summary.cached(db, project)
    if hit is None:
        # A provider slot only for a real call — a stored answer waits for nobody.
        limit = chat_limits.current(db).provider_concurrency
        if not await run_in_threadpool(provider_limiter.acquire, limit):
            return PublishSummaryRead(uses_ai=uses_ai, ai_access=project.ai_access)
        try:
            hit = await publish_summary.summarize(db, config, get_claude_provider(config), user=user, project=project)
        finally:
            provider_limiter.release()
    return PublishSummaryRead(
        description=hit.description, note=hit.note, cached=hit.cached, model=hit.model,
        uses_ai=uses_ai, ai_access=project.ai_access,
    )


@router.post(
    "/projects/{project_id}/ai-access",
    response_model=BuilderProjectRead,
    summary="app-ai-access: open the app's AI to other members (전체 기능) or keep it 데모만",
)
def set_ai_access(
    project_id: int,
    payload: AiAccessRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BuilderProject:
    """The owner's switch, any time after 게시 (and before: the value waits
    for the next 게시). `get_current_user`, like 게시 취소: closing one's
    own app's AI must keep working after a quarter ends, and opening it
    spends nothing of the owner's — a visitor pays for their own calls."""
    project = _owned_project(project_id, db, user)
    project.ai_access = payload.ai_access
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


# ------------------------------------------------ quality-tuning Q2


def _generation_read(
    db: Session,
    settings: Settings,
    user: User,
    project: BuilderProject,
    generation: BuilderGeneration,
) -> GenerationRead:
    version_number = None
    step_seq = None
    if generation.step_id is not None:
        step = db.get(BuilderProjectStep, generation.step_id)
        step_seq = step.seq if step else None
    if generation.version_id is not None:
        version = db.get(BuilderProjectVersion, generation.version_id)
        version_number = version.number if version else None
    estimated = max_call = None
    if generation.status in ("planned", "partial", "failed"):
        try:
            estimated, max_call = builder_stages.run_estimate(db, settings, user, project, generation)
        except (pricing.PricingError, chat_models.ModelChoiceError):
            estimated = max_call = None
    return GenerationRead(
        id=generation.id,
        kind=generation.kind,
        request=generation.request,
        style=generation.style,
        summary=generation.summary,
        plan=[PlanStep(path=step[0], purpose=step[1]) for step in generation.plan],
        files_done=list(generation.files_done),
        status=generation.status,
        check_summary=generation.check_summary,
        check_fixed=list(generation.check_fixed),
        charged_krw=generation.charged_krw,
        error=generation.error,
        version_number=version_number,
        step_seq=step_seq,
        created_at=generation.created_at,
        estimated_krw=estimated,
        max_call_krw=max_call,
    )


def _owned_generation(
    db: Session, project: BuilderProject, generation_id: int
) -> BuilderGeneration:
    generation = db.get(BuilderGeneration, generation_id)
    if generation is None or generation.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="찾을 수 없는 작업이에요.")
    return generation


@router.post(
    "/projects/{project_id}/plan",
    response_model=GenerationRead,
    status_code=status.HTTP_201_CREATED,
    summary="만들기 / 고치기, stage 1: Claude plans the files (charged)",
)
def plan_generation(
    project_id: int,
    payload: PlanRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> GenerationRead:
    """See `services/builder_stages.py`."""
    project = _owned_project(project_id, db, user)
    try:
        generation = builder_stages.plan(
            db,
            config,
            get_claude_provider(config),
            user=user,
            project=project,
            request=builder_stages.brief_text(
                payload.request, payload.who, payload.features, payload.mood
            ),
            style=payload.style,
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
    return _generation_read(db, config, user, project, generation)


@router.get(
    "/projects/{project_id}/generation",
    response_model=GenerationRead | None,
    summary="The project's unfinished generation, if any",
)
def read_open_generation(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    config: Settings = Depends(get_settings),
) -> GenerationRead | None:
    project = _owned_project(project_id, db, user)
    # background-runs: a build a restart left "running" becomes 이어서 만들기.
    chat_runs.sweep(db, user_id=user.id)
    generation = builder_stages.open_generation(db, project)
    return _generation_read(db, config, user, project, generation) if generation else None


@router.post(
    "/projects/{project_id}/generations/{generation_id}/cancel",
    response_model=GenerationRead,
    summary="Drop a plan or an unfinished generation (free; saved files stay)",
)
def cancel_generation(
    project_id: int,
    generation_id: int,
    payload: GenerationRun,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> GenerationRead:
    project = _owned_project(project_id, db, user)
    generation = _owned_generation(db, project, generation_id)
    if generation.status == "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="만드는 중에는 취소할 수 없어요.")
    if generation.status in ("planned", "partial", "failed"):
        generation.status = "cancelled"
        db.commit()
    return _generation_read(db, config, user, project, generation)


#: Seconds without a step before the stream sends a keepalive — every hop
#: (Caddy, the Next.js proxy) stays open while one file is being written.
GENERATION_KEEPALIVE_SECONDS = 10.0

#: background-runs: how often a running build touches its heartbeat.
GENERATION_BEAT_SECONDS = 5.0

#: Runs still going after their response ended (the member closed the tab):
#: they finish, so every file that was paid for is saved.
_RUNNING: set[asyncio.Task] = set()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


@router.post(
    "/projects/{project_id}/generations/{generation_id}/run",
    summary="시작 / 이어서 만들기: files one by one, then a self-check (Server-Sent Events)",
    responses={200: {"content": {"text/event-stream": {}}}},
)
def run_generation(
    project_id: int,
    generation_id: int,
    payload: GenerationRun,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> StreamingResponse:
    """Each step arrives as an event — file_start, file_done, check_start,
    check_done, then done or error. Each file is saved as soon as it is
    written; a run cut short keeps them, and this route again continues
    with the rest."""
    project = _owned_project(project_id, db, user)
    generation = _owned_generation(db, project, generation_id)
    if generation.status in ("done", "cancelled"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 끝난 작업이에요. 새로 요청해 주세요.")
    session_factory = request.app.dependency_overrides.get(get_db, get_db)
    provider = get_claude_provider(config)
    is_mock = config.provider_is_mock("claude")
    user_id = user.id
    queue: asyncio.Queue[tuple[str, dict]] = asyncio.Queue()

    def work(loop: asyncio.AbstractEventLoop) -> None:
        def emit(kind: str, data: dict) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, (kind, data))

        sessions = session_factory()
        worker_db = next(sessions)
        try:
            member = worker_db.get(User, user_id)
            try:
                # background-runs: held while it works — a restart's dead run
                # is told from a slow one by this lock, not by the clock.
                with chat_runs.alive(worker_db.get_bind(), chat_runs.BUILD_LOCK, generation_id):
                    builder_stages.run(
                        worker_db,
                        config,
                        provider,
                        user=member,
                        generation_id=generation_id,
                        emit=emit,
                        is_mock=is_mock,
                    )
            except builder_starter.StarterError as error:
                emit("error", {"detail": str(error), "partial": False, "files_done": []})
            except Exception:  # noqa: BLE001 — the member gets a Korean sentence either way
                logger.exception("builder generation %s failed", generation_id)
                worker_db.rollback()
                row = worker_db.get(BuilderGeneration, generation_id)
                if row is not None and row.status == "running":
                    row.status = "partial" if row.files_done else "failed"
                    row.error = "만드는 중 문제가 생겼어요. 이어서 만들기로 다시 시도해 주세요."
                    worker_db.commit()
                emit(
                    "error",
                    {
                        "detail": "만드는 중 문제가 생겼어요. 이어서 만들기로 다시 시도해 주세요.",
                        "partial": bool(row and row.files_done),
                        "files_done": list(row.files_done) if row else [],
                    },
                )
            finished = worker_db.get(BuilderProject, project_id)
            if finished is not None:
                _refresh_runtime(worker_db, config, finished)
                worker_db.commit()
        finally:
            sessions.close()
            loop.call_soon_threadsafe(queue.put_nowait, ("end", {}))

    def beat_once() -> None:
        sessions = session_factory()
        beat_db = next(sessions)
        try:
            chat_runs.beat_generation(beat_db, generation_id)
        finally:
            sessions.close()

    async def beat(task: asyncio.Task) -> None:
        """background-runs: the run's heartbeat while it works — the Builder
        card's running dot comes from it, and a run a restart left
        "running" is found by its silence (`chat_runs.sweep`)."""
        while not task.done():
            try:
                await run_in_threadpool(beat_once)
            except Exception:  # noqa: BLE001 — the next beat tries again
                logger.exception("builder generation %s heartbeat failed", generation_id)
            try:
                await asyncio.wait_for(asyncio.shield(task), GENERATION_BEAT_SECONDS)
            except asyncio.TimeoutError:
                continue
            except Exception:  # noqa: BLE001 — the run's own failure is handled in work()
                return

    async def relay():
        loop = asyncio.get_running_loop()
        task = asyncio.create_task(run_in_threadpool(work, loop))
        _RUNNING.add(task)
        task.add_done_callback(_RUNNING.discard)
        # Only with the app's own sessions: the tests hand every caller one
        # shared session, which a second thread must not use while the run's
        # thread does (the run stamps its heartbeat when it starts, which is
        # what the tests read).
        if get_db not in request.app.dependency_overrides:
            beating = asyncio.create_task(beat(task))
            _RUNNING.add(beating)
            beating.add_done_callback(_RUNNING.discard)
        while True:
            try:
                kind, data = await asyncio.wait_for(queue.get(), GENERATION_KEEPALIVE_SECONDS)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            if kind == "end":
                break
            yield _sse(kind, data)

    return StreamingResponse(
        relay(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------------------------ builder-images (1)


def _reference_read(row) -> BuilderReferenceRead:
    read = BuilderReferenceRead.model_validate(row)
    read.tokens = builder_references.tokens([row])
    return read


def _owned_reference(db: Session, project: BuilderProject, reference_id: int):
    from app.models import BuilderReference

    row = db.get(BuilderReference, reference_id)
    if row is None or row.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=builder_references.NOT_FOUND)
    return row


@router.post(
    "/projects/{project_id}/references",
    response_model=BuilderReferenceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Attach a reference picture to the next 만들기 / 고치기 (the body is the image's bytes)",
)
async def upload_reference(
    project_id: int,
    request: Request,
    name: str = Query(default="image", max_length=255),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> BuilderReferenceRead:
    """One picture per request, its bytes as the body (`application/
    octet-stream` — the JSON-body rule's documented exception for uploads).
    The kind is read from the bytes; the picture is re-encoded without
    metadata; at most three wait at a time. Free: the pictures are paid for
    by the call that reads them, in its estimate."""
    project = _owned_project(project_id, db, user)
    data = await read_upload_body(
        request,
        settings.chat_attachment_image_max_mb * attachments_service.MB,
        builder_references.too_big(settings.chat_attachment_image_max_mb),
        "사진은 application/octet-stream 형식으로 보내 주세요.",
    )
    try:
        row = await run_in_threadpool(
            builder_references.add,
            db,
            get_storage(settings),
            settings,
            user=user,
            project=project,
            data=data,
            name=clean_upload_name(name, "image"),
        )
    except AttachmentRefusal as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=str(refusal)) from refusal
    db.commit()
    db.refresh(row)
    return _reference_read(row)


@router.get(
    "/projects/{project_id}/references",
    response_model=list[BuilderReferenceRead],
    summary="Reference pictures waiting for the next 만들기 / 고치기",
)
def list_references(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BuilderReferenceRead]:
    project = _owned_project(project_id, db, user)
    return [_reference_read(row) for row in builder_references.pending(db, project)]


@router.get(
    "/projects/{project_id}/references/{reference_id}/file",
    summary="One reference picture (the owner's own, for the request box)",
)
def read_reference(
    project_id: int,
    reference_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    project = _owned_project(project_id, db, user)
    row = _owned_reference(db, project, reference_id)
    try:
        data = get_storage(settings).load(row.storage_key)
    except (OSError, ValueError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=builder_references.NOT_FOUND) from None
    return file_response(data, row.media_type, f"reference-{row.id}", inline=True)


@router.delete(
    "/projects/{project_id}/references/{reference_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="✕ — take a waiting reference picture out of the request box",
)
def delete_reference(
    project_id: int,
    reference_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> Response:
    project = _owned_project(project_id, db, user)
    row = _owned_reference(db, project, reference_id)
    try:
        builder_references.remove(db, get_storage(settings), row)
    except AttachmentRefusal as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=str(refusal)) from refusal
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------ builder-images (2)


def _owned_asset(db: Session, project: BuilderProject, asset_id: int):
    from app.models import BuilderAsset

    row = db.get(BuilderAsset, asset_id)
    if row is None or row.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=builder_assets.NOT_FOUND)
    return row


@router.post(
    "/projects/{project_id}/assets",
    response_model=BuilderAssetRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a picture to the app (the body is the image's bytes)",
)
async def upload_asset(
    project_id: int,
    request: Request,
    name: str = Query(default="image", max_length=255),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> BuilderAssetRead:
    """The picture is checked from its bytes, re-encoded without metadata
    and stored at `images/<name>`; the preview is written again so the app
    can show it at once. Free — nothing is generated."""
    project = _owned_project(project_id, db, user)
    data = await read_upload_body(
        request,
        settings.chat_attachment_image_max_mb * attachments_service.MB,
        f"사진이 너무 커요 (1장 {settings.chat_attachment_image_max_mb}MB 이하).",
        "사진은 application/octet-stream 형식으로 보내 주세요.",
    )
    try:
        row = await run_in_threadpool(
            builder_assets.add,
            db,
            get_storage(settings),
            settings,
            user=user,
            project=project,
            data=data,
            name=clean_upload_name(name, "image"),
        )
    except AttachmentRefusal as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=str(refusal)) from refusal
    _refresh_runtime(db, settings, project)
    db.commit()
    db.refresh(row)
    return BuilderAssetRead.model_validate(row)


@router.get(
    "/projects/{project_id}/assets",
    response_model=list[BuilderAssetRead],
    summary="The app's pictures",
)
def list_assets(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BuilderAssetRead]:
    project = _owned_project(project_id, db, user)
    return [BuilderAssetRead.model_validate(row) for row in builder_assets.listed(db, project)]


@router.get(
    "/projects/{project_id}/assets/{asset_id}/file",
    summary="One of the app's pictures (the owner's own)",
)
def read_asset(
    project_id: int,
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    project = _owned_project(project_id, db, user)
    row = _owned_asset(db, project, asset_id)
    try:
        data = get_storage(settings).load(row.storage_key)
    except (OSError, ValueError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=builder_assets.NOT_FOUND) from None
    return file_response(data, row.media_type, row.path.rsplit("/", 1)[-1], inline=True)


@router.delete(
    "/projects/{project_id}/assets/{asset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Take a picture out of the app",
)
def delete_asset(
    project_id: int,
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    settings: Settings = Depends(get_settings),
) -> Response:
    project = _owned_project(project_id, db, user)
    row = _owned_asset(db, project, asset_id)
    builder_assets.remove(db, get_storage(settings), row)
    _refresh_runtime(db, settings, project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
