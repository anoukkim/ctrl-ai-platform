"""Project Builder's 만들기 / 고치기 in stages (quality-tuning Q2).

One giant answer was the failure Q0 found: a 44,000-token project cut off
at the output limit while rewriting every file, and nothing kept. Now a
generation is three kinds of call, each timed out and charged on its own:

1. **Plan** — a small call lists the files to write and what each is for.
   The member sees it as 만들 계획 and presses 시작 (고치기 starts at once).
2. **One call per file**, in plan order, each seeing the plan and the
   files written so far. A file is checked and **saved the moment it is
   done**, so a timeout keeps what was finished and 이어서 만들기 carries on
   with the rest.
3. **Self-check** — one call reads the whole app and fixes broken
   references or obvious errors (at most `CHECK_MAX_FIXES` files). If it
   fails, the files stay as they are.

The money rules are the Builder's as before: the wallet is checked
against each call's worst case before it, the tokens used are charged
after it, and a call whose answer cannot be used is free to the member
(the club's cost is recorded). The model and 생각 깊이 are the project's
(`builder_choice`).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import BuilderGeneration, BuilderProject, ProviderErrorKind, UsageFeature, User
from app.services import builder_choice, builder_files, builder_versions, chat_limits, chat_models
from app.services import pricing, provider_limiter, providers
from app.services import usage as usage_service
from app.services.builder_starter import StarterError, _record_absorbed
from app.services.claude_provider import (
    CHECK_MAX_FIXES,
    CHECK_SYSTEM,
    FILE_SYSTEM,
    PLAN_SYSTEM,
    ClaudeError,
    ClaudeProvider,
    check_request_text,
    edit_request_text,
    file_request_text,
)

logger = logging.getLogger(__name__)

#: The plan is a short list: this much room is plenty.
PLAN_MAX_TOKENS = 4_096
#: At most this many files in one plan.
MAX_PLAN_FILES = 12
#: The member's words, plus the guided start form's answers.
MAX_REQUEST_CHARS = 4_000
#: A run still marked running after this long died with its server.
STALE_RUN = timedelta(minutes=15)
#: A typical file, for the estimate shown before 시작.
TYPICAL_FILE_OUTPUT_TOKENS = 2_500

OPEN = ("planned", "running", "partial", "failed")

Emit = Callable[[str, dict], None]


def brief_text(request: str, who: str = "", features: str = "", mood: str = "") -> str:
    """The request with the guided start form's answers (skippable)."""
    parts = [request.strip()]
    answers = [
        ("누가 쓰나요", who.strip()),
        ("꼭 필요한 기능", features.strip()),
        ("원하는 분위기", mood.strip()),
    ]
    filled = [f"{label}: {value}" for label, value in answers if value]
    if filled:
        parts += ["", *filled]
    return "\n".join(parts).strip()


def open_generation(db: Session, project: BuilderProject) -> BuilderGeneration | None:
    """The project's newest generation that is not finished yet."""
    return db.scalar(
        select(BuilderGeneration)
        .where(BuilderGeneration.project_id == project.id, BuilderGeneration.status.in_(OPEN))
        .order_by(BuilderGeneration.id.desc())
        .limit(1)
    )


def _charge(
    db: Session,
    settings: Settings,
    user: User,
    project: BuilderProject,
    choice: builder_choice.BuildChoice,
    input_tokens: int,
    output_tokens: int,
) -> int:
    price = choice.price
    result = usage_service.charge(
        db,
        user=user,
        amount_krw=price.krw(input_tokens, output_tokens),
        provider="claude",
        feature=UsageFeature.BUILD.value,
        model_id=choice.model.model_id,
        provider_units=input_tokens + output_tokens,
        provider_unit="tokens",
        provider_cost=price.usd(input_tokens, output_tokens).quantize(Decimal("0.000001")),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        exchange_rate_krw=price.usd_krw,
        cost=price.split(input_tokens, output_tokens),
        builder_project_id=project.id,
        commit=False,
        cap_to_available=True,
        settings=settings,
        depth=choice.depth,
    )
    return result.event.charged_krw


def _clean_plan(files: list[tuple[str, str]], creating: bool) -> list[list[str]]:
    """The plan's paths checked like any write; index.html first for a new
    app (a project with files must have its entry file)."""
    seen: dict[str, str] = {}
    for raw_path, purpose in files:
        path = builder_files.clean_path(raw_path)
        seen.setdefault(path, purpose.strip()[:200])
    if not seen:
        raise builder_files.FileRuleError("계획에 만들 파일이 없어요. 요청을 조금 더 구체적으로 적어 보세요.")
    if len(seen) > MAX_PLAN_FILES:
        raise builder_files.FileRuleError(f"계획한 파일이 너무 많아요(최대 {MAX_PLAN_FILES}개). 다시 시도해 주세요.")
    if creating and builder_files.ENTRY_FILE not in seen:
        raise builder_files.FileRuleError("계획에 index.html이 없어요. 다시 시도해 주세요.")
    ordered = sorted(seen.items(), key=lambda item: item[0] != builder_files.ENTRY_FILE)
    return [[path, purpose] for path, purpose in ordered]


def plan(
    db: Session,
    settings: Settings,
    provider: ClaudeProvider,
    *,
    user: User,
    project: BuilderProject,
    request: str,
    style: str = "",
    is_mock: bool,
    spend_limit_krw: int | None = None,
) -> BuilderGeneration:
    """Stage 1: the plan, charged; a newer plan replaces an open one.

    `spend_limit_krw` (빌더 점검 only): refuse when the call's worst case
    would pass it.

    Raises `StarterError`, `ClaudeError`, `usage.InsufficientBudgetError`,
    `usage.NoQuarterError`, `chat_models.ModelChoiceError` or
    `pricing.PricingError` — none of which has charged the member.
    """
    request = request.strip()
    if not request:
        raise StarterError("무엇을 만들거나 바꿀지 적어 주세요.", 400)
    if len(request) > MAX_REQUEST_CHARS:
        raise StarterError(f"요청이 너무 깁니다({MAX_REQUEST_CHARS:,}자까지).", 400)
    style = style.strip()[:100]

    choice = builder_choice.choose(db, settings, user, project)
    chat_models.require_adapter(choice.model)
    files = builder_versions.current_files(db, project)
    creating = builder_files.ENTRY_FILE not in files
    tokens_in = pricing.estimate_tokens(
        PLAN_SYSTEM + edit_request_text(project.name, sorted(files.items()), request, style)
    )
    room = min(PLAN_MAX_TOKENS, choice.room(tokens_in))
    if room < 1_024:
        raise StarterError(builder_choice.room_refusal(choice), 400)
    if spend_limit_krw is not None and choice.price.krw(tokens_in, room) > spend_limit_krw:
        raise StarterError(f"점검 예산({spend_limit_krw:,}원)이 모자라 계획을 세우지 않았어요.", 402)
    usage_service.ensure_affordable(
        db, user=user, amount_krw=choice.price.krw(tokens_in, room), settings=settings
    )

    if not provider_limiter.acquire(chat_limits.current(db).provider_concurrency):
        raise ClaudeError(ProviderErrorKind.BUSY, "provider concurrency limit")
    try:
        planned = provider.plan_project(
            project.name,
            sorted(files.items()),
            request,
            choice.model.model_id,
            room,
            style,
            effort=choice.effort,
        )
    except Exception as error:
        if isinstance(error, ClaudeError):
            providers.record_failure(db, "claude", error.kind, error.detail)
            _record_absorbed(db, user, project, choice.model.model_id, choice.price, error.usage)
            db.commit()
        raise
    finally:
        provider_limiter.release()

    usage = (planned.input_tokens, planned.output_tokens)
    try:
        steps = _clean_plan(planned.files, creating)
    except builder_files.FileRuleError as error:
        _record_absorbed(db, user, project, choice.model.model_id, choice.price, usage)
        db.commit()
        raise StarterError(str(error), 502) from error

    charged = _charge(db, settings, user, project, choice, *usage)
    for older in db.scalars(
        select(BuilderGeneration).where(
            BuilderGeneration.project_id == project.id,
            BuilderGeneration.status.in_(("planned", "partial", "failed")),
        )
    ):
        older.status = "cancelled"
    generation = BuilderGeneration(
        project_id=project.id,
        user_id=user.id,
        kind="create" if creating else "edit",
        request=request,
        style=style,
        summary=planned.summary.strip()[:2000],
        plan=steps,
        files_done=[],
        status="planned",
        check_fixed=[],
        charged_krw=charged,
    )
    db.add(generation)
    providers.record_success(db, "claude", "빌더 계획" + (" (mock)" if is_mock else ""))
    db.commit()
    db.refresh(generation)
    return generation


def run_estimate(
    db: Session, settings: Settings, user: User, project: BuilderProject, generation: BuilderGeneration
) -> tuple[int, int]:
    """(약 N원 for the rest of the run, 최대 M원 per call) — shown by 시작."""
    choice = builder_choice.choose(db, settings, user, project)
    files = builder_versions.current_files(db, project)
    remaining = [step for step in generation.plan if step[0] not in set(generation.files_done)]
    tokens_in = pricing.estimate_tokens(
        FILE_SYSTEM
        + file_request_text(
            project.name,
            sorted(files.items()),
            generation.request,
            [tuple(step) for step in generation.plan],
            remaining[0][0] if remaining else "index.html",
            generation.style,
        )
    )
    per_file = choice.price.krw(tokens_in, TYPICAL_FILE_OUTPUT_TOKENS)
    per_call_max = choice.price.krw(tokens_in, max(choice.room(tokens_in), 0))
    # The files, then the self-check (about one more file's worth).
    return per_file * (len(remaining) + 1), per_call_max


def _stop(db: Session, generation: BuilderGeneration, message: str, emit: Emit) -> BuilderGeneration:
    """Stop here: what is saved stays saved; 이어서 만들기 continues."""
    generation.status = "partial" if generation.files_done else "failed"
    generation.error = message
    db.commit()
    emit(
        "error",
        {
            "detail": message,
            "partial": bool(generation.files_done),
            "files_done": list(generation.files_done),
            "charged_krw": generation.charged_krw,
        },
    )
    return generation


def run(
    db: Session,
    settings: Settings,
    provider: ClaudeProvider,
    *,
    user: User,
    generation_id: int,
    emit: Emit,
    is_mock: bool,
    spend_limit_krw: int | None = None,
) -> BuilderGeneration:
    """Stages 2 and 3, reporting each step through `emit`.

    `spend_limit_krw` (빌더 점검 only): the most this run may charge; a call
    whose worst case would pass it is not made.

    `emit(kind, data)`: file_start, file_done, check_start, check_done,
    done or error. Never raises for a provider or wallet problem — those
    stop the run (`_stop`) with a Korean sentence; `StarterError` only for
    a generation that cannot run at all (finished, or already running).
    """
    generation = db.scalar(
        select(BuilderGeneration).where(BuilderGeneration.id == generation_id).with_for_update()
    )
    if generation is None:
        raise StarterError("찾을 수 없는 작업이에요.", 404)
    if generation.status in ("done", "cancelled"):
        raise StarterError("이미 끝난 작업이에요. 새로 요청해 주세요.", 409)
    now = datetime.now(timezone.utc)
    updated = generation.updated_at
    if updated is not None and updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    if generation.status == "running" and updated is not None and now - updated < STALE_RUN:
        raise StarterError("이미 만들고 있어요. 잠시만 기다려 주세요.", 409)
    generation.status = "running"
    generation.error = ""
    generation.updated_at = now
    db.commit()

    project = db.get(BuilderProject, generation.project_id)
    choice = builder_choice.choose(db, settings, user, project)
    plan_steps = [(step[0], step[1]) for step in generation.plan]
    planned_paths = {path for path, _ in plan_steps}
    builder_versions.ensure_baseline(db, project)
    db.commit()
    spent_before = generation.charged_krw

    def over_limit(worst: int) -> bool:
        if spend_limit_krw is None:
            return False
        return generation.charged_krw - spent_before + worst > spend_limit_krw

    for path, _purpose in plan_steps:
        if path in generation.files_done:
            continue
        emit("file_start", {"path": path})
        files = builder_versions.current_files(db, project)
        text = file_request_text(
            project.name, sorted(files.items()), generation.request, plan_steps, path, generation.style
        )
        tokens_in = pricing.estimate_tokens(FILE_SYSTEM + text)
        room = choice.room(tokens_in)
        if room < builder_choice.MIN_ROOM_TOKENS:
            return _stop(db, generation, builder_choice.room_refusal(choice), emit)
        if over_limit(choice.price.krw(tokens_in, room)):
            return _stop(db, generation, f"점검 예산({spend_limit_krw:,}원)에 닿아 멈췄어요.", emit)
        try:
            usage_service.ensure_affordable(
                db, user=user, amount_krw=choice.price.krw(tokens_in, room), settings=settings
            )
        except (usage_service.InsufficientBudgetError, usage_service.NoQuarterError) as error:
            return _stop(db, generation, str(error), emit)
        if not provider_limiter.acquire(chat_limits.current(db).provider_concurrency):
            return _stop(db, generation, str(ClaudeError(ProviderErrorKind.BUSY, "limit")), emit)
        try:
            written = provider.write_project_file(
                project.name,
                sorted(files.items()),
                generation.request,
                plan_steps,
                path,
                choice.model.model_id,
                room,
                generation.style,
                effort=choice.effort,
            )
        except ClaudeError as error:
            providers.record_failure(db, "claude", error.kind, error.detail)
            _record_absorbed(db, user, project, choice.model.model_id, choice.price, error.usage)
            return _stop(db, generation, f"{path}을(를) 쓰다 멈췄어요: {error}", emit)
        finally:
            provider_limiter.release()

        usage = (written.input_tokens, written.output_tokens)
        try:
            # Only files in the plan; anything else Claude wrote is dropped.
            writes = [
                (clean, content)
                for raw, content in written.writes
                if (clean := builder_files.clean_path(raw)) in planned_paths
            ]
            if path not in {clean for clean, _ in writes}:
                raise builder_files.FileRuleError(
                    f"{path}을(를) 쓰지 못했어요. 이어서 만들기로 다시 시도해 주세요."
                )
            updated_files, _changed = builder_files.apply_writes(files, writes)
        except builder_files.FileRuleError as error:
            _record_absorbed(db, user, project, choice.model.model_id, choice.price, usage)
            return _stop(db, generation, str(error), emit)

        charged = _charge(db, settings, user, project, choice, *usage)
        builder_versions.replace_files(db, project, updated_files)
        done = set(generation.files_done) | {clean for clean, _ in writes}
        generation.files_done = [step for step, _ in plan_steps if step in done]
        generation.charged_krw += charged
        db.commit()
        emit("file_done", {"path": path, "charged_krw": charged})

    # Stage 3: the self-check. A failure leaves the files as they are.
    emit("check_start", {})
    files = builder_versions.current_files(db, project)
    tokens_in = pricing.estimate_tokens(CHECK_SYSTEM + check_request_text(project.name, sorted(files.items())))
    room = choice.room(tokens_in)
    fixed: list[str] = []
    check_charged = 0
    summary = "점검은 건너뛰었어요."
    affordable = True
    try:
        usage_service.ensure_affordable(
            db, user=user, amount_krw=choice.price.krw(tokens_in, max(room, 0)), settings=settings
        )
    except (usage_service.InsufficientBudgetError, usage_service.NoQuarterError):
        affordable = False
    if over_limit(choice.price.krw(tokens_in, max(room, 0))):
        affordable = False
    if affordable and room >= builder_choice.MIN_ROOM_TOKENS and provider_limiter.acquire(
        chat_limits.current(db).provider_concurrency
    ):
        try:
            checked = provider.check_project(
                project.name, sorted(files.items()), choice.model.model_id, room, effort=choice.effort
            )
        except ClaudeError as error:
            providers.record_failure(db, "claude", error.kind, error.detail)
            _record_absorbed(db, user, project, choice.model.model_id, choice.price, error.usage)
            checked = None
        finally:
            provider_limiter.release()
        if checked is not None:
            usage = (checked.input_tokens, checked.output_tokens)
            try:
                fixes = [
                    (clean, content)
                    for raw, content in checked.writes
                    if (clean := builder_files.clean_path(raw)) in files
                ][:CHECK_MAX_FIXES]
                updated_files, fixed = builder_files.apply_writes(files, fixes)
            except builder_files.FileRuleError:
                _record_absorbed(db, user, project, choice.model.model_id, choice.price, usage)
            else:
                check_charged = _charge(db, settings, user, project, choice, *usage)
                if fixed:
                    builder_versions.replace_files(db, project, updated_files)
                summary = checked.summary.strip() or "점검했어요."
    generation.check_summary = summary[:500]
    generation.check_fixed = fixed
    generation.charged_krw += check_charged
    db.commit()
    emit("check_done", {"fixed": fixed, "summary": generation.check_summary, "charged_krw": check_charged})

    files = builder_versions.current_files(db, project)
    note = ("만들기: " if generation.kind == "create" else "고치기: ") + generation.request.splitlines()[0]
    version = builder_versions.snapshot(db, project, note[:200], files)
    generation.version_id = version.id
    generation.status = "done"
    if not project.description.strip():
        project.description = generation.request[:2000]
    providers.record_success(db, "claude", "빌더" + (" (mock)" if is_mock else ""))
    db.commit()
    emit(
        "done",
        {
            "version_number": version.number,
            "charged_krw": generation.charged_krw,
            "files_done": list(generation.files_done),
            "check_fixed": fixed,
        },
    )
    return generation
