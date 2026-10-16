"""The 게시 dialog's pre-filled text (publish-summary, owner 2026-10-16).

When the dialog opens, Claude's cheapest model ("fast" — Haiku, from the
members' catalogue) reads the project's name and files and writes the
CtrlAIApps 설명 in one or two Korean sentences; for 업데이트 게시 it also
writes one line on what changed since the published version, from the
requests and summaries of the runs since. Both are defaults the member may edit.

Rules the owner set:

* **Free to the member.** The dialog promises "비용은 들지 않고": nothing
  leaves the wallet. The club's cost is recorded as an absorbed row
  (`usage.record_absorbed`, feature `publish_summary`, `charged_krw=0`).
* **Once per version.** The result is kept on the newest version row
  (`summary_description`, `summary_note`, `summary_base_version`); opening
  the dialog again for the same working version sends nothing. Unsaved
  work (builder-snapshots) keeps nothing, so each open asks again. The note
  is recomputed when the published version it was written against has
  changed.
* **Never blocks 게시.** No catalogue model, a provider error, a reply
  that is not JSON — the result is empty fields and the member writes
  their own. Nothing here raises past the route. A reply the club paid
  for but could not use is kept as an empty description, so reopening the
  dialog does not pay again; a call that never answered keeps nothing.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import BuilderGeneration, BuilderProject, BuilderProjectVersion, UsageFeature, User
from app.services import app_ai, builder_versions, chat_models, pricing, providers
from app.services import usage as usage_service
from app.services.claude_provider import ChatRequest, ClaudeError

logger = logging.getLogger(__name__)

#: Enough of the app for a blurb, not the whole thing: Haiku's input is
#: what the club pays for.
MAX_FILE_CHARS = 2_500
MAX_TOTAL_CHARS = 7_000
MAX_TOKENS = 220
#: How many versions' requests the note may read.
MAX_CHANGES = 12

SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["description", "note"],
    "additionalProperties": False,
    "properties": {
        "description": {"type": "string", "maxLength": 300},
        "note": {"type": "string", "maxLength": 120},
    },
}

#: The mock provider recognises this marker (claude_provider.MockClaudeProvider).
MARKER = "PUBLISH_SUMMARY"

SYSTEM = (
    "You write the listing text of a small web app for CtrlAIApps, a Korean "
    "club's app store for beginners. From the app's name and files, write "
    "\"description\": one or two short Korean sentences (존댓말, '~해요') "
    "saying what the app does for the person using it — no code words, no "
    "file names, no marketing. When a list of changes since the published "
    "version is given, write \"note\": one Korean line (at most 60 characters) "
    "summarising what changed, e.g. '댓글 기능을 넣고 색을 바꿨어요'; otherwise "
    "\"note\" is an empty string. Reply with JSON only."
)


@dataclass(frozen=True)
class Summary:
    description: str
    note: str
    #: True when the fields came from the version row, not a new call.
    cached: bool
    #: The catalogue model id that wrote them ("" when nothing was written).
    model: str = ""


NOTE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["note"],
    "additionalProperties": False,
    "properties": {"note": {"type": "string", "maxLength": 120}},
}

EMPTY = Summary("", "", cached=False)


def _system(schema: dict[str, Any]) -> str:
    """The listing writer's own instructions — not the 기능 상자's visitor
    preamble, which would tell Haiku it is an app's chat AI."""
    return (
        f"{SYSTEM}\n{MARKER}\n\n"
        "Reply with ONLY a JSON value (no prose, no code fence) that matches this JSON Schema.\n"
        f"{app_ai.JSON_MARKER}\n{json.dumps(schema, ensure_ascii=False)}"
    )


def _digest(name: str, files: dict[str, str]) -> str:
    """The files, trimmed: index.html first, then scripts, then the rest."""
    order = sorted(files, key=lambda p: (p != "index.html", not p.endswith(".js"), p))
    parts = [f"프로젝트 이름: {name}", "파일: " + ", ".join(order)]
    total = 0
    for path in order:
        if path.endswith((".md", ".json", ".svg", ".txt")) and path != "ctrlai.json":
            continue
        content = files[path][:MAX_FILE_CHARS]
        if total + len(content) > MAX_TOTAL_CHARS:
            break
        total += len(content)
        parts.append(f"--- {path} ---\n{content}")
    return "\n\n".join(parts)


def _changes(db: Session, project: BuilderProject, since_number: int | None) -> list[str]:
    """What each 만들기 / 고치기 since the published version asked for,
    oldest first (builder-snapshots: versions are saved snapshots now, so
    the runs themselves are the record of what changed)."""
    published_at = project.published_at
    if since_number is None or published_at is None:
        return []
    runs = list(
        db.scalars(
            select(BuilderGeneration)
            .where(
                BuilderGeneration.project_id == project.id,
                BuilderGeneration.status == "done",
                BuilderGeneration.created_at > published_at,
            )
            .order_by(BuilderGeneration.id)
        )
    )
    lines: list[str] = []
    for generation in runs[-MAX_CHANGES:]:
        text = generation.request.strip().splitlines()[0] if generation.request.strip() else ""
        if generation.summary.strip():
            text = f"{text} → {generation.summary.strip()}" if text else generation.summary.strip()
        if text:
            lines.append(text[:160])
    return lines


def _base(project: BuilderProject) -> int | None:
    published = project.published_version
    return published.number if published is not None else None


def cached(db: Session, project: BuilderProject) -> Summary | None:
    """What the version row already holds, or None when a call is needed.
    Checked by the route before it takes a provider slot."""
    version = builder_versions.latest(db, project)
    # Unsaved work is not the newest version: nothing stored for it.
    if version is None or version.summary_description is None or builder_versions.has_unsaved(db, project):
        return None
    if version.summary_base_version != _base(project):
        return None
    return Summary(version.summary_description, version.summary_note or "", cached=True, model=version.summary_model or "")


class _Unsaved:
    """Stands in for a version row while the working copy is unsaved."""

    summary_description: str | None = None
    summary_note: str | None = None
    summary_base_version: int | None = None
    summary_model: str | None = None


@dataclass(frozen=True)
class _Prepared:
    """What `app_ai.run` reads: the request only."""

    request: ChatRequest


async def _call(db: Session, settings: Settings, provider: Any, *, user: User, project: BuilderProject,
                model: chat_models.ChosenModel, price: pricing.Price, system: str, prompt: str,
                schema: dict[str, Any]) -> tuple[dict | None, bool]:
    """One Haiku call. Returns (parsed JSON or None, answered) — `answered`
    is False when the provider never replied (nothing paid, nothing to keep)."""
    request = ChatRequest(system=system, messages=[{"role": "user", "content": prompt}], max_tokens=MAX_TOKENS, model=model.model_id)
    tally: app_ai.Tally | None = None
    try:
        async for kind, value in app_ai.run(provider, _Prepared(request)):
            if kind == "done":
                tally = value
    except ClaudeError as error:
        app_ai.record_failure(db, error)
        db.commit()
        logger.warning("publish summary: provider failed (%s)", error)
        return None, False
    assert tally is not None
    if tally.input_tokens or tally.output_tokens:
        usage_service.record_absorbed(
            db,
            user=user,
            provider="claude",
            feature=UsageFeature.PUBLISH_SUMMARY.value,
            model_id=model.model_id,
            input_tokens=tally.input_tokens,
            output_tokens=tally.output_tokens,
            cost=price.split(tally.input_tokens, tally.output_tokens),
            exchange_rate_krw=price.usd_krw,
            builder_project_id=project.id,
            commit=False,
        )
    providers.record_success(db, "claude", "게시 요약" + (" (mock)" if settings.provider_is_mock("claude") else ""))
    try:
        parsed = app_ai.parse_json(tally.text)
    except (ValueError, TypeError):
        return None, True
    if app_ai.validate(parsed, schema) is not None:
        return None, True
    return parsed, True


async def summarize(db: Session, settings: Settings, provider: Any, *, user: User, project: BuilderProject) -> Summary:
    """The dialog's defaults for the project's working version (see the
    module docstring for the rules). `cached()` first, then at most one
    call: the whole text for a version not asked about yet, or only the
    note when the description is kept and the published base moved."""
    hit = cached(db, project)
    if hit is not None:
        return hit
    version = builder_versions.latest(db, project)
    files = builder_versions.current_files(db, project)
    if version is None or "index.html" not in files:
        return EMPTY
    if builder_versions.has_unsaved(db, project):
        # Work not yet saved as a version: answer it, keep nothing (the
        # summary belongs to a saved version). 게시 saves it first.
        version = _Unsaved()
    try:
        model, _label = app_ai.choose_model(db, settings, "fast")
        price = pricing.price_for(db, model)
    except (app_ai.AppAIError, chat_models.ModelChoiceError, pricing.PricingError) as error:
        logger.warning("publish summary: no model (%s)", error)
        return EMPTY

    base = _base(project)
    changes = _changes(db, project, base)
    common = dict(user=user, project=project, model=model, price=price)

    if version.summary_description:
        # The description stands; only the published base moved.
        note = ""
        if changes:
            prompt = f"프로젝트 이름: {project.name}\n\n게시된 버전 v{base} 이후 바뀐 것:\n" + "\n".join(changes)
            parsed, answered = await _call(db, settings, provider, system=_system(NOTE_SCHEMA), prompt=prompt, schema=NOTE_SCHEMA, **common)
            if not answered:
                db.commit()
                return Summary(version.summary_description, "", cached=False, model=version.summary_model or "")
            note = " ".join(str(parsed["note"]).split()) if parsed else ""
        version.summary_note = note
        version.summary_base_version = base
        db.commit()
        return Summary(version.summary_description, note, cached=False, model=version.summary_model or "")

    prompt = _digest(project.name, files)
    if changes:
        prompt += f"\n\n게시된 버전 v{base} 이후 바뀐 것:\n" + "\n".join(changes)
    parsed, answered = await _call(db, settings, provider, system=_system(SCHEMA), prompt=prompt, schema=SCHEMA, **common)
    if not answered:
        return EMPTY
    description = " ".join(str(parsed["description"]).split()) if parsed else ""
    note = " ".join(str(parsed["note"]).split()) if parsed and changes else ""
    # Kept even when empty: the club paid once; the member writes their own
    # rather than paying again on every open.
    version.summary_description = description
    version.summary_note = note
    version.summary_base_version = base
    version.summary_model = model.model_id
    db.commit()
    return Summary(description, note, cached=False, model=model.model_id)
