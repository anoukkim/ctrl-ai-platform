"""Project Builder's 예시 앱 (chat-builder-starter, 2026-10-13).

When a member asks for an app — in Chat, or in an empty project — Claude
writes a small static web app and it is stored as the project's files.
Three rules, all enforced here:

* **Static text files only, checked before anything is stored.** Claude's
  output is untrusted: every path and size is checked (`check_files`), and
  anything that is not plain HTML / CSS / JS / JSON / SVG / Markdown / text
  is refused. Nothing is ever run on the backend — the files run only in
  the member's browser, inside a sandboxed preview with no network and no
  access to CTRL+AI (CLAUDE.md section 20).
* **Paid like any Claude call.** The wallet is checked against the worst
  case before the call (the whole output budget), the tokens actually used
  are charged afterwards, and the files land in the same transaction as
  the charge. A failed call — including a reply cut off before the app was
  complete — is free.
* **Only into an empty project.** A starter never overwrites a member's
  files.
"""

from __future__ import annotations

import posixpath
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import BuilderProject, BuilderProjectFile, ProviderErrorKind, UsageFeature, User
from app.services import chat_models, pricing, providers
from app.services import chat_limits, provider_limiter
from app.services import usage as usage_service
from app.services.claude_provider import (
    STARTER_SYSTEM,
    ClaudeError,
    ClaudeProvider,
    starter_request_text,
)

#: What a starter app may contain.
ALLOWED_EXTENSIONS = {".html", ".css", ".js", ".json", ".svg", ".md", ".txt"}
MAX_FILES = 10
MAX_FILE_BYTES = 100_000
MAX_TOTAL_BYTES = 300_000
ENTRY_FILE = "index.html"

#: What a typical starter costs, for the estimate shown before 만들기:
#: the instructions and the idea in, a few hundred lines out.
TYPICAL_OUTPUT_TOKENS = 3_500


class StarterError(Exception):
    """A Korean sentence for the member, and an HTTP status."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def check_files(files: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """The files, with clean paths — or `StarterError` if any is not allowed."""
    if not files:
        raise StarterError("예시 앱에 파일이 없습니다. 다시 시도해 주세요.", 502)
    if len(files) > MAX_FILES:
        raise StarterError("예시 앱의 파일이 너무 많습니다. 다시 시도해 주세요.", 502)

    cleaned: list[tuple[str, str]] = []
    seen: set[str] = set()
    total = 0
    for raw_path, content in files:
        given = raw_path.strip().replace("\\", "/")
        while given.startswith("./"):
            given = given[2:]
        path = posixpath.normpath(given) if given else ""
        parts = path.split("/")
        if (
            not path
            or given.startswith("/")
            or ".." in given.split("/")
            or ".." in parts
            or any(part.startswith(".") for part in parts)
            or len(parts) > 2
            or posixpath.splitext(path)[1].lower() not in ALLOWED_EXTENSIONS
        ):
            raise StarterError(f"허용되지 않는 파일이 들어 있어 만들지 않았습니다: {raw_path[:60]}", 502)
        size = len(content.encode("utf-8"))
        if size > MAX_FILE_BYTES:
            raise StarterError("예시 앱의 파일 하나가 너무 큽니다. 다시 시도해 주세요.", 502)
        total += size
        if path in seen:
            continue
        seen.add(path)
        cleaned.append((path, content))
    if total > MAX_TOTAL_BYTES:
        raise StarterError("예시 앱이 너무 큽니다. 다시 시도해 주세요.", 502)
    if ENTRY_FILE not in seen:
        raise StarterError("예시 앱에 index.html이 없습니다. 다시 시도해 주세요.", 502)
    return cleaned


@dataclass(frozen=True)
class StarterEstimate:
    estimated_krw: int
    worst_case_krw: int
    model_label: str


def _input_estimate(name: str, idea: str) -> int:
    return pricing.estimate_tokens(STARTER_SYSTEM + starter_request_text(name, idea))


def estimate(db: Session, settings: Settings, name: str = "", idea: str = "") -> StarterEstimate:
    model = chat_models.default_model(db, settings)
    price = pricing.price_for(db, model)
    tokens_in = _input_estimate(name or "내 앱", idea or "x" * 200)
    return StarterEstimate(
        estimated_krw=price.krw(tokens_in, TYPICAL_OUTPUT_TOKENS),
        worst_case_krw=price.krw(tokens_in, settings.builder_max_output_tokens),
        model_label=model.label,
    )


@dataclass(frozen=True)
class StarterResult:
    files: list[BuilderProjectFile]
    summary: str
    charged_krw: int


def create_starter(
    db: Session,
    settings: Settings,
    provider: ClaudeProvider,
    *,
    user: User,
    project: BuilderProject,
    idea: str,
    is_mock: bool,
) -> StarterResult:
    """Generate, check, charge and store. Raises `StarterError`,
    `ClaudeError`, `usage.InsufficientBudgetError`, `usage.NoQuarterError`
    or `pricing.PricingError` — none of which has spent anything."""
    existing = db.scalar(
        select(BuilderProjectFile.id).where(BuilderProjectFile.project_id == project.id).limit(1)
    )
    if existing is not None:
        raise StarterError("이미 파일이 있는 프로젝트입니다. 예시 앱은 빈 프로젝트에만 만듭니다.", 409)

    model = chat_models.default_model(db, settings)
    chat_models.require_adapter(model)
    price = pricing.price_for(db, model)
    idea = idea.strip() or project.description.strip() or project.name
    usage_service.ensure_affordable(
        db,
        user=user,
        amount_krw=price.krw(_input_estimate(project.name, idea), settings.builder_max_output_tokens),
        settings=settings,
    )

    # PART F: a slot under the process-wide provider limit; refused free.
    if not provider_limiter.acquire(chat_limits.current(db).provider_concurrency):
        raise ClaudeError(ProviderErrorKind.BUSY, "provider concurrency limit")
    try:
        app = provider.generate_starter_app(
            project.name, idea, model.model_id, settings.builder_max_output_tokens
        )
    except Exception as error:
        if isinstance(error, ClaudeError):
            providers.record_failure(db, "claude", error.kind, error.detail)
            _record_absorbed(db, user, project, model.model_id, price, error.usage)
            db.commit()
        raise
    finally:
        provider_limiter.release()
    try:
        files = check_files(app.files)
    except StarterError:
        # The provider was paid for files we cannot use: the member is not
        # charged, the club's cost is still recorded (cost-clarity).
        _record_absorbed(
            db, user, project, model.model_id, price, (app.input_tokens, app.output_tokens)
        )
        db.commit()
        raise

    amount = price.krw(app.input_tokens, app.output_tokens)
    result = usage_service.charge(
        db,
        user=user,
        amount_krw=amount,
        provider="claude",
        feature=UsageFeature.BUILD.value,
        model_id=model.model_id,
        provider_units=app.input_tokens + app.output_tokens,
        provider_unit="tokens",
        provider_cost=price.usd(app.input_tokens, app.output_tokens).quantize(Decimal("0.000001")),
        input_tokens=app.input_tokens,
        output_tokens=app.output_tokens,
        exchange_rate_krw=price.usd_krw,
        cost=price.split(app.input_tokens, app.output_tokens),
        builder_project_id=project.id,
        commit=False,
        cap_to_available=True,
        settings=settings,
    )
    rows = [BuilderProjectFile(project_id=project.id, path=path, content=content) for path, content in files]
    db.add_all(rows)
    if not project.description.strip():
        project.description = idea[:2000]
    providers.record_success(db, "claude", "예시 앱" + (" (mock)" if is_mock else ""))
    db.commit()
    for row in rows:
        db.refresh(row)
    return StarterResult(files=rows, summary=app.summary, charged_krw=result.event.charged_krw)


def _record_absorbed(
    db: Session,
    user: User,
    project: BuilderProject,
    model_id: str,
    price: pricing.Price,
    usage: tuple[int, int] | None,
) -> None:
    """The club's cost of a generation nobody is charged for (cost-clarity).

    Only when the provider reported usage — a call refused before it ran
    (network, 529, our own limiter) cost nothing and records nothing.
    """
    if not usage or not any(usage):
        return
    input_tokens, output_tokens = usage
    usage_service.record_absorbed(
        db,
        user=user,
        provider="claude",
        feature=UsageFeature.BUILD.value,
        model_id=model_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost=price.split(input_tokens, output_tokens),
        exchange_rate_krw=price.usd_krw,
        builder_project_id=project.id,
        commit=False,
    )
