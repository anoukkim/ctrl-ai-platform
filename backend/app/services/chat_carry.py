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
from app.services import app_ai, chat_limits, chat_models, pricing, provider_limiter, providers
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

#: Only the head of a page is searched for its name, and only a short
#: stretch is cleaned of tags — the page is the member's and up to 200 KB.
NAME_SCAN_CHARS = 20_000
NAME_TEXT_CHARS = 1_000
_TAG = re.compile(r"<[^<>]{0,500}>")


def _plain(fragment: str) -> str:
    fragment = fragment[:NAME_TEXT_CHARS * 4]
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


def _between(head: str, lower: str, opener: str, closers: tuple[str, ...]) -> str | None:
    """The text inside the first `<opener …>…</closer>` — plain string
    searches, no backtracking regex over a page someone else wrote."""
    start = lower.find(opener)
    while start != -1:
        after = lower[start + len(opener) : start + len(opener) + 1]
        if after in (">", " ", "\t", "\n", "\r", "/"):
            close_tag = lower.find(">", start)
            if close_tag == -1:
                return None
            ends = [index for index in (lower.find(closer, close_tag) for closer in closers) if index != -1]
            if not ends:
                return None
            return head[close_tag + 1 : min(ends)][:NAME_TEXT_CHARS]
        start = lower.find(opener, start + 1)
    return None


def page_name(page: str) -> str | None:
    """The page's own name: its `<title>`, else its first `<h1>`/`<h2>`."""
    head = page[:NAME_SCAN_CHARS]
    lower = head.lower()
    for opener, closers in (("<title", ("</title",)), ("<h1", ("</h1",)), ("<h2", ("</h2",))):
        inside = _between(head, lower, opener, closers)
        if inside is not None:
            text = _plain(inside)
            if text:
                return shorten(text)
    return None


def owns(db: Session, user: User, conversation_id: int) -> bool:
    conversation = db.get(Conversation, conversation_id)
    return conversation is not None and conversation.user_id == user.id


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


#: How much of Claude's own explanation SPEC.md keeps.
MAX_EXPLANATION_CHARS = 1_500


def explanation(db: Session, user: User, conversation_id: int | None, reply_id: int | None) -> str:
    """What Claude said about the page in that reply — its text without the
    code blocks (the page is index.html already), so SPEC.md also records
    the features, scoring and data the reply described. Free, no call.
    Someone else's conversation, or a reply from another one, gives ''."""
    if conversation_id is None or reply_id is None:
        return ""
    conversation = db.get(Conversation, conversation_id)
    reply = db.get(ChatMessage, reply_id)
    if (
        conversation is None
        or conversation.user_id != user.id
        or reply is None
        or reply.conversation_id != conversation_id
        or reply.role != ChatRole.ASSISTANT
    ):
        return ""
    # Text between the fences only: an odd part is inside a ``` block.
    outside = "".join(part for index, part in enumerate(reply.content.split("```")) if index % 2 == 0)
    paragraphs = [re.sub(r"[ \t]+", " ", block).strip() for block in re.split(r"\n\s*\n", outside)]
    text = "\n\n".join(block for block in paragraphs if block)
    if len(text) > MAX_EXPLANATION_CHARS:
        text = text[:MAX_EXPLANATION_CHARS].rstrip() + "…"
    return text


def spec_md(name: str, items: list[str], said: str = "") -> str:
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
    if said:
        lines += ["", "## Claude가 설명한 내용", "", said]
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------ splitting the page into files

STYLE_PATH = "style.css"
SCRIPT_PATH = "app.js"
#: Script types that are plain browser JavaScript; anything else (a module,
#: JSON data, a template) stays where it is.
_JS_TYPES = ("", "text/javascript", "application/javascript")
_TAG_END = (">", " ", "\t", "\n", "\r", "/")


def _blocks(page: str, lower: str, tag: str) -> list[tuple[int, int, str, str]]:
    """Every `<tag …>…</tag>` as (start, end, attributes, content) — plain
    searches, linear, no regex over a page someone else wrote."""
    found = []
    opener, closer = f"<{tag}", f"</{tag}"
    position = lower.find(opener)
    while position != -1:
        after = lower[position + len(opener) : position + len(opener) + 1]
        close_tag = lower.find(">", position)
        end_tag = lower.find(closer, close_tag) if close_tag != -1 else -1
        if after not in _TAG_END or close_tag == -1 or end_tag == -1:
            position = lower.find(opener, position + 1)
            continue
        finish = lower.find(">", end_tag)
        if finish == -1:
            break
        found.append((position, finish + 1, lower[position + len(opener) : close_tag], page[close_tag + 1 : end_tag]))
        position = lower.find(opener, finish)
    return found


def _attribute(attributes: str, name: str) -> str | None:
    match = re.search(rf"""\b{name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", attributes[:500])
    if match:
        return next(group for group in match.groups() if group is not None).strip().lower()
    return "" if re.search(rf"\b{name}\b", attributes[:500]) else None


def split_page(page: str) -> dict[str, str] | None:
    """The page as index.html + style.css + app.js, or None when it has no
    inline CSS or JavaScript to move. Inline `<style>` blocks become
    style.css (linked where the first one stood); inline plain `<script>`
    blocks become app.js, linked where the **last** one stood so the page
    it needs is already there. Nothing is rewritten — only moved."""
    lower = page.lower()
    styles = [b for b in _blocks(page, lower, "style") if _attribute(b[2], "media") is None]
    scripts = [
        b
        for b in _blocks(page, lower, "script")
        if _attribute(b[2], "src") is None and (_attribute(b[2], "type") or "") in _JS_TYPES
    ]
    if not styles and not scripts:
        return None
    # Replace from the end so earlier positions stay valid.
    edits: list[tuple[int, int, str]] = []
    if styles:
        edits += [(s, e, "") for s, e, _a, _c in styles[1:]]
        edits.append((styles[0][0], styles[0][1], f'<link rel="stylesheet" href="{STYLE_PATH}">'))
    if scripts:
        edits += [(s, e, "") for s, e, _a, _c in scripts[:-1]]
        edits.append((scripts[-1][0], scripts[-1][1], f'<script src="{SCRIPT_PATH}"></script>'))
    out = page
    for start, end, text in sorted(edits, reverse=True):
        out = out[:start] + text + out[end:]
    files = {"index.html": out}
    if styles:
        files[STYLE_PATH] = "\n\n".join(c.strip("\n") for _s, _e, _a, c in styles).strip() + "\n"
    if scripts:
        files[SCRIPT_PATH] = "\n\n".join(c.strip("\n") for _s, _e, _a, c in scripts).strip() + "\n"
    return files


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
    # A slot under the club's provider limit, like every call; none free →
    # no name call (the default name stands).
    if not provider_limiter.acquire(chat_limits.current(db).provider_concurrency):
        return None
    try:
        return await _named(db, settings, provider, user=user, page=page, asked=asked, model=model, price=price)
    finally:
        provider_limiter.release()


async def _named(db: Session, settings: Settings, provider: Any, *, user: User, page: str, asked: list[str],
                 model: chat_models.ChosenModel, price: pricing.Price) -> str | None:
    text = _plain(page[:NAME_SCAN_CHARS])[:1500]
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
            # Kept even if making the project fails after: the club paid.
            commit=True,
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
