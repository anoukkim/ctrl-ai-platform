"""Project Builder's 만들기 / 고치기 (builder-static-runtime).

The member says what to make or change; Claude writes whole files through
its `write_file` tool. The same three rules as the 예시 앱
(`builder_starter.py`), and one more:

* **Checked before anything is stored** (`builder_files`): clean paths,
  static text types, ≤ 200 KB a file, ≤ 30 files, ≤ 2 MB a project.
  Server code is refused — the member is not charged, the club's cost is
  recorded.
* **Paid like any Claude call**: the wallet is checked against the worst
  case (the whole output budget) before the call, the tokens used are
  charged after, in the same transaction as the files.
* **Every generation is a version** the member can go back to.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import BuilderProject, BuilderProjectVersion, ProviderErrorKind, UsageFeature, User
from app.services import builder_files, builder_versions, chat_limits, chat_models, pricing
from app.services import provider_limiter, providers
from app.services import usage as usage_service
from app.services.builder_starter import StarterError, _record_absorbed
from app.services.claude_provider import (
    EDIT_SYSTEM,
    ClaudeError,
    ClaudeProvider,
    edit_request_text,
)

#: A typical change, for the estimate shown before 만들기: one or two files
#: rewritten.
TYPICAL_OUTPUT_TOKENS = 4_000
MAX_REQUEST_CHARS = 2_000


@dataclass(frozen=True)
class EditEstimate:
    estimated_krw: int
    worst_case_krw: int
    model_label: str
    max_output_tokens: int


def _input_estimate(project: BuilderProject, files: dict[str, str], request: str) -> int:
    return pricing.estimate_tokens(
        EDIT_SYSTEM + edit_request_text(project.name, sorted(files.items()), request)
    )


def estimate(
    db: Session, settings: Settings, project: BuilderProject, request: str = ""
) -> EditEstimate:
    model = chat_models.default_model(db, settings)
    price = pricing.price_for(db, model)
    files = builder_versions.current_files(db, project)
    tokens_in = _input_estimate(project, files, request or "x" * 120)
    return EditEstimate(
        estimated_krw=price.krw(tokens_in, TYPICAL_OUTPUT_TOKENS),
        worst_case_krw=price.krw(tokens_in, settings.builder_max_output_tokens),
        model_label=model.label,
        max_output_tokens=settings.builder_max_output_tokens,
    )


@dataclass(frozen=True)
class EditResult:
    files: dict[str, str]
    changed: list[str]
    summary: str
    charged_krw: int
    version: BuilderProjectVersion


def generate(
    db: Session,
    settings: Settings,
    provider: ClaudeProvider,
    *,
    user: User,
    project: BuilderProject,
    request: str,
    is_mock: bool,
) -> EditResult:
    """Ask, check, charge, store, snapshot. Raises `StarterError`,
    `ClaudeError`, `usage.InsufficientBudgetError`, `usage.NoQuarterError`
    or `pricing.PricingError` — none of which has charged the member."""
    request = request.strip()
    if not request:
        raise StarterError("무엇을 만들거나 바꿀지 적어 주세요.", 400)
    if len(request) > MAX_REQUEST_CHARS:
        raise StarterError("요청이 너무 깁니다(2,000자까지).", 400)

    model = chat_models.default_model(db, settings)
    chat_models.require_adapter(model)
    price = pricing.price_for(db, model)
    files = builder_versions.current_files(db, project)
    usage_service.ensure_affordable(
        db,
        user=user,
        amount_krw=price.krw(
            _input_estimate(project, files, request), settings.builder_max_output_tokens
        ),
        settings=settings,
    )

    if not provider_limiter.acquire(chat_limits.current(db).provider_concurrency):
        raise ClaudeError(ProviderErrorKind.BUSY, "provider concurrency limit")
    try:
        edit = provider.edit_project(
            project.name,
            sorted(files.items()),
            request,
            model.model_id,
            settings.builder_max_output_tokens,
        )
    except Exception as error:
        if isinstance(error, ClaudeError):
            providers.record_failure(db, "claude", error.kind, error.detail)
            _record_absorbed(db, user, project, model.model_id, price, error.usage)
            db.commit()
        raise
    finally:
        provider_limiter.release()

    # Locked until the files are stored: a second generation for the same
    # project that finished meanwhile would otherwise be silently undone.
    db.scalar(select(BuilderProject.id).where(BuilderProject.id == project.id).with_for_update())
    if builder_versions.current_files(db, project) != files:
        _record_absorbed(
            db, user, project, model.model_id, price, (edit.input_tokens, edit.output_tokens)
        )
        db.commit()
        raise StarterError(
            "그사이 다른 변경이 먼저 저장됐어요. 화면을 새로 고친 뒤 다시 요청해 주세요.", 409
        )
    try:
        if not edit.writes:
            raise builder_files.FileRuleError(
                "Claude가 바꾼 파일이 없습니다. 요청을 조금 더 구체적으로 적어 보세요."
            )
        updated, changed = builder_files.apply_writes(files, edit.writes)
    except builder_files.FileRuleError as error:
        # Paid for an answer we cannot use: the member is not charged, the
        # club's cost is still recorded (cost-clarity).
        _record_absorbed(
            db, user, project, model.model_id, price, (edit.input_tokens, edit.output_tokens)
        )
        db.commit()
        raise StarterError(str(error), 502) from error

    amount = price.krw(edit.input_tokens, edit.output_tokens)
    result = usage_service.charge(
        db,
        user=user,
        amount_krw=amount,
        provider="claude",
        feature=UsageFeature.BUILD.value,
        model_id=model.model_id,
        provider_units=edit.input_tokens + edit.output_tokens,
        provider_unit="tokens",
        provider_cost=price.usd(edit.input_tokens, edit.output_tokens).quantize(Decimal("0.000001")),
        input_tokens=edit.input_tokens,
        output_tokens=edit.output_tokens,
        exchange_rate_krw=price.usd_krw,
        cost=price.split(edit.input_tokens, edit.output_tokens),
        builder_project_id=project.id,
        commit=False,
        cap_to_available=True,
        settings=settings,
    )
    builder_versions.ensure_baseline(db, project)
    builder_versions.replace_files(db, project, updated)
    note = ("만들기: " if not files else "고치기: ") + request
    version = builder_versions.snapshot(db, project, note[:200], updated)
    if not project.description.strip():
        project.description = request[:2000]
    providers.record_success(db, "claude", "빌더" + (" (mock)" if is_mock else ""))
    db.commit()
    return EditResult(
        files=updated,
        changed=changed,
        summary=edit.summary or "요청한 대로 바꿨어요.",
        charged_krw=result.event.charged_krw,
        version=version,
    )
