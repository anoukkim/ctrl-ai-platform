"""chat-to-builder-carry (owner, 2026-10-17) — a 미리보기 goes to the
Builder with its name and what was asked.

"빌더로 보내기 이거를 하면 잘 가긴 하거든? 근데 html만 띡 가고 제목도 저렇게만
되고 프로젝트 빌드하기 누르면 프롬프트만 가서 이상한거 만들어지고". So the
page travels with:

* **its own name** — the page's `<title>`, else its first heading,
  shortened. Only when the page has neither does Claude's cheapest model
  name it (one tiny call the club absorbs, 0원 to the member, like the
  게시 summary) — never the conversation's truncated title;
* **the requirements** — what the member asked for in the conversation up
  to that reply, taken from their messages **as they are** (no call, free),
  written as the project's `SPEC.md`. SPEC.md is a guide document: never
  served, packed in the ZIP, read by every Builder call with the other
  files, so later 고치기 build on it instead of starting over.
"""

from __future__ import annotations

import html as html_lib
import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import ChatMessage, ChatRole, Conversation, UsageFeature, User
from app.services import app_ai, chat_models, pricing, providers
from app.services import usage as usage_service
from app.services.claude_provider import ChatRequest, ClaudeError

logger = logging.getLogger(__name__)

SPEC_PATH = "SPEC.md"
#: A project name a card can show whole.
NAME_CHARS = 30
#: The member's messages the note keeps, and how much of each.
MAX_REQUIREMENTS = 15
MAX_REQUIREMENT_CHARS = 400
SPEC_TITLE = "# 요구사항 — 채팅에서 가져왔어요"

_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_HEADING = re.compile(r"<h[12][^>]*>(.*?)</h[12]>", re.IGNORECASE | re.DOTALL)
_TAG = re.compile(r"<[^>]+>")


def _plain(fragment: str) -> str:
    text = html_lib.unescape(_TAG.sub(" ", fragment))
    return re.sub(r"\s+", " ", text).strip()


def shorten(name: str, limit: int = NAME_CHARS) -> str:
    """At most `limit` characters, cut at a word where possible."""
    name = name.strip(" -|·:—")
    if len(name) <= limit:
        return name
    cut = name[:limit]
    space = cut.rfind(" ")
    return (cut[:space] if space >= limit // 2 else cut).rstrip(" -|·:—,") + "…"


def page_name(page: str) -> str | None:
    """The page's own name: its `<title>`, else its first `<h1>`/`<h2>`."""
    for pattern in (_TITLE, _HEADING):
        found = pattern.search(page)
        if found:
            text = _plain(found.group(1))
            if text:
                return shorten(text)
    return None


def requirements(db: Session, user: User, conversation_id: int | None, reply_id: int | None) -> list[str]:
    """What the member asked in that conversation, up to the reply the page
    came from (all of it when the reply is not named) — their own words,
    newest last. Someone else's conversation gives nothing."""
    if conversation_id is None:
        return []
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        return []
    query = select(ChatMessage.content).where(
        ChatMessage.conversation_id == conversation_id, ChatMessage.role == ChatRole.USER
    )
    if reply_id is not None:
        query = query.where(ChatMessage.id < reply_id)
    said = [re.sub(r"\s+", " ", text).strip() for text in db.scalars(query.order_by(ChatMessage.id))]
    said = [text for text in said if text]
    trimmed = [text if len(text) <= MAX_REQUIREMENT_CHARS else text[:MAX_REQUIREMENT_CHARS] + "…" for text in said]
    return trimmed[-MAX_REQUIREMENTS:]


def spec_md(name: str, items: list[str]) -> str:
    lines = [
        SPEC_TITLE,
        "",
        f"앱: {name}",
        "",
        "채팅에서 이 미리보기를 만들 때 회원이 한 말이에요. 무엇을 만들고 어떻게 정했는지"
        " (기능, 데이터, 모양)가 여기 있어요. 고치기는 이 요구사항과 지금 index.html의 모양에서 이어 가요.",
        "",
        "## 요구사항",
        "",
    ]
    lines += [f"{number}. {text}" for number, text in enumerate(items, start=1)]
    return "\n".join(lines) + "\n"


def count_in(spec: str) -> int:
    """How many requirements a SPEC.md from Chat lists (the Builder's first bubble)."""
    if not spec.startswith(SPEC_TITLE):
        return 0
    return sum(1 for line in spec.splitlines() if re.match(r"^\d+\. ", line))


# ------------------------------------------------------------ the name, by Claude

NAME_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["name"],
    "additionalProperties": False,
    "properties": {"name": {"type": "string", "maxLength": 40}},
}
#: The mock provider recognises this marker.
MARKER = "PROJECT_NAME"
NAME_SYSTEM = (
    "You name a small web app a beginner made in a Korean club's chat. From "
    "the page's text and what the member asked, give it a short Korean name "
    "(at most 20 characters) that says what it is — no quotes, no emoji, no "
    "words like 'app' alone. Reply with JSON only."
)


def _name_system() -> str:
    return (
        f"{NAME_SYSTEM}\n{MARKER}\n\n"
        "Reply with ONLY a JSON value (no prose, no code fence) that matches this JSON Schema.\n"
        f"{app_ai.JSON_MARKER}\n{json.dumps(NAME_SCHEMA, ensure_ascii=False)}"
    )


class _Prepared:
    def __init__(self, request: ChatRequest) -> None:
        self.request = request


async def claude_name(db: Session, settings: Settings, provider: Any, *, user: User, page: str, asked: list[str]) -> str | None:
    """One Haiku call the club absorbs (0원 to the member), or None — a
    missing model or a failed call never stops the project being made."""
    try:
        model, _label = app_ai.choose_model(db, settings, "fast")
        price = pricing.price_for(db, model)
    except (app_ai.AppAIError, chat_models.ModelChoiceError, pricing.PricingError) as error:
        logger.warning("carry name: no model (%s)", error)
        return None
    text = _plain(page)[:1500]
    prompt = "첫 요청: " + (asked[0] if asked else "") + "\n\n페이지의 글:\n" + text
    request = ChatRequest(system=_name_system(), messages=[{"role": "user", "content": prompt}], max_tokens=60, model=model.model_id)
    tally: app_ai.Tally | None = None
    try:
        async for kind, value in app_ai.run(provider, _Prepared(request)):
            if kind == "done":
                tally = value
    except ClaudeError as error:
        app_ai.record_failure(db, error)
        db.commit()
        return None
    if tally is None:
        return None
    if tally.input_tokens or tally.output_tokens:
        usage_service.record_absorbed(
            db,
            user=user,
            provider="claude",
            feature=UsageFeature.PROJECT_NAME.value,
            model_id=model.model_id,
            input_tokens=tally.input_tokens,
            output_tokens=tally.output_tokens,
            cost=price.split(tally.input_tokens, tally.output_tokens),
            exchange_rate_krw=price.usd_krw,
            commit=False,
        )
    providers.record_success(db, "claude", "프로젝트 이름" + (" (mock)" if settings.provider_is_mock("claude") else ""))
    try:
        parsed = app_ai.parse_json(tally.text)
    except (ValueError, TypeError):
        return None
    if app_ai.validate(parsed, NAME_SCHEMA) is not None:
        return None
    name = _plain(str(parsed["name"]))
    return shorten(name) if name else None
