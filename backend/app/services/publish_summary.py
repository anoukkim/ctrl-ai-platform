"""The 게시 dialog's pre-filled text (publish-summary, owner 2026-10-16).

When the dialog opens, Claude's cheapest model ("fast" — Haiku, from the
members' catalogue) reads the project's name and files and writes the
CtrlAIApps 설명 in one or two Korean sentences; for 업데이트 게시 it also
writes one line on what changed since the published version, from the
versions' requests and summaries. Both are defaults the member may edit.

Rules the owner set:

* **Free to the member.** The dialog promises "비용은 들지 않고": nothing
  leaves the wallet. The club's cost is recorded as an absorbed row
  (`usage.record_absorbed`, feature `publish_summary`, `charged_krw=0`).
* **Once per version.** The result is kept on the version row
  (`summary_description`, `summary_note`, `summary_base_version`); opening
  the dialog again for the same working version sends nothing. The note
  is recomputed when the published version it was written against has
  changed.
* **Never blocks 게시.** No catalogue model, a provider error, a reply
  that is not JSON — the result is empty fields and the member writes
  their own. Nothing here raises past the route.
"""

from __future__ import annotations

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
    model: str = ""


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
    """What each version since the published one asked for, oldest first."""
    if since_number is None:
        return []
    versions = [v for v in builder_versions.list_versions(db, project) if v.number > since_number]
    versions.sort(key=lambda v: v.number)
    made = {
        generation.version_id: generation
        for generation in db.scalars(
            select(BuilderGeneration).where(
                BuilderGeneration.version_id.in_([v.id for v in versions] or [0]),
                BuilderGeneration.status == "done",
            )
        )
    }
    lines: list[str] = []
    for version in versions[-MAX_CHANGES:]:
        generation = made.get(version.id)
        if generation is not None:
            text = generation.request.strip().splitlines()[0] if generation.request.strip() else ""
            if generation.summary.strip():
                text = f"{text} → {generation.summary.strip()}" if text else generation.summary.strip()
        else:
            text = version.note
        if text:
            lines.append(f"v{version.number}: {text[:160]}")
    return lines


async def summarize(db: Session, settings: Settings, provider: Any, *, user: User, project: BuilderProject) -> Summary:
    """The dialog's defaults for the project's working version."""
    version = builder_versions.latest(db, project)
    files = builder_versions.current_files(db, project)
    if version is None or "index.html" not in files:
        return Summary("", "", cached=False)
    published = project.published_version
    base = published.number if published is not None else None
    if version.summary_description is not None and version.summary_base_version == base:
        return Summary(version.summary_description, version.summary_note or "", cached=True, model=version.summary_model or "")

    try:
        model, label = app_ai.choose_model(db, settings, "fast")
        price = pricing.price_for(db, model)
    except (app_ai.AppAIError, chat_models.ModelChoiceError, pricing.PricingError) as error:
        logger.warning("publish summary: no model (%s)", error)
        return Summary("", "", cached=False)

    changes = _changes(db, project, base)
    prompt = _digest(project.name, files)
    if changes:
        prompt += "\n\n게시된 버전 v%d 이후 바뀐 것:\n%s" % (base, "\n".join(changes))
    system = app_ai.system_prompt(SYSTEM + f"\n{MARKER}", SCHEMA)
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
        return Summary("", "", cached=False)
    assert tally is not None

    description, note = "", ""
    try:
        parsed = app_ai.parse_json(tally.text)
        if app_ai.validate(parsed, SCHEMA) is None:
            description = " ".join(str(parsed["description"]).split())
            note = " ".join(str(parsed["note"]).split())[:120] if changes else ""
    except (ValueError, TypeError, KeyError):
        description, note = "", ""

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
    if description:
        version.summary_description = description
        version.summary_note = note
        version.summary_base_version = base
        version.summary_model = label
    db.commit()
    return Summary(description, note, cached=False, model=label)


@dataclass(frozen=True)
class _Prepared:
    """What `app_ai.run` reads: the request only."""

    request: ChatRequest
