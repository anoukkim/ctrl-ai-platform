"""Video Generator routes: the member-facing model list, projects and versions.

Every generation, edit and extension goes through the video provider
behind `VIDEO_PROVIDER` (mock by default — see
`app/services/video_provider.py`) and is charged to the member's **Video**
budget through `app/services/usage.py`. The prompt helper is a Claude call
and is charged to **Build**; it rewrites text and never reaches the video
provider.

What a model allows and costs is its catalogue entry
(`app/services/video_catalog.py`).
"""

from collections.abc import Callable
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import quote

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_active_member
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import (
    BudgetCategory,
    UsageFeature,
    User,
    VideoModel,
    VideoProject,
    VideoProjectStatus,
    VideoVersion,
    VideoVersionKind,
    VideoVersionStatus,
)
from app.schemas.video import (
    PromptHelpRead,
    PromptHelpRequest,
    VideoEditCreate,
    VideoExtendCreate,
    VideoModelRead,
    VideoProjectCreate,
    VideoProjectDetail,
    VideoProjectRead,
    VideoProjectUpdate,
    VideoVersionCreate,
    VideoVersionRead,
)
from app.services import (
    chat_models,
    pricing,
    project_zip,
    providers,
    video_assets,
    video_catalog,
)
from app.services import usage as usage_service
from app.services.claude_provider import (
    PROMPT_HELP_SYSTEM,
    ClaudeError,
    get_claude_provider,
)
from app.services.storage import StorageKeyError, get_storage
from app.services.video_provider import (
    EditRequest,
    ExtendRequest,
    GenerateRequest,
    ProviderResult,
    ProviderUnavailableError,
    VideoGenerationProvider,
    get_video_provider,
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


#: The library's three filters: 전체 / Draft / 게시됨.
LibraryFilter = Literal["all", "draft", "published"]


@router.get("/projects", response_model=list[VideoProjectRead], summary="List my video projects")
def list_projects(
    status_filter: LibraryFilter = Query(default="all", alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VideoProject]:
    """The member's own video projects, newest first.

    `status` is the library's filter, exactly as the member sees it:
    `all`, `draft` (everything not yet published — draft, generating
    and ready) or `published`.
    """
    query = select(VideoProject).where(
        VideoProject.owner_user_id == user.id,
        VideoProject.deleted_at.is_(None),
    )
    if status_filter == "published":
        query = query.where(VideoProject.status == VideoProjectStatus.PUBLISHED)
    elif status_filter == "draft":
        query = query.where(VideoProject.status != VideoProjectStatus.PUBLISHED)
    return list(db.scalars(query.order_by(VideoProject.updated_at.desc())))


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
    # After the changes, so a status sent in the same request cannot leave
    # a project with a final version marked Draft.
    project.apply_final_version_rule()

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


# ---------------------------------------------------------------- versions
#
# Generate, edit and extend share one path through `_produce`: check the
# budget, call the provider, store the file, then charge — the version row
# and the deduction committed together, so neither exists without the
# other. A refused or failed call is never charged.


def _http_error(error: Exception) -> HTTPException:
    """The budget and provider failures as the status the screen expects."""
    if isinstance(error, usage_service.InsufficientBudgetError):
        return HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(error))
    if isinstance(error, usage_service.NoQuarterError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    if isinstance(error, video_catalog.SettingsError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    if isinstance(error, chat_models.ModelChoiceError):
        return HTTPException(status_code=error.status_code, detail=str(error))
    if isinstance(error, (ProviderUnavailableError, ClaudeError, pricing.PricingError)):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))
    raise error


def _produce(
    db: Session,
    *,
    user: User,
    project: VideoProject,
    model: VideoModel,
    config: Settings,
    call: Callable[[VideoGenerationProvider], ProviderResult],
    feature: UsageFeature,
    charged_seconds: int,
    version: VideoVersion,
) -> VideoVersion:
    """Run one paid video operation and record it. See the note above."""
    try:
        amount = video_catalog.cost_krw(model, version.resolution or "", charged_seconds)
        # Refused here, nothing has been spent: the provider is not called.
        usage_service.ensure_affordable(
            db, user=user, category=BudgetCategory.VIDEO, amount_krw=amount
        )
        result = call(get_video_provider(config))
    except (
        usage_service.InsufficientBudgetError,
        usage_service.NoQuarterError,
        video_catalog.SettingsError,
        ProviderUnavailableError,
    ) as error:
        raise _http_error(error) from error

    version.provider_job_id = result.job_id
    db.add(version)
    # Flushed rather than committed: the version needs its id to build a
    # storage key, and the row must not be visible without its file.
    db.flush()
    version.asset_storage_key = video_assets.store(
        get_storage(config), project_id=project.id, version_id=version.id, asset=result.asset
    )

    try:
        usage_service.charge(
            db,
            user=user,
            category=BudgetCategory.VIDEO,
            amount_krw=amount,
            provider=model.provider,
            feature=feature.value,
            model_id=model.model_id,
            provider_units=charged_seconds,
            provider_unit="seconds",
            provider_cost=None,
            video_project_id=project.id,
            video_version_id=version.id,
            commit=False,
        )
    except (usage_service.InsufficientBudgetError, usage_service.NoQuarterError) as error:
        # Lost a race with another charge after the pre-check. The version
        # goes with the rollback, so the member is not left with a video
        # nobody paid for — nor charged for one they were refused.
        db.rollback()
        raise _http_error(error) from error

    db.commit()
    db.refresh(version)
    db.refresh(project)
    return version


def _source_version(project: VideoProject, version_id: int) -> VideoVersion:
    """A finished version of this project with its settings recorded.

    Edit and extend inherit length, ratio and resolution from the source,
    and the price depends on them. A version made before those were
    recorded has no honest price, so it cannot be the source.
    """
    source = next((row for row in project.versions if row.id == version_id), None)
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="버전을 찾을 수 없습니다.")
    if source.status is not VideoVersionStatus.READY or not source.asset_storage_key:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="아직 완성되지 않은 버전은 수정하거나 이어서 만들 수 없습니다.",
        )
    if not (source.duration_seconds and source.aspect_ratio and source.resolution):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이 버전은 만든 설정이 기록되지 않아 수정하거나 이어서 만들 수 없습니다.",
        )
    return source


def _model_of(db: Session, version: VideoVersion) -> VideoModel:
    """The model that made `version`, if members may still use it.

    Edit and extend run on the source's own model: framing and resolution
    come from the source, and another model may not offer them.
    """
    model = next(
        (
            m
            for m in _allowed_models(db)
            if m.provider == version.provider and m.model_id == version.model_id
        ),
        None,
    )
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이 버전을 만든 모델은 지금 사용할 수 없습니다.",
        )
    return model


def _load_source_file(config: Settings, source: VideoVersion) -> bytes:
    try:
        return get_storage(config).load(source.asset_storage_key or "")
    except (OSError, StorageKeyError) as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="원본 영상 파일을 찾을 수 없어 이어서 작업할 수 없습니다.",
        ) from error


@router.post(
    "/projects/{project_id}/versions",
    response_model=VideoVersionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a version (text-to-video)",
)
def create_version(
    project_id: int,
    settings: VideoVersionCreate | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    # Named `config` because `settings` above is already taken by the
    # request body — the generation settings the member asked for.
    config: Settings = Depends(get_settings),
) -> VideoVersion:
    """Generate a version from the project's current prompt and model.

    Length, ratio, resolution and sound come from the request; anything
    left out is the model's default, so a version always records the
    exact settings it was made with. Anything the model's catalogue entry
    does not offer is refused — a browser can send anything, so a model
    that only does 9:16 must refuse 16:9 here, not merely hide the button.
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

    try:
        chosen = video_catalog.resolve_generation(model, settings or VideoVersionCreate())
    except video_catalog.SettingsError as error:
        raise _http_error(error) from error

    version = VideoVersion(
        project_id=project.id,
        provider=model.provider,
        model_id=model.model_id,
        prompt_snapshot=project.prompt,
        kind=VideoVersionKind.GENERATE,
        duration_seconds=chosen.duration_seconds,
        aspect_ratio=chosen.aspect_ratio,
        resolution=chosen.resolution,
        sound=chosen.sound,
        auto_selected=auto_selected,
    )
    return _produce(
        db,
        user=user,
        project=project,
        model=model,
        config=config,
        call=lambda provider: provider.generate(
            GenerateRequest(
                model_id=model.model_id,
                prompt=project.prompt,
                duration_seconds=chosen.duration_seconds,
                aspect_ratio=chosen.aspect_ratio,
                resolution=chosen.resolution,
                sound=chosen.sound,
            )
        ),
        feature=UsageFeature.VIDEO_GENERATE,
        charged_seconds=chosen.duration_seconds,
        version=version,
    )


@router.post(
    "/projects/{project_id}/versions/{version_id}/edit",
    response_model=VideoVersionRead,
    status_code=status.HTTP_201_CREATED,
    summary="이 영상 수정하기 — edit a version into a new one",
)
def edit_version(
    project_id: int,
    version_id: int,
    payload: VideoEditCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> VideoVersion:
    """Send a version and an instruction to its model's edit workflow.

    The result is a new version linked to its source; the source is left
    as it was. Length, ratio and resolution are the source's, so the
    price is the source's length at the source's resolution.
    """
    project = _owned_project(project_id, db, user)
    source = _source_version(project, version_id)
    model = _model_of(db, source)
    try:
        caps = video_catalog.capabilities_of(model)
    except video_catalog.SettingsError as error:
        raise _http_error(error) from error
    if not caps.supports_edit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{model.display_name} 모델은 영상 수정을 지원하지 않습니다.",
        )

    instruction = payload.instruction.strip()
    if not instruction:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="무엇을 바꿀지 적어 주세요."
        )
    source_file = _load_source_file(config, source)
    seconds = source.duration_seconds or 0

    version = VideoVersion(
        project_id=project.id,
        provider=model.provider,
        model_id=model.model_id,
        prompt_snapshot=source.prompt_snapshot,
        kind=VideoVersionKind.EDIT,
        source_version_id=source.id,
        instruction=instruction,
        duration_seconds=seconds,
        aspect_ratio=source.aspect_ratio,
        resolution=source.resolution,
        sound=bool(source.sound),
        auto_selected=False,
    )
    return _produce(
        db,
        user=user,
        project=project,
        model=model,
        config=config,
        call=lambda provider: provider.edit(
            EditRequest(
                model_id=model.model_id,
                source=source_file,
                instruction=instruction,
                aspect_ratio=source.aspect_ratio or "",
                resolution=source.resolution or "",
            )
        ),
        feature=UsageFeature.VIDEO_EDIT,
        charged_seconds=seconds,
        version=version,
    )


@router.post(
    "/projects/{project_id}/versions/{version_id}/extend",
    response_model=VideoVersionRead,
    status_code=status.HTTP_201_CREATED,
    summary="이어서 만들기 — extend a version by a chosen length",
)
def extend_version(
    project_id: int,
    version_id: int,
    payload: VideoExtendCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> VideoVersion:
    """Continue a version by `duration_seconds`, one of its model's lengths.

    The new version's length is the source's plus what was added; only
    the added seconds are charged.
    """
    project = _owned_project(project_id, db, user)
    source = _source_version(project, version_id)
    model = _model_of(db, source)
    try:
        caps = video_catalog.capabilities_of(model)
    except video_catalog.SettingsError as error:
        raise _http_error(error) from error
    if not caps.supports_extend:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{model.display_name} 모델은 이어서 만들기를 지원하지 않습니다.",
        )
    added = payload.duration_seconds
    if added not in caps.durations:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{model.display_name} 모델은 {added}초를 이어서 만들 수 없습니다.",
        )
    source_file = _load_source_file(config, source)

    version = VideoVersion(
        project_id=project.id,
        provider=model.provider,
        model_id=model.model_id,
        prompt_snapshot=source.prompt_snapshot,
        kind=VideoVersionKind.EXTEND,
        source_version_id=source.id,
        duration_seconds=(source.duration_seconds or 0) + added,
        aspect_ratio=source.aspect_ratio,
        resolution=source.resolution,
        sound=bool(source.sound),
        auto_selected=False,
    )
    return _produce(
        db,
        user=user,
        project=project,
        model=model,
        config=config,
        call=lambda provider: provider.extend(
            ExtendRequest(
                model_id=model.model_id,
                source=source_file,
                prompt=source.prompt_snapshot,
                duration_seconds=added,
                aspect_ratio=source.aspect_ratio or "",
                resolution=source.resolution or "",
            )
        ),
        feature=UsageFeature.VIDEO_EXTEND,
        charged_seconds=added,
        version=version,
    )


# ---------------------------------------------------------- prompt helper


@router.post(
    "/projects/{project_id}/prompt-help",
    response_model=PromptHelpRead,
    summary="프롬프트 도움받기 — Claude rewrites the prompt text",
)
def prompt_help(
    project_id: int,
    payload: PromptHelpRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_member),
    config: Settings = Depends(get_settings),
) -> PromptHelpRead:
    """Ask Claude to rewrite the prompt. Text only — never generates video.

    Charged to the **Build** (Claude) budget, not Video: it is a Claude
    call, and the Video budget is for Higgsfield. The project's prompt is
    not changed here; the member applies the suggestion themselves.

    Priced by the token, like Chat: the budget is checked against the
    worst case before the call, and the tokens actually used are charged
    after it. A failed call is not charged.

    Always the catalogue's **default** model (chat-model-choice): the
    member picks a model in Chat, not here.
    """
    project = _owned_project(project_id, db, user)
    provider = get_claude_provider(config)
    is_mock = config.provider_is_mock("claude")
    max_output = min(config.chat_max_output_tokens, 2048)
    try:
        model = chat_models.default_model(db, config)
        chat_models.require_adapter(model)
        price = pricing.price_for(db, model)
        estimated_input = pricing.estimate_tokens(
            PROMPT_HELP_SYSTEM + payload.prompt + payload.request
        )
        usage_service.ensure_affordable(
            db,
            user=user,
            category=BudgetCategory.BUILD,
            amount_krw=price.krw(estimated_input, max_output),
        )
        try:
            answer = provider.rewrite_video_prompt(
                payload.prompt, payload.request, model.model_id
            )
        except ClaudeError as error:
            providers.record_failure(db, "claude", error.kind, error.detail)
            db.commit()
            raise
        result = usage_service.charge(
            db,
            user=user,
            category=BudgetCategory.BUILD,
            amount_krw=price.krw(answer.input_tokens, answer.output_tokens),
            provider="claude",
            feature=UsageFeature.VIDEO_PROMPT.value,
            model_id=model.model_id,
            provider_units=answer.input_tokens + answer.output_tokens,
            provider_unit="tokens",
            provider_cost=price.usd(answer.input_tokens, answer.output_tokens).quantize(
                Decimal("0.000001")
            ),
            input_tokens=answer.input_tokens,
            output_tokens=answer.output_tokens,
            exchange_rate_krw=price.usd_krw,
            video_project_id=project.id,
            commit=False,
            cap_to_available=True,
        )
        providers.record_success(
            db, "claude", "프롬프트 도움" + (" (mock)" if is_mock else "")
        )
        db.commit()
        amount = result.event.charged_krw
    except (
        usage_service.InsufficientBudgetError,
        usage_service.NoQuarterError,
        ClaudeError,
        pricing.PricingError,
        chat_models.ModelChoiceError,
    ) as error:
        raise _http_error(error) from error

    return PromptHelpRead(
        reply=answer.reply, revised_prompt=answer.revised_prompt, charged_krw=amount
    )


@router.get(
    "/projects/{project_id}/versions/{version_id}/download",
    summary="Download a finished version",
    response_class=Response,
    responses={200: {"content": {"video/mp4": {}}, "description": "The generated file"}},
)
def download_version(
    project_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Send back the file this version produced.

    **`get_current_user`, not `require_active_member`** — the same rule as
    the Builder ZIP, for the same reason. A member who did not join this
    quarter cannot generate anything new, but the videos they already made
    are theirs to take away.

    Serves what CTRL+AI stored, never the provider's URL: a provider link
    can expire or need their credentials, and a member's own download must
    not depend on either.
    """
    project = _owned_project(project_id, db, user)

    version = next((row for row in project.versions if row.id == version_id), None)
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="버전을 찾을 수 없습니다."
        )

    if version.status is not VideoVersionStatus.READY or not version.asset_storage_key:
        # Not an error in the file-missing sense — the version simply has
        # nothing to give yet, and the member is told which it is.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="아직 내려받을 수 있는 영상이 없습니다.",
        )

    try:
        payload = get_storage(settings).load(version.asset_storage_key)
    except (OSError, StorageKeyError) as error:
        # The row says there is a file and there is not. Saying so plainly
        # beats a 500, and beats pretending the version never existed.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="영상 파일을 찾을 수 없습니다. 다시 생성해 주세요.",
        ) from error

    extension = version.asset_storage_key.rsplit(".", 1)[-1]
    filename = project_zip.version_filename(project.name, version.label, extension)

    # `filename` for old clients that cannot read UTF-8, `filename*` for
    # everyone else — which is where the Korean project name survives.
    disposition = f'attachment; filename="video_{version.label}.{extension}"; ' + (
        f"filename*=UTF-8''{quote(filename)}"
    )

    return Response(
        content=payload,
        media_type=video_assets.content_type_for(version.asset_storage_key),
        headers={"Content-Disposition": disposition},
    )
