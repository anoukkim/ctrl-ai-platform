"""The Claude provider, behind `CLAUDE_PROVIDER` (CLAUDE.md section 20).

Three operations, all text only:

* **`stream_chat`** — Chat's reply, streamed piece by piece.
* **`rewrite_video_prompt`** — the Video workspace's 프롬프트 도움받기. It
  rewrites text and has no way to reach the video provider.
* **`generate_starter_app`** — Project Builder's 예시 앱: a small static
  web app (HTML, CSS, JS) returned as files. Text only — nothing is run on
  the backend; the files are checked and stored by
  `services/builder_starter.py`, and they run only in the member's browser,
  in a sandboxed preview.

Two implementations:

* **`MockClaudeProvider`** — the default. Canned Korean replies chosen by
  keyword, streamed with a short pause so the typing effect shows. It
  reports plausible token counts so the budget and the ledger are
  exercised exactly as for real, and it can be told to fail (see
  `MOCK_ERROR`) so the error paths can be seen without a key.
* **`AnthropicClaudeProvider`** — the real one, through the official
  `anthropic` SDK. The key is read from settings inside this module and is
  never logged, returned, or put in an error message.

Every failure leaves this module as a `ClaudeError` carrying a Korean
sentence for the member and a short, credential-free detail for the
Admin status board. Callers never see the SDK's own exceptions.

## Prompt caching

A Chat request carries two cache breakpoints (prompt-caching): an explicit
one on the system prompt, which every conversation shares, and Anthropic's
automatic top-level `cache_control`, which marks the newest message so the
next turn re-reads the whole conversation so far from the cache. Usage
then arrives in three parts — uncached input, cache writes, cache reads —
and each is passed on separately, because each has its own price. The
mock keeps a small cache of its own (`MockPromptCache`) and bills the same
three parts, so the ledger is exercised exactly as it will be for real.
"""

from __future__ import annotations

import asyncio
import json
import hashlib
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Protocol

from app.core.config import Settings
from app.models import ProviderErrorKind
from app.services.pricing import estimate_tokens

# ------------------------------------------------------------------ errors

#: What a member reads when a reply fails, by failure kind. The admin
#: board has its own, more technical wording (`PROVIDER_ERROR_LABEL`).
MEMBER_MESSAGE: dict[str, str] = {
    ProviderErrorKind.AUTH: (
        "AI 연결 설정에 문제가 있어 지금은 답할 수 없습니다. 관리자에게 알려 주세요."
    ),
    ProviderErrorKind.CREDIT: (
        "동아리의 Claude 크레딧이 바닥나 지금은 답할 수 없습니다. 관리자에게 알려 주세요."
    ),
    ProviderErrorKind.RATE_LIMITED: (
        "지금 Claude에 요청이 많이 몰렸습니다. 1분쯤 뒤에 다시 보내 주세요."
    ),
    ProviderErrorKind.BUSY: (
        "지금 CTRL+AI에 요청이 많습니다. 잠시 뒤 다시 보내 주세요."
    ),
    ProviderErrorKind.UNAVAILABLE: (
        "Claude 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."
    ),
    ProviderErrorKind.TIMEOUT: "Claude가 제시간에 답하지 않았습니다. 다시 보내 주세요.",
    ProviderErrorKind.NOT_IMPLEMENTED: (
        "Claude 연결이 설정되지 않았습니다. 관리자에게 알려 주세요."
    ),
    ProviderErrorKind.UNKNOWN: (
        "Claude가 요청을 처리하지 못했습니다. 잠시 후 다시 시도하고, 계속되면 관리자에게 "
        "알려 주세요."
    ),
}


class ClaudeError(Exception):
    """A Claude call that failed. `str(error)` is the member's Korean message."""

    def __init__(
        self, kind: str, detail: str = "", usage: tuple[int, int] | None = None
    ) -> None:
        self.kind = kind
        #: For the Admin status board: an HTTP status and error type, never
        #: a request body and never the key.
        self.detail = detail
        #: (input, output) tokens the provider billed before the call was
        #: judged a failure — a cut-off or unusable answer (cost-clarity).
        #: None when the call cost nothing.
        self.usage = usage
        super().__init__(MEMBER_MESSAGE.get(kind, MEMBER_MESSAGE[ProviderErrorKind.UNKNOWN]))


# ------------------------------------------------------------- data shapes


@dataclass(frozen=True)
class ChatRequest:
    system: str
    #: [{"role": "user" | "assistant", "content": str | [block, ...]}, ...],
    #: alternating, starting and ending with the member. A message with
    #: attachments (chat-plus-files) carries content blocks: image and
    #: document blocks with the bytes themselves, then its text.
    messages: list[dict]
    max_tokens: int
    #: The provider's model id, from the chat model catalogue. Empty means
    #: the provider's own `model_id` (the `ANTHROPIC_MODEL` fallback).
    model: str = ""
    #: "5m" / "1h" to mark the prompt cacheable; None sends no marker.
    cache_ttl: str | None = None
    #: Server tools in force for this turn (chat-plus-tools): a subset of
    #: {"web_search", "web_fetch", "code_execution"}. Per conversation,
    #: because changing the tool list breaks the prompt cache.
    tools: tuple[str, ...] = ()
    #: 웹 페이지 읽기 limits (tool-cap-defaults): admin settings, set by
    #: `prepare_turn` from `chat_limits.current`. The literals mirror
    #: `chat_limits.DEFAULTS` for callers that build a request directly.
    fetch_max_uses: int = 1
    fetch_max_content_tokens: int = 10_000
    #: 웹 검색 searches per reply (fix-real-web-search) — the admin's
    #: 채팅 한도 setting, sent as the tool's `max_uses`.
    search_max_uses: int = 5
    #: 생각 과정 보기 (chat-thinking-view): ask for the summarized thinking.
    show_thinking: bool = False


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class ThinkingDelta:
    """A piece of Claude's summarized thinking (chat-thinking-view)."""

    text: str


@dataclass(frozen=True)
class UsageUpdate:
    """Token counts so far. Each update replaces the previous one.

    `input_tokens` is the input that was neither written to nor read from
    the prompt cache; the other two are, and are priced on their own.
    """

    input_tokens: int
    output_tokens: int
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0
    #: Web searches billed so far (server_tool_use). Fees are charged per
    #: search on top of the tokens (chat-plus-tools).
    web_search_count: int = 0
    #: Pages fetched so far — no fee, recorded in the ledger.
    web_fetch_count: int = 0


@dataclass(frozen=True)
class ToolStatus:
    """A server tool started or finished — the screen's 검색 중… line.

    On "done" it also carries what the use just added, so the running
    cost can jump the moment a search or fetch completes: the result
    tokens (the mock knows them exactly; the real adapter may not and
    sends 0 — the final usage still settles the ledger) and the billed
    searches this use added.
    """

    kind: str  #: "web_search" | "web_fetch" | "code_execution"
    status: str  #: "running" | "done" | "error"
    result_tokens: int = 0
    searches: int = 0


@dataclass(frozen=True)
class ToolSources:
    """Sources the reply drew on — saved with it. Each is (title, url) or
    (title, url, cited): cited ones first (`SourceList`)."""

    sources: tuple[tuple[str, ...], ...]


@dataclass(frozen=True)
class StreamEnd:
    #: "end_turn", "max_tokens", "refusal", …
    stop_reason: str


StreamEvent = TextDelta | ThinkingDelta | UsageUpdate | ToolStatus | ToolSources | StreamEnd


@dataclass(frozen=True)
class PromptRewrite:
    reply: str
    #: None when Claude answered without changing the prompt.
    revised_prompt: str | None
    model: str
    input_tokens: int
    output_tokens: int
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0


@dataclass(frozen=True)
class StarterApp:
    """A generated starter app, before the backend has checked it."""

    #: Two Korean sentences: what it does, and what to ask for next.
    summary: str
    #: (path, content) as Claude wrote them. Checked by the caller.
    files: list[tuple[str, str]]
    model: str
    input_tokens: int
    output_tokens: int


@dataclass(frozen=True)
class ProjectEdit:
    """Claude's change to a Builder project, before the backend checks it
    (builder-static-runtime)."""

    #: A short Korean answer: what changed, and what to ask next.
    summary: str
    #: (path, content) for each file Claude wrote, whole. Checked by the caller.
    writes: list[tuple[str, str]]
    model: str
    input_tokens: int
    output_tokens: int


# ----------------------------------------------------- server tools

#: Searches per reply when nothing else says (fix-real-web-search): the
#: admin's 채팅 한도 setting overrides it (`ChatRequest.search_max_uses`).
WEB_SEARCH_MAX_USES = 5

#: How many times a paused tool turn (`stop_reason: "pause_turn"`) is
#: continued before what was said so far becomes the reply.
PAUSE_TURN_MAX_CONTINUATIONS = 3


def web_search_tool_type(model: str) -> str:
    """The web-search tool version: the basic `web_search_20250305` for
    every model (fix-real-web-search, decided 2026-10-14).

    `web_search_20260209` and later run the search from inside code
    execution by default ("dynamic filtering"): Claude writes Python that
    reads the results as JSON strings. In the owner's live tests that
    surfaced to members as "결과가 JSON 문자열로 와서 파싱해서…", used up
    the search budget on retries and once ended with no answer. The basic
    version calls search directly, returns cited results, is ZDR-eligible,
    and works on Haiku 4.5 too (platform.claude.com › web search / server
    tools). Dynamic filtering saves tokens on search-heavy research — not
    what a beginner's Chat needs.
    """
    return "web_search_20250305"


def web_fetch_tool_type(model: str) -> str:
    """The basic `web_fetch_20250910`, for the same reason as search:
    `_20260209`+ read pages through code execution by default."""
    return "web_fetch_20250910"


def tool_kind(name_or_type: str) -> str:
    """A server-tool block's name or result type as the screen's kind:
    "web_search" | "web_fetch" | "code_execution". Code execution comes
    as `code_execution`, `bash_code_execution` or
    `text_editor_code_execution` (and their `*_tool_result` blocks)."""
    value = name_or_type.lower()
    if "web_search" in value:
        return "web_search"
    if "web_fetch" in value:
        return "web_fetch"
    if "code_execution" in value:
        return "code_execution"
    return value.split("_tool_result")[0] or "web_search"


def _is_error_result(content: Any) -> bool:
    """A server tool's result says it failed: an error object (search,
    fetch and code execution all name their error type `*_error`)."""
    items = content if isinstance(content, (list, tuple)) else ([content] if content is not None else [])
    return any("error" in str(getattr(item, "type", "") or (item.get("type", "") if isinstance(item, dict) else "")) for item in items)


class SourceList:
    """The reply's sources: deduplicated by URL, cited first.

    Search results and fetched pages are added as they arrive; a citation
    in the text marks its source as cited (and adds it if no result
    carried it). `ordered()` gives cited sources in the order they were
    first cited, then the rest in the order they arrived — at most
    `LIMIT`, so a five-search reply does not save fifty links.
    """

    LIMIT = 20

    def __init__(self) -> None:
        self._items: dict[str, dict[str, Any]] = {}
        self._order = 0

    def __bool__(self) -> bool:
        return bool(self._items)

    @staticmethod
    def _key(url: str) -> str:
        return url.split("#", 1)[0].rstrip("/")

    def _add(self, url: str, title: str) -> dict[str, Any] | None:
        url = (url or "").strip()
        if not url.lower().startswith(("http://", "https://")):
            return None
        key = self._key(url)
        item = self._items.get(key)
        if item is None:
            self._order += 1
            item = {"url": url, "title": "", "seen": self._order, "cited": 0}
            self._items[key] = item
        if title and not item["title"]:
            item["title"] = title.strip()
        return item

    def add_result(self, content: Any) -> None:
        items = content if isinstance(content, (list, tuple)) else ([content] if content is not None else [])
        for entry in items:
            url = getattr(entry, "url", None)
            title = getattr(entry, "title", None) or ""
            if not title:
                document = getattr(entry, "content", None)
                title = getattr(document, "title", None) or ""
            if url:
                self._add(url, title)

    def cite(self, url: str, title: str) -> None:
        item = self._add(url, title)
        if item is not None and not item["cited"]:
            self._order += 1
            item["cited"] = self._order

    def ordered(self) -> tuple[tuple[str, str, bool], ...]:
        cited = sorted((i for i in self._items.values() if i["cited"]), key=lambda i: i["cited"])
        rest = sorted((i for i in self._items.values() if not i["cited"]), key=lambda i: i["seen"])
        return tuple((i["title"], i["url"], bool(i["cited"])) for i in (cited + rest)[: self.LIMIT])


def server_tool_params(
    tools: tuple[str, ...],
    model: str,
    fetch_max_uses: int,
    fetch_max_content_tokens: int,
    search_max_uses: int = WEB_SEARCH_MAX_USES,
) -> list[dict[str, Any]]:
    """The request's `tools` blocks for the real API. File ids never
    appear here — a member has no way to supply one, and code-execution
    containers are not reused across requests."""
    blocks: list[dict[str, Any]] = []
    for kind in tools:
        if kind == "web_search":
            blocks.append(
                {
                    "type": web_search_tool_type(model),
                    "name": "web_search",
                    "max_uses": search_max_uses,
                    "user_location": {
                        "type": "approximate",
                        "country": "KR",
                        "timezone": "Asia/Seoul",
                    },
                }
            )
        elif kind == "web_fetch":
            blocks.append(
                {
                    "type": web_fetch_tool_type(model),
                    "name": "web_fetch",
                    "max_uses": fetch_max_uses,
                    "max_content_tokens": fetch_max_content_tokens,
                }
            )
        elif kind == "code_execution":
            # Runs on Anthropic's servers only — nothing executes on ours.
            blocks.append({"type": "code_execution_20260521", "name": "code_execution"})
    return blocks


class ClaudeProvider(Protocol):
    #: "mock", or the model used when a call names none (`ANTHROPIC_MODEL`).
    #: Which model a call actually uses comes from the catalogue.
    model_id: str

    def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamEvent]: ...

    def rewrite_video_prompt(
        self, prompt: str, request: str, model: str = ""
    ) -> PromptRewrite: ...

    def generate_starter_app(
        self, name: str, idea: str, model: str = "", max_tokens: int = 8000
    ) -> StarterApp: ...

    def edit_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        model: str = "",
        max_tokens: int = 16000,
        style: str = "",
    ) -> ProjectEdit: ...


# -------------------------------------------------------------- the prompt

CHAT_SYSTEM_PROMPT = """\
You are the assistant inside CTRL+AI, a club where beginners make apps and \
short videos with AI. Most members cannot code and have never used an API.

How to answer:
- Always answer in Korean, whatever language the member writes in.
- Explain simply, as to a beginner. Short paragraphs, everyday words; when \
a technical term is unavoidable, say in one phrase what it means.
- Be warm and practical. Prefer one clear next step over a long list.
- The screen renders Markdown. When the member asks to compare or organise things, use a table. Put code in a fenced block with its language. Keep headings to a minimum; short paragraphs and "-" lists read best. Never write raw HTML outside a code block.
- The screen can preview one fenced `html` or `svg` block in a safe sandbox. For a web page, a small tool or game, a chart or a drawing, write exactly one self-contained ```html block: inline CSS and JavaScript, inline SVG for charts and drawings. No external scripts, fonts, images or network requests — they will not load. For a chart, use inline SVG or a few lines of plain JavaScript on a canvas, never a chart library. Keep it short enough to finish in one reply.

When a tool is available (web search, page reading, code execution):
- Use it without announcing it — no "검색해 볼게요" or step-by-step narration.
- After searching or reading, always answer the question with what you found and name the sources you used. If the results are thin, say what you found and what is still uncertain; never end without an answer.
- Never describe tool internals to the member: no JSON, parsing, result formats, retries, usage limits or error codes. If a tool failed, say in one plain sentence that you could not look it up and answer from what you know.

What CTRL+AI offers, to mention when it genuinely helps the member:
- Project Builder: start an app or website project by describing it in Korean. The button below your reply makes a small, working example app from the member's idea that they can try at once and change later — say so when you offer it. Builder apps run only in the visitor's browser: what they save stays on that person's device and is not shared. Apps that need logins, shared boards, chats or data across people cannot be made yet — when asked for one, say so plainly and suggest the closest single-person version.
- Video Generator: make a short video from a description.
- CtrlAIApps: apps other members made. CtrlAITube: their videos.
- Usage: how much of this quarter's budget is left.
- Profile: quarter participation and connected accounts.

Action buttons. When — and only when — the member wants to build an app, \
website, game or tool, end your reply with this exact line on its own:
[[action:builder|NAME]]
When they want to make a video, end with:
[[action:video|NAME]]
NAME is a short Korean project name of at most 20 characters. Use at most \
one such line, never mention it, and leave it out for everything else. The \
screen turns it into a button that opens that workspace with their idea \
filled in.
"""

PROMPT_HELP_SYSTEM = """\
You help a beginner improve the text prompt for an AI-generated short video. \
Reply in Korean, in one or two short sentences, saying what you changed. If \
the prompt should change, end with the complete revised prompt between \
<prompt> and </prompt>. If it should not, leave the tags out. Never produce \
anything but text.
"""

_PROMPT_TAG = re.compile(r"<prompt>(.*?)</prompt>", re.DOTALL)

STARTER_SYSTEM = """\
You build small starter web apps for CTRL+AI, a Korean club where \
beginners make apps with AI. Most members cannot code. Build a first, \
working version of the app the member describes, so they can see it run \
and then ask for changes.

Rules:
- Static files only: index.html, style.css and app.js (at most two more \
.js or .css files if really needed). Plain HTML, CSS and browser \
JavaScript — no frameworks, no build step, no server code.
- No external scripts, stylesheets, fonts, images or network requests: the \
preview blocks them all. Use inline SVG or CSS for icons and charts.
- To remember data, use CTRL+AI's storage (per app and per visitor, \
about 1 MB): `await ctrlai.storage.get(key)` (null when empty), \
`await ctrlai.storage.set(key, value)` (any JSON value), \
`ctrlai.storage.remove(key)`. It is asynchronous: load saved data, then \
draw the first screen. CTRL+AI adds its script itself — never add a tag \
for it. When `window.ctrlai` is missing (the files opened outside \
CTRL+AI), fall back to localStorage, exactly like this: \
const store = window.ctrlai && window.ctrlai.connected ? ctrlai.storage : \
{ get: async (k) => JSON.parse(localStorage.getItem(k) || "null"), \
set: async (k, v) => localStorage.setItem(k, JSON.stringify(v)) };
- index.html links its files exactly like this: \
<link rel="stylesheet" href="style.css"> and <script src="app.js"></script>.
- Everything the member sees is in Korean. Short Korean comments in the \
code, so a beginner can follow it.
- Small and complete beats big: about 300 lines in total, every button \
works, the layout fits a phone and a laptop.
- Give each app its own look that fits the idea and the requested style \
(colours, type, layout, mood) — not a default white card. Fonts only from \
local stacks (system-ui, "Apple SD Gothic Neo", "Malgun Gothic", serif, \
monospace, cursive); no web fonts or CDNs. Keep text readable (contrast).
- Never use alert(), confirm() or prompt(): the preview blocks them. Show messages on the page, and ask "정말 지울까요?" with a second tap instead.
- An app runs only in the visitor's browser: anything it saves stays on \
that visitor's device (ctrlai.storage) and is never shared with others. Apps \
that need accounts, logins, shared boards, chats or data across people \
cannot be made yet — make the closest single-person version and say so in \
the summary.

Return JSON only: "summary" is two short Korean sentences — what the app \
does, and one change the member could ask for next. "files" lists every \
file with its path and full content.
"""

#: The JSON the starter app comes back as (structured outputs).
STARTER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "files": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "files"],
    "additionalProperties": False,
}


def starter_request_text(name: str, idea: str) -> str:
    return f"프로젝트 이름: {name.strip()}\n\n만들고 싶은 것:\n{idea.strip() or name.strip()}"


EDIT_SYSTEM = """\
You build and change small web apps for CTRL+AI, a Korean club where \
beginners make apps with AI. Most members cannot code. The member tells \
you, in Korean, what to make or change; the project's current files \
follow their request.

Rules:
- Static files only: HTML, CSS and browser JavaScript (.html .css .js \
.json .svg .md .txt). No frameworks, no build step, no TypeScript, no \
server code of any kind — it will be refused. index.html is the entry.
- No external scripts, stylesheets, fonts, images or network requests: \
they are blocked. Use inline SVG or CSS for icons and charts.
- To remember data, use CTRL+AI's storage (per app and per visitor, \
about 1 MB): `await ctrlai.storage.get(key)` (null when empty), \
`await ctrlai.storage.set(key, value)` (any JSON value), \
`ctrlai.storage.remove(key)`. It is asynchronous: load saved data, then \
draw the first screen. CTRL+AI adds its script itself — never add a tag \
for it. When `window.ctrlai` is missing (the files opened outside \
CTRL+AI), fall back to localStorage, exactly like this: \
const store = window.ctrlai && window.ctrlai.connected ? ctrlai.storage : \
{ get: async (k) => JSON.parse(localStorage.getItem(k) || "null"), \
set: async (k, v) => localStorage.setItem(k, JSON.stringify(v)) };
- An app that still uses localStorage directly keeps working; when you \
touch its saving code anyway, move it to the store above.
- Change only what the request needs. Keep everything else as it is.
- To create or change a file, call write_file with its path and its \
complete new content — never a fragment or a diff. Call it once per file, \
all in this one reply. Do not call it for files that stay the same.
- Everything the member sees is in Korean, with short Korean comments in \
the code. The layout fits a phone and a laptop.
- At most 30 files, 200 KB each.
- Give each app its own look that fits the idea and the requested style \
(colours, type, layout, mood) — not a default white card. Fonts only from \
local stacks (system-ui, "Apple SD Gothic Neo", "Malgun Gothic", serif, \
monospace, cursive); no web fonts or CDNs. Keep text readable (contrast).
- Never use alert(), confirm() or prompt(): the preview blocks them. Show messages on the page, and ask "정말 지울까요?" with a second tap instead.
- An app runs only in the visitor's browser: anything it saves stays on \
that visitor's device (ctrlai.storage) and is never shared with others. Apps \
that need accounts, logins, shared boards, chats or data across people \
cannot be made yet — make the closest single-person version and say so in \
the summary.
- When asked to change the design ("디자인 바꿔 줘"), change the look only: \
keep every element id, every class the JavaScript uses, and all behaviour.

After the tool calls, reply in Korean in one or two short sentences: what \
you changed, and one thing the member could ask for next.
"""

#: The one tool a generation may call. `strict` makes every call match the
#: schema exactly, so a path and a content always arrive.
WRITE_FILE_TOOL: dict[str, Any] = {
    "name": "write_file",
    "description": (
        "Create or replace one file of the project with its complete content. "
        "Call once per file that changes."
    ),
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Relative path, e.g. index.html or js/app.js",
            },
            "content": {"type": "string", "description": "The whole file"},
        },
        "required": ["path", "content"],
        "additionalProperties": False,
    },
}

#: Rounds of tool use one generation may take. Claude is asked to write
#: every file in one reply; a second round only happens when it stops to
#: wait for the result of the first call.
EDIT_MAX_ROUNDS = 4


def edit_request_text(
    name: str, files: list[tuple[str, str]], request: str, style: str = ""
) -> str:
    """The member's request (and chosen style), then every current file, whole."""
    parts = [f"프로젝트 이름: {name.strip()}", "", "요청:", request.strip(), ""]
    if style.strip():
        parts += ["원하는 스타일:", style.strip(), ""]
    if files:
        parts.append("현재 파일:")
        for path, content in files:
            parts.append(f'<file path="{path}">\n{content}\n</file>')
    else:
        parts.append("현재 파일: 없음 (새로 만듭니다)")
    return "\n".join(parts)


# ------------------------------------------------------------------- mock

#: Put `[mock-error:<kind>]` in a message to make the mock fail that way —
#: so the Korean error messages can be seen, and tested, with no key.
#: Mock only: the real provider sends the text to Claude like any other.
MOCK_ERROR = re.compile(r"\[mock-error:(\w+)\]")
MOCK_REFUSAL = "[mock-refusal]"

#: (pattern, reply, action) — checked in order. An action adds the button.
#: chat-plus-rendering: canned replies that show what the screen renders —
#: a table, a code block with an HTML page, an SVG chart, a summary. They
#: match the 기능 둘러보기 phrasing literally ("표로 정리", "세 줄로 요약",
#: "차트로 보여", "웹페이지를 만들어") against the whole message — a pasted
#: article has paragraphs — and never when the member is asking for an app
#: (`_APP_WORDS`): loose words such as 표를 or 비교 would catch 투표를 받는
#: 앱 and send it the Seoul itinerary instead of the builder.
_MOCK_TABLE = (
    "서울 2박 3일 일정을 표로 정리했어요.\n\n"
    "| 날 | 오전 | 오후 | 저녁 |\n"
    "| --- | --- | --- | --- |\n"
    "| 1일 | 경복궁 | 북촌 한옥마을 | 광장시장 |\n"
    "| 2일 | 남산서울타워 | 명동 | 한강 공원 |\n"
    "| 3일 | 성수동 카페 | 서울숲 | 공항으로 |\n\n"
    "- 이동은 **지하철**이 가장 빨라요.\n"
    "- 궁궐은 월요일이나 화요일에 쉬는 곳이 있으니 미리 확인하세요."
)
_MOCK_PAGE = (
    "동아리 소개 페이지 한 장을 만들었어요. 아래 미리보기로 바로 볼 수 있고, "
    "Builder로 보내 고쳐 나갈 수도 있어요.\n\n"
    "```html\n"
    "<!doctype html>\n"
    "<html lang=\"ko\">\n"
    "<head>\n"
    "  <meta charset=\"utf-8\">\n"
    "  <title>CTRL+AI 동아리</title>\n"
    "  <style>\n"
    "    body { font-family: sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }\n"
    "    h1 { color: #4f46e5; }\n"
    "  </style>\n"
    "</head>\n"
    "<body>\n"
    "  <h1>CTRL+AI</h1>\n"
    "  <p>코드를 몰라도 AI와 함께 앱과 영상을 만드는 동아리예요.</p>\n"
    "  <ul>\n"
    "    <li>매주 목요일 저녁 모임</li>\n"
    "    <li>처음 오는 분 환영</li>\n"
    "  </ul>\n"
    "</body>\n"
    "</html>\n"
    "```\n\n"
    "색이나 문구를 바꾸고 싶으면 말씀해 주세요."
)
_MOCK_CHART = (
    "동아리 회원 수를 분기마다 정리하면 이래요.\n\n"
    "| 분기 | 회원 수 |\n"
    "| --- | ---: |\n"
    "| 2026 Q1 | 12 |\n"
    "| 2026 Q2 | 18 |\n"
    "| 2026 Q3 | 25 |\n"
    "| 2026 Q4 | 31 |\n\n"
    "**한 줄 해석:** 분기마다 6~7명씩 꾸준히 늘고 있어요.\n\n"
    "아래 미리보기를 열면 막대그래프로 볼 수 있어요.\n\n"
    "```svg\n"
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 240 140\" width=\"240\" height=\"140\">\n"
    "  <rect x=\"20\" y=\"92\" width=\"36\" height=\"36\" fill=\"#6366f1\"/>\n"
    "  <rect x=\"75\" y=\"74\" width=\"36\" height=\"54\" fill=\"#6366f1\"/>\n"
    "  <rect x=\"130\" y=\"53\" width=\"36\" height=\"75\" fill=\"#6366f1\"/>\n"
    "  <rect x=\"185\" y=\"35\" width=\"36\" height=\"93\" fill=\"#6366f1\"/>\n"
    "</svg>\n"
    "```"
)
_MOCK_SUMMARY = (
    "세 줄로 요약했어요.\n\n"
    "1. 글의 핵심 주장을 첫 줄에 담았어요.\n"
    "2. 그 이유와 근거를 두 번째 줄에 정리했어요.\n"
    "3. 마지막 줄은 글이 권하는 다음 행동이에요.\n\n"
    "(테스트 모드라 실제 글을 읽지는 않았어요.)"
)

_EXAMPLE_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(차트|그래프)\s?(로|를)\s?(보여|그려)"), _MOCK_CHART),
    (re.compile(r"웹\s?페이지를\s?만들어"), _MOCK_PAGE),
    (re.compile(r"줄로\s?요약|요약해\s?줘:"), _MOCK_SUMMARY),
    (re.compile(r"(?<![가-힣])표로\s?(정리|만들|보여)"), _MOCK_TABLE),
]
_APP_WORDS = re.compile(r"앱|어플|사이트|도구|프로그램|게임|대시보드|쇼핑몰|(?<![가-힣])내 |내가")
_SUMMARY_ASK = re.compile(r"^\s*아래 글을 세 줄로 요약해 줘:", re.MULTILINE)


def example_reply(message: str) -> str | None:
    """The canned 기능 둘러보기 reply for this message, if it is one.

    The 파일 요약 card is recognised first: the article pasted under it may
    mention apps or programs and is still to be summarised.
    """
    if _SUMMARY_ASK.search(message):
        return _MOCK_SUMMARY
    if _APP_WORDS.search(message):
        return None
    for pattern, reply in _EXAMPLE_RULES:
        if pattern.search(message):
            return reply
    return None


_CHAT_RULES: list[tuple[re.Pattern[str], str, str | None]] = [
    (
        re.compile(r"내 영상|만든 영상|영상 목록"),
        "지금까지 만든 영상 프로젝트는 Video Generator에 모여 있어요. 왼쪽 메뉴에서 열어 보세요.",
        None,
    ),
    (
        re.compile(r"내 프로젝트|내 앱|내가 만든|만든 프로젝트|프로젝트 목록"),
        "지금까지 만든 프로젝트는 Project Builder에 모여 있어요. 왼쪽 메뉴에서 열어 보세요.",
        None,
    ),
    (
        re.compile(r"영상|비디오|쇼츠|숏폼|클립|유튜브|youtube|촬영|장면", re.IGNORECASE),
        "영상으로 만들면 좋겠네요! Video Generator에서 장면을 설명하면 짧은 영상으로 "
        "만들어 볼 수 있어요. 아래 단추를 누르면 지금 하신 이야기를 그대로 들고 갑니다.",
        "video",
    ),
    (
        re.compile(r"앱|어플|프로그램|사이트|웹|게임|도구|만들|제작|관리|기록"),
        "좋은 아이디어예요! 아래 단추를 누르면 Project Builder가 지금 하신 이야기로 바로 "
        "실행해 볼 수 있는 예시 앱을 만들어 줘요. 코드를 몰라도 괜찮고, 만든 뒤에 바꿀 점을 "
        "말하면 됩니다.",
        "builder",
    ),
    (
        re.compile(r"크레딧|토큰|사용량|남은|남았|할당|잔액|얼마나"),
        "이번 분기에 남은 지원금은 Usage 화면에서 볼 수 있어요. 동아리 지원과 개인 잔액은 "
        "따로 계산됩니다.",
        None,
    ),
    (
        re.compile(r"둘러|구경|다른 사람|다른 회원|커뮤니티|추천|인기"),
        "다른 회원들이 만든 앱은 CtrlAIApps에서, 영상은 CtrlAITube에서 볼 수 있어요.",
        None,
    ),
]

_CHAT_FALLBACK = (
    "지금은 테스트 모드라 미리 준비된 답변만 드릴 수 있어요. 만들고 싶은 앱이나 영상을 "
    "이야기해 주시면 알맞은 곳으로 안내해 드릴게요."
)

# --------------------------------------------- the mock's server tools

#: Plausible, clearly-labelled example sources (chat-plus-tools).
_MOCK_SEARCH_SOURCES: tuple[tuple[str, str], ...] = (
    ("서울시 열린데이터 광장 — 자치구별 인구 통계", "https://data.seoul.go.kr/dataList/10727"),
    ("통계청 KOSIS — 주민등록 인구 현황", "https://kosis.kr/statHtml/statHtml.do?orgId=101"),
    ("연합뉴스 — 2026년 인구 동향 기사", "https://www.yna.co.kr/view/AKR20260110001"),
)

_MOCK_URL = re.compile(r"https?://[^\s)\"']+")


def _mock_tool_turn(
    tools: tuple[str, ...], text: str, fetch_max_content_tokens: int = 10_000
) -> tuple[str | None, list["StreamEvent"], tuple[tuple[str, str], ...], int, int, int]:
    """What the mock's server tools do with one message.

    Returns (reply or None, tool events, sources, billed searches,
    fetches, extra input tokens from tool results — billed once, inside
    this reply). Deterministic, keyed on the message like `_CHAT_RULES`,
    and only ever reached when the request carries the tool. The canned
    triggers:

    * "검색 오류" — the tool fails (an HTTP-200 error block for real):
      a Korean sentence, tokens charged, **no search billed**;
    * "검색" — two billed searches, three sources, ~800 result tokens;
    * a URL with 웹 페이지 읽기 on — one fetch, the page as the source;
    * "실행"/"계산" with 코드 실행 on — a code-output block. The mock
      fabricates the output; nothing is ever executed here.
    """
    if "web_search" in tools and "검색 오류" in text:
        return (
            "검색 도구가 응답하지 않아, 검색 없이 아는 범위에서 답해요. 잠시 뒤 다시 "
            "시도해 주세요. (테스트 모드의 예시 응답입니다.)",
            [ToolStatus("web_search", "running"), ToolStatus("web_search", "error")],
            (),
            0,
            0,
            0,
        )
    if "web_search" in tools and "검색" in text:
        reply = (
            "웹에서 찾아봤어요. 요약하면 이렇습니다.\n\n"
            "1. 공공 데이터 기준 최신 수치는 올해 초에 갱신됐어요.\n"
            "2. 기관마다 집계 기준이 달라서, 출처를 함께 확인하는 편이 안전해요.\n\n"
            "자세한 내용은 아래 출처에 있어요. (테스트 모드의 예시 검색 결과입니다.)"
        )
        return (
            reply,
            [
                ToolStatus("web_search", "running"),
                ToolStatus("web_search", "done", result_tokens=800, searches=2),
            ],
            _MOCK_SEARCH_SOURCES,
            2,
            0,
            800,
        )
    url_match = _MOCK_URL.search(text)
    if "web_fetch" in tools and url_match:
        # The mock's page is small; a real page is cut at the admin's
        # max_content_tokens, so the mock honours the same ceiling.
        fetch_tokens = min(500, fetch_max_content_tokens)
        url = url_match.group(0)
        reply = (
            "페이지를 읽었어요. 간추리면: 소개, 주요 기능, 사용 방법의 세 부분으로 "
            "이루어져 있고, 본문은 약 1,200자예요. (테스트 모드의 예시 요약입니다.)"
        )
        return (
            reply,
            [
                ToolStatus("web_fetch", "running"),
                ToolStatus("web_fetch", "done", result_tokens=fetch_tokens),
            ],
            (("읽은 페이지", url),),
            0,
            1,
            fetch_tokens,
        )
    if "code_execution" in tools and ("실행" in text or "계산" in text):
        reply = (
            "코드를 실행해 확인했어요.\n\n```text\n>>> sum(range(1, 101))\n5050\n```\n\n"
            "1부터 100까지의 합은 5,050이에요. (테스트 모드의 예시 결과입니다 — 코드는 "
            "Anthropic 서버에서만 실행되고, CTRL+AI 서버에서는 아무것도 실행되지 않아요.)"
        )
        return (
            reply,
            [
                ToolStatus("code_execution", "running"),
                ToolStatus("code_execution", "done", result_tokens=120),
            ],
            (),
            0,
            0,
            120,
        )
    return (None, [], (), 0, 0, 0)


_PROMPT_RULES: list[tuple[re.Pattern[str], str, str | None]] = [
    (
        re.compile(r"어둡|어두운|밤|톤 다운|차분"),
        "좋아요. 전체 조명을 낮추고 네온 반사를 강조하는 방향으로 프롬프트를 수정했어요.",
        "전체 조명을 더 낮추고 네온 반사를 강조해줘.",
    ),
    (
        re.compile(r"천천|느리|속도|카메라|움직임"),
        "카메라 이동을 느린 트래킹 샷으로 조정해볼게요.",
        "카메라는 느린 트래킹 샷으로 천천히 움직여줘.",
    ),
    (
        re.compile(r"밝|화사|경쾌|활기"),
        "분위기를 밝게 바꿔볼게요. 조명을 올리고 색을 조금 더 선명하게 했습니다.",
        "조명을 밝게 올리고 색감을 선명하게 해줘.",
    ),
    (
        re.compile(r"사람|인물|주인공|얼굴"),
        "인물이 더 잘 보이도록 화면 구성을 조정했어요.",
        "인물이 화면 중앙에 오도록 구도를 잡아줘.",
    ),
    (
        re.compile(r"소리|음악|배경음|사운드"),
        "소리는 왼쪽 설정의 소리 단추로 정합니다. 프롬프트는 그대로 두었어요.",
        None,
    ),
]

_PROMPT_FALLBACK = (
    "지금은 예시 답변만 드릴 수 있어요. 밝기, 카메라 움직임, 인물 구도처럼 "
    "바꾸고 싶은 점을 말씀해 주시면 프롬프트를 고쳐 드립니다."
)


def short_title(text: str, limit: int = 20) -> str:
    """The first line of `text`, cut to `limit` characters."""
    stripped = text.strip()
    return stripped.splitlines()[0][:limit].strip() if stripped else ""


#: Anthropic caches nothing below this many prompt tokens, silently. By
#: model; the newest models cache from 512, Haiku 4.5 only from 4,096.
CACHE_MINIMUM_TOKENS: dict[str, int] = {"claude-haiku-4-5": 4096}
DEFAULT_CACHE_MINIMUM_TOKENS = 512
_TTL_SECONDS = {"5m": 300, "1h": 3600}


def cache_minimum(model: str) -> int:
    for prefix, minimum in CACHE_MINIMUM_TOKENS.items():
        if model.startswith(prefix):
            return minimum
    return DEFAULT_CACHE_MINIMUM_TOKENS


class MockPromptCache:
    """What Anthropic's prompt cache would hold, for the mock to bill by.

    The prompt is a list of blocks — the system prompt, then each message.
    A request has breakpoints after the system prompt and after its last
    message, as the real request does. It reads the longest prefix an
    earlier request wrote and has not let expire, writes up to its last
    breakpoint that is long enough to cache, and pays full price for the
    rest. A read refreshes the entry, as Anthropic's does. Entries are
    per model — caches are model-scoped.
    """

    def __init__(self) -> None:
        self._entries: dict[str, float] = {}

    def clear(self) -> None:
        self._entries.clear()

    @staticmethod
    def _key(model: str, blocks: list[str]) -> str:
        digest = hashlib.sha256(model.encode())
        for block in blocks:
            digest.update(b"\x00")
            digest.update(block.encode())
        return digest.hexdigest()

    def bill(
        self,
        model: str,
        ttl: str | None,
        blocks: list[str],
        now: float | None = None,
        sizes: list[int] | None = None,
    ) -> tuple[int, int, int]:
        """(uncached input, cache write, cache read) for one request.

        `sizes`, when given, are the blocks' token counts (attachments are
        not one token per character); otherwise each block's length.
        """
        if sizes is None:
            sizes = [estimate_tokens(block) for block in blocks]
        total = sum(sizes)
        if ttl is None or not blocks:
            return total, 0, 0
        now = time.monotonic() if now is None else now
        lifetime = _TTL_SECONDS.get(ttl, _TTL_SECONDS["5m"])

        cumulative = [sum(sizes[: k + 1]) for k in range(len(sizes))]
        read = 0
        for k in range(len(blocks), 0, -1):
            key = self._key(model, blocks[:k])
            expires = self._entries.get(key)
            if expires is not None and expires > now:
                read = cumulative[k - 1]
                self._entries[key] = now + lifetime
                break

        written_to = read
        minimum = cache_minimum(model)
        for k in sorted({1, len(blocks)}):
            if cumulative[k - 1] > read and cumulative[k - 1] >= minimum:
                self._entries[self._key(model, blocks[:k])] = now + lifetime
                written_to = max(written_to, cumulative[k - 1])
        return total - written_to, written_to - read, read


#: One cache for the process, like Anthropic's for the organisation.
MOCK_PROMPT_CACHE = MockPromptCache()


def _text_of(content: str | list[dict]) -> str:
    """A message's text, whether it is plain text or content blocks."""
    if isinstance(content, str):
        return content
    return "\n\n".join(block.get("text", "") for block in content if block.get("type") == "text")


def _cache_key(content: str | list[dict]) -> str:
    if isinstance(content, str):
        return content
    import json

    return json.dumps(content, sort_keys=True, ensure_ascii=False)


def _files_reply(files: list[dict]) -> str:
    """The mock's answer to a message with attachments: what arrived."""
    images = sum(1 for block in files if block.get("type") == "image")
    documents = len(files) - images
    parts = []
    if images:
        parts.append(f"사진 {images}장")
    if documents:
        parts.append(f"문서 {documents}개")
    return (
        f"첨부한 파일({', '.join(parts)})을 받았어요. 테스트 모드라 내용을 읽지는 않았지만, "
        "실제 Claude는 파일을 보고 답해요."
    )


#: The mock's summarized thinking (chat-thinking-view): short Korean steps,
#: one paragraph each, as the screen numbers them.
MOCK_THINKING: tuple[str, ...] = (
    "질문이 무엇을 원하는지 먼저 정리했어요.",
    "초보자도 따라 할 수 있게 쉬운 말로 설명하기로 했어요.",
    "한 번에 하나씩 해 볼 수 있는 다음 단계를 골랐어요.",
)

#: Output tokens the mock bills for thinking, per model: Sonnet thinks a
#: little at low effort; Haiku up to its budget; Opus already thinks, so
#: showing it adds nothing.
_MOCK_THINKING_TOKENS = {"claude-sonnet-5-5": 300, "claude-haiku-4-5": 600}


def mock_thinking_tokens(model: str) -> int:
    for prefix, tokens in _MOCK_THINKING_TOKENS.items():
        if model.startswith(prefix):
            return tokens
    return 0


#: The mock's JSON switches (app-platform P2 tests).
MOCK_BAD_JSON = "MOCK_BAD_JSON"
MOCK_ALWAYS_BAD_JSON = "MOCK_ALWAYS_BAD_JSON"


def _json_schema_in(system: str) -> dict | None:
    """The schema `app_ai.system_prompt` put under its marker, if any."""
    marker = "JSON_SCHEMA:\n"
    if marker not in system:
        return None
    try:
        value = json.loads(system.split(marker, 1)[1].strip())
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


class MockClaudeProvider:
    model_id = "mock"

    def __init__(self, delay_ms: int = 0) -> None:
        self.delay = max(0, delay_ms) / 1000

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamEvent]:
        newest = request.messages[-1]["content"] if request.messages else ""
        whole = _text_of(newest)
        # An unanswered earlier message may have been joined to this one
        # (see `chat.build_context`); the mock answers only the newest part.
        last = whole.rsplit("\n\n", 1)[-1]
        files = (
            [block for block in newest if block.get("type") != "text"]
            if isinstance(newest, list)
            else []
        )

        failure = MOCK_ERROR.search(last)
        if failure:
            kind = failure.group(1)
            raise ClaudeError(kind if kind in MEMBER_MESSAGE else ProviderErrorKind.UNKNOWN, "mock")

        # Attachments are billed from the same formulas as the estimate
        # (chat-plus-files), so a test sees the figures the pre-check used.
        from app.services.attachments import content_tokens

        contents = [request.system, *(message["content"] for message in request.messages)]
        keys = [_cache_key(content) for content in contents]
        sizes = [content_tokens(content) for content in contents]
        # The tool list sits above the system prompt in the real cache
        # hierarchy, so toggling a tool breaks the cache — the mock
        # simulates that by keying (and billing) a marker block when any
        # tool is on (chat-plus-tools).
        if request.tools:
            marker = f"[tools:{','.join(request.tools)}]"
            keys.insert(0, marker)
            sizes.insert(0, estimate_tokens(marker))
        uncached, written, read = MOCK_PROMPT_CACHE.bill(
            request.model or self.model_id,
            request.cache_ttl,
            keys,
            sizes=sizes,
        )

        # Server tools (chat-plus-tools): deterministic canned behaviour,
        # keyed on the message like the mock's other rules, and only when
        # the request carries the tool — the conversation's toggle AND the
        # model's switch both had to be on for that.
        tool_reply, tool_events, sources, searches, fetches, extra_input = _mock_tool_turn(
            request.tools, last, request.fetch_max_content_tokens
        )

        thinking_tokens = 0

        def usage(output_tokens: int) -> UsageUpdate:
            # Tool results enter this request as input tokens, billed once
            # here; billed searches and fetches ride along for the ledger.
            # Thinking is output (chat-thinking-view).
            return UsageUpdate(
                uncached + extra_input,
                output_tokens + thinking_tokens,
                written,
                read,
                searches,
                fetches,
            )

        yield usage(0)

        if MOCK_REFUSAL in last:
            yield StreamEnd("refusal")
            return

        for tool_event in tool_events:
            if self.delay:
                await asyncio.sleep(self.delay)
            yield tool_event

        # 생각 과정 보기 (chat-thinking-view): a deterministic summary, and
        # the thinking billed as output like the real API — Opus already
        # thinks, so showing it costs nothing extra there; Haiku thinks
        # only within its budget, and not at all without room for one.
        model_id = request.model or self.model_id
        if request.show_thinking and thinking_params(
            model_id, "off", "low", show=True, max_tokens=request.max_tokens
        ).get("thinking"):
            thinking_tokens = mock_thinking_tokens(model_id)
            for paragraph in MOCK_THINKING:
                if self.delay:
                    await asyncio.sleep(self.delay)
                yield ThinkingDelta(paragraph + "\n\n")

        reply, action = _CHAT_FALLBACK, None
        if tool_reply is not None:
            reply = tool_reply
        elif files and example_reply(whole) is None:
            reply = _files_reply(files)
        else:
            example = example_reply(whole)
            if example is not None:
                reply = example
            else:
                for pattern, text, rule_action in _CHAT_RULES:
                    if pattern.search(last):
                        reply, action = text, rule_action
                        break
        # 기능 상자 JSON (app-platform P2): a schema in the system prompt
        # gets a value that fits it — or, for the retry tests, one that
        # does not (MOCK_BAD_JSON: the first attempt only).
        schema = _json_schema_in(request.system)
        if schema is not None:
            always_bad = any(MOCK_ALWAYS_BAD_JSON in _text_of(m["content"]) for m in request.messages)
            if always_bad or MOCK_BAD_JSON in last:
                reply = "이건 JSON이 아니에요."
            else:
                from app.services.app_ai import sample_for

                reply = json.dumps(sample_for(schema), ensure_ascii=False)
            action = None
        if action:
            reply = f"{reply}\n[[action:{action}|{short_title(last)}]]"

        # The mock honors `max_tokens` like the API does (one character =
        # one token, matching its usage figures), so token-guard's capped
        # flow — stop_reason "max_tokens", real usage reported — runs end
        # to end with no key.
        stop_reason = "end_turn"
        room = request.max_tokens - thinking_tokens
        if request.max_tokens > 0 and len(reply) > room:
            reply = reply[: max(0, room)]
            stop_reason = "max_tokens"

        # Small pieces, like the real stream, so the screen and the marker
        # filter see the same shape either way.
        sent = 0
        for start in range(0, len(reply), 6):
            piece = reply[start : start + 6]
            if self.delay:
                await asyncio.sleep(self.delay)
            sent += len(piece)
            yield TextDelta(piece)
            yield usage(sent)
        if sources:
            yield ToolSources(sources)
        yield StreamEnd(stop_reason)

    def rewrite_video_prompt(self, prompt: str, request: str, model: str = "") -> PromptRewrite:
        for pattern, reply, addition in _PROMPT_RULES:
            if pattern.search(request):
                revised = None if addition is None else f"{prompt.strip()} {addition}".strip()
                return self._rewrite(prompt, request, reply, revised)
        return self._rewrite(prompt, request, _PROMPT_FALLBACK, None)

    def generate_starter_app(
        self, name: str, idea: str, model: str = "", max_tokens: int = 8000
    ) -> StarterApp:
        """A small, working to-do style app named after the idea.

        The same app whatever the idea — enough to see the file tree, the
        code and the sandboxed preview work, and to be charged like a real
        generation (tokens estimated from the text).
        """
        failure = MOCK_ERROR.search(idea)
        if failure:
            kind = failure.group(1)
            raise ClaudeError(kind if kind in MEMBER_MESSAGE else ProviderErrorKind.UNKNOWN, "mock")
        files = _mock_starter_files(name.strip() or "내 앱", idea.strip())
        return StarterApp(
            summary=(
                f"'{name.strip() or '내 앱'}'의 첫 버전이에요. 항목을 적어 추가하고, 눌러서 완료 "
                "표시를 하고, 지울 수 있어요. 다음엔 \"카테고리를 나눠 줘\"처럼 바꿀 점을 말해 보세요."
            ),
            files=files,
            model=model or self.model_id,
            input_tokens=estimate_tokens(STARTER_SYSTEM + starter_request_text(name, idea)),
            output_tokens=sum(len(content) for _, content in files),
        )

    def edit_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        model: str = "",
        max_tokens: int = 16000,
        style: str = "",
    ) -> ProjectEdit:
        """A plausible, deterministic change (builder-static-runtime).

        * No index.html yet — the starter app.
        * "색" / "color" in the request — the button colour changes.
        * Anything else — a short note with the request appears on the page.
        * `[mock-server-code]` writes a `server.py`, which the backend must
          refuse; `[mock-error:<kind>]` fails that way.
        """
        failure = MOCK_ERROR.search(request)
        if failure:
            kind = failure.group(1)
            raise ClaudeError(kind if kind in MEMBER_MESSAGE else ProviderErrorKind.UNKNOWN, "mock")
        current = dict(files)
        title = name.strip() or "내 앱"
        if "[mock-server-code]" in request:
            writes = [("server.py", "print('서버에서 실행되는 코드')\n")]
            summary = "서버 코드를 만들어 봤어요."
        elif "index.html" not in current:
            writes = _mock_starter_files(title, request.strip())
            accent = _mock_style_accent(style or request)
            if accent != MOCK_ACCENT:
                writes = [(path, content.replace(MOCK_ACCENT, accent)) for path, content in writes]
            summary = f"'{title}'의 첫 버전을 만들었어요. 다음엔 바꾸고 싶은 점을 말해 보세요."
        elif re.search(r"색|color", request, re.IGNORECASE):
            css = current.get("style.css", "")
            if MOCK_ACCENT in css:
                css = css.replace(MOCK_ACCENT, MOCK_ACCENT_NEW)
            else:
                css += f"\n/* 요청: 버튼 색 바꾸기 */\nbutton {{ background: {MOCK_ACCENT_NEW}; color: #fff; }}\n"
            writes = [("style.css", css)]
            summary = "버튼 색을 주황색으로 바꿨어요. 다음엔 글자 크기를 키워 달라고 해 보세요."
        else:
            import html as html_lib

            note = (
                f'  <p class="change-note">바뀐 점: {html_lib.escape(request.strip()[:120])}</p>\n'
            )
            page = current["index.html"]
            marker = "</main>" if "</main>" in page else "</body>"
            page = page.replace(marker, note + marker, 1) if marker in page else page + note
            writes = [("index.html", page)]
            summary = "요청한 내용을 화면에 반영했어요. 다음엔 색이나 배치를 바꿔 달라고 해 보세요."
        return ProjectEdit(
            summary=summary,
            writes=writes,
            model=model or self.model_id,
            input_tokens=estimate_tokens(EDIT_SYSTEM + edit_request_text(name, files, request, style)),
            output_tokens=min(max_tokens, sum(len(content) for _, content in writes) // 3 + 60),
        )

    def _rewrite(
        self, prompt: str, request: str, reply: str, revised: str | None
    ) -> PromptRewrite:
        return PromptRewrite(
            reply=reply,
            revised_prompt=revised,
            model=self.model_id,
            input_tokens=estimate_tokens(PROMPT_HELP_SYSTEM) + len(prompt) + len(request),
            output_tokens=len(reply) + len(revised or ""),
        )


#: The mock starter app's button colour, and what "색을 바꿔 줘" turns it into.
MOCK_ACCENT = "#3b6cf6"
MOCK_ACCENT_NEW = "#e8590c"

#: The mock's nod to 스타일 (ctrlaiapps-publish F2): a different accent per
#: style word, so two mock apps made with different styles differ.
_MOCK_STYLE_ACCENTS: tuple[tuple[str, str], ...] = (
    ("귀여운", "#ff6fae"),
    ("레트로", "#c0841a"),
    ("다크", "#7c5cff"),
    ("신문", "#222222"),
    ("게임", "#18b45c"),
    ("깔끔", "#3b6cf6"),
)


def _mock_style_accent(text: str) -> str:
    for word, colour in _MOCK_STYLE_ACCENTS:
        if word in text:
            return colour
    return MOCK_ACCENT


def _mock_starter_files(name: str, idea: str) -> list[tuple[str, str]]:
    import html

    title = html.escape(name)
    subtitle = html.escape(idea[:120] or "처음 만든 앱이에요.")
    return [
        (
            "index.html",
            f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="app">
    <h1>{title}</h1>
    <p class="subtitle">{subtitle}</p>
    <!-- 새 항목을 적는 곳 -->
    <form id="add-form">
      <input id="new-item" placeholder="할 일을 적어 보세요" autocomplete="off">
      <button type="submit">추가</button>
    </form>
    <ul id="items"></ul>
    <p id="count" class="count"></p>
  </main>
  <script src="app.js"></script>
</body>
</html>
""",
        ),
        (
            "style.css",
            """/* 화면 전체 */
body { margin: 0; font-family: system-ui, sans-serif; background: #f5f6fa; color: #1d2433; }
.app { max-width: 480px; margin: 40px auto; padding: 24px; background: #fff;
       border-radius: 16px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08); }
h1 { margin: 0 0 4px; font-size: 1.6rem; }
.subtitle { margin: 0 0 20px; color: #5b6475; }
/* 입력 칸과 버튼 */
form { display: flex; gap: 8px; }
input { flex: 1; padding: 10px 12px; border: 1px solid #cfd5e2; border-radius: 10px; font-size: 1rem; }
button { padding: 10px 16px; border: 0; border-radius: 10px; background: #3b6cf6; color: #fff;
         font-size: 1rem; cursor: pointer; }
/* 목록 */
ul { list-style: none; padding: 0; margin: 20px 0 8px; }
li { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #eef0f5; }
li.done span { text-decoration: line-through; color: #9aa3b5; }
li span { flex: 1; cursor: pointer; }
li button { background: transparent; color: #c0392b; padding: 4px 8px; }
.count { color: #5b6475; font-size: 0.9rem; }
""",
        ),
        (
            "app.js",
            """// 목록을 저장해 두는 이름
const KEY = "starter-items";

// CTRL+AI 안에서는 ctrlai.storage(이 앱 · 이 방문자만의 저장 공간)에,
// 밖에서 파일을 열면 이 브라우저의 localStorage에 저장합니다.
const store = window.ctrlai && window.ctrlai.connected ? ctrlai.storage : {
  get: async (k) => JSON.parse(localStorage.getItem(k) || "null"),
  set: async (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

// 저장된 목록은 맨 아래에서 불러옵니다. 그 전까지는 빈 목록입니다.
let items = [];

const form = document.getElementById("add-form");
const input = document.getElementById("new-item");
const list = document.getElementById("items");
const count = document.getElementById("count");

// 목록을 저장하고 화면을 다시 그립니다.
function save() {
  store.set(KEY, items).catch(() => {});
  render();
}

// 화면에 목록을 그립니다.
function render() {
  list.innerHTML = "";
  items.forEach((item, index) => {
    const row = document.createElement("li");
    if (item.done) row.classList.add("done");

    const text = document.createElement("span");
    text.textContent = item.text;
    // 글자를 누르면 완료 / 미완료가 바뀝니다.
    text.addEventListener("click", () => {
      item.done = !item.done;
      save();
    });

    const remove = document.createElement("button");
    remove.textContent = "삭제";
    remove.addEventListener("click", () => {
      items.splice(index, 1);
      save();
    });

    row.append(text, remove);
    list.append(row);
  });
  const left = items.filter((item) => !item.done).length;
  count.textContent = items.length ? `남은 항목 ${left}개 / 전체 ${items.length}개` : "아직 항목이 없어요.";
}

// "추가"를 누르면 새 항목을 넣습니다.
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  items.push({ text, done: false });
  input.value = "";
  save();
});

// 저장된 목록을 불러온 다음 처음 화면을 그립니다.
store.get(KEY).then((saved) => {
  if (Array.isArray(saved)) items = saved;
}).catch(() => {}).then(render);
""",
        ),
    ]


# --------------------------------------------------------------- anthropic

#: Effort levels used here. `between_tools` accepts `high` or below.
_EFFORTS = ("low", "medium", "high")


#: Haiku 4.5's thinking budget when 생각 과정 보기 is on (chat-thinking-view).
#: The API's minimum; it must stay below `max_tokens`.
HAIKU_THINKING_BUDGET = 1024


def thinking_params(
    model: str,
    thinking: str,
    effort: str,
    show: bool = False,
    max_tokens: int = 0,
) -> dict[str, Any]:
    """The request fields that set how much Claude thinks, per model.

    "off" is what was agreed for chat (2026-10-07): no thinking where the
    model allows it, otherwise the lowest effort.

    * **Sonnet 5.5** — thinking off is `{"type": "between_tools"}`;
      `{"type": "disabled"}` is rejected. Effort must be `high` or below.
    * **Opus 5.5** (and other current models) — thinking cannot be turned
      off, so "off" leaves adaptive thinking on and relies on low effort.
    * **Haiku 4.5** — does not think unless asked with a token budget, and
      rejects `effort`, so it gets neither field.

    `show` is 생각 과정 보기 (chat-thinking-view; the docs as checked on
    2026-10-14, platform.claude.com › Thinking):

    * Sonnet 5.5 and Opus 5.5 default `display` to `"omitted"` — an empty
      thinking text. On, both send `{"type": "adaptive", "display":
      "summarized"}` at the conversation's effort. On Sonnet that turns
      thinking on (extra output tokens); on Opus it only makes the thinking
      that already runs visible — no extra cost.
    * Haiku 4.5 takes manual thinking, `{"type": "enabled", "budget_tokens":
      N}` with N ≥ 1,024 and below `max_tokens`; it returns a summary by
      default. When the per-reply cap leaves no room for the budget the
      reply goes without thinking rather than failing.

    A summary is billed as the full thinking, as output tokens.
    """
    chosen = effort.strip().lower()
    effort = chosen if chosen in _EFFORTS else "low"
    off = thinking.strip().lower() != "on"

    if model.startswith("claude-haiku-4-5"):
        if show and max_tokens > HAIKU_THINKING_BUDGET * 2:
            return {"thinking": {"type": "enabled", "budget_tokens": HAIKU_THINKING_BUDGET}}
        return {}
    if show:
        return {
            "thinking": {"type": "adaptive", "display": "summarized"},
            "output_config": {"effort": effort},
        }
    if model.startswith("claude-sonnet-5-5"):
        mode = "between_tools" if off else "adaptive"
        return {"thinking": {"type": mode}, "output_config": {"effort": effort}}
    # Opus 5.5 and anything newer: adaptive thinking is the only mode.
    return {"output_config": {"effort": effort}}


def classify(error: BaseException) -> ClaudeError:
    """An SDK exception as a `ClaudeError`. Never copies the message body.

    The detail is the status code and the exception type: enough to debug
    from, and nothing that could repeat back a request.
    """
    import anthropic

    if isinstance(error, ClaudeError):
        return error
    if isinstance(error, anthropic.APITimeoutError):
        return ClaudeError(ProviderErrorKind.TIMEOUT, "timeout")
    if isinstance(error, anthropic.APIConnectionError):
        return ClaudeError(ProviderErrorKind.UNAVAILABLE, type(error).__name__)

    status = getattr(error, "status_code", None)
    detail = f"HTTP {status} {type(error).__name__}" if status else type(error).__name__
    message = str(getattr(error, "message", "")).lower()

    if status in (401, 403):
        return ClaudeError(ProviderErrorKind.AUTH, detail)
    if status == 402 or (status == 400 and "credit balance" in message):
        # Running out of prepaid credit arrives as a 400 whose message says
        # so; a billing problem as a 402. Both mean the same to a member.
        return ClaudeError(ProviderErrorKind.CREDIT, detail)
    if status == 429:
        return ClaudeError(ProviderErrorKind.RATE_LIMITED, detail)
    if status is not None and status >= 500:
        # 500, and 529 "overloaded".
        return ClaudeError(ProviderErrorKind.UNAVAILABLE, detail)
    if status is None and "overloaded" in message:
        # An error event in the middle of a stream carries no status code.
        return ClaudeError(ProviderErrorKind.UNAVAILABLE, detail)
    return ClaudeError(ProviderErrorKind.UNKNOWN, detail)


class AnthropicClaudeProvider:
    """The real Claude, through the official SDK.

    `http_client` / `async_http_client` exist for the tests, which hand in
    a transport that answers locally — no request ever leaves the machine.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        http_client: Any | None = None,
        async_http_client: Any | None = None,
    ) -> None:
        self.model_id = settings.anthropic_model.strip()
        self._settings = settings
        self._http_client = http_client
        self._async_http_client = async_http_client

    def _client_kwargs(self) -> dict[str, Any]:
        return {
            "api_key": self._settings.anthropic_api_key,
            "timeout": self._settings.chat_timeout_seconds,
            # One retry for a dropped connection or a 529; more would make
            # a member wait several timeouts for one message.
            "max_retries": 1,
        }

    def request_params(
        self,
        system: str,
        messages: list[dict[str, str]],
        max_tokens: int,
        model: str = "",
        cache_ttl: str | None = None,
        tools: tuple[str, ...] = (),
        fetch_max_uses: int = 1,
        fetch_max_content_tokens: int = 10_000,
        show_thinking: bool = False,
        search_max_uses: int = 5,
    ) -> dict[str, Any]:
        """The request body. With `cache_ttl`, two cache breakpoints.

        The system prompt is the same for every conversation, so it gets
        an explicit marker of its own; the top-level `cache_control` lets
        Anthropic mark the newest message, so the next turn re-reads the
        conversation so far. Both use the same TTL — a longer TTL may not
        follow a shorter one. Nothing per-request (a time, an id) is put in
        the prompt: one changed byte early on and every later cache misses.
        """
        model = model or self.model_id
        params: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
            **thinking_params(
                model,
                self._settings.chat_thinking,
                self._settings.chat_effort,
                show=show_thinking,
                max_tokens=max_tokens,
            ),
        }
        if tools:
            # Placed before the cache markers in spirit too: the tool list
            # is part of the cached prefix, which is why it is chosen per
            # conversation, never per message (chat-plus-tools).
            params["tools"] = server_tool_params(
                tools, model, fetch_max_uses, fetch_max_content_tokens, search_max_uses
            )
        if cache_ttl is not None:
            marker: dict[str, str] = {"type": "ephemeral"}
            if cache_ttl == "1h":
                marker["ttl"] = "1h"
            params["system"] = [{"type": "text", "text": system, "cache_control": marker}]
            params["cache_control"] = dict(marker)
        return params

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamEvent]:
        """Stream one reply, following the server-side tool loop to its end
        (fix-real-web-search, platform.claude.com › server tools, checked
        2026-10-14).

        * **`pause_turn`** — the API paused a long tool turn. It is
          continued by sending the paused assistant content back unchanged
          with the same tools, at most `PAUSE_TURN_MAX_CONTINUATIONS` times;
          every request's usage is added up, so the ledger sees all of it.
        * **Every server-tool block** — `server_tool_use` (search, fetch,
          and the code-execution names) shows a status line; each
          `*_tool_result` ends it (an error result shows as an error); a
          search's results and a fetched page become sources, and a
          `citations_delta` marks a source as cited.
        * **Text after a tool** starts a new paragraph. A reply's text
          arrives in several blocks; consecutive text blocks (a citation
          splits a sentence into blocks) are joined as they are, but text
          that resumes after a tool call gets a blank line, so "찾아볼게요."
          and the answer that follows never run together.
        """
        import anthropic

        kwargs = self._client_kwargs()
        if self._async_http_client is not None:
            kwargs["http_client"] = self._async_http_client
        client = anthropic.AsyncAnthropic(**kwargs)

        params = self.request_params(
            request.system,
            request.messages,
            request.max_tokens,
            request.model,
            request.cache_ttl,
            request.tools,
            request.fetch_max_uses,
            request.fetch_max_content_tokens,
            request.show_thinking,
            request.search_max_uses,
        )
        messages = list(params["messages"])
        # Totals of the requests already finished (pause_turn continuations).
        done_in = done_out = done_written = done_read = done_searches = done_fetches = 0
        sources = SourceList()
        stop_reason = "end_turn"
        #: The type of the content block before the one now streaming —
        #: kept across continuations, which resume the same turn.
        previous_block = ""
        #: The text sent so far ends with a newline (or nothing was sent).
        text_ends_clean = True
        text_sent = False
        try:
            for _attempt in range(1 + PAUSE_TURN_MAX_CONTINUATIONS):
                input_tokens = output_tokens = written = read = 0
                searches = fetches = 0
                reported_fetches: int | None = None
                async with client.messages.stream(**params) as stream:
                    async for event in stream:
                        etype = event.type
                        if etype == "message_start":
                            usage = event.message.usage
                            input_tokens = usage.input_tokens or 0
                            written = getattr(usage, "cache_creation_input_tokens", None) or 0
                            read = getattr(usage, "cache_read_input_tokens", None) or 0
                            output_tokens = usage.output_tokens or 0
                        elif etype == "content_block_start":
                            block = event.content_block
                            btype = str(getattr(block, "type", ""))
                            if btype == "text":
                                if text_sent and previous_block not in ("", "text") and not text_ends_clean:
                                    yield TextDelta("\n\n")
                                    text_ends_clean = True
                            elif btype in ("server_tool_use", "tool_use"):
                                yield ToolStatus(tool_kind(getattr(block, "name", "")), "running")
                            elif btype.endswith("_tool_result"):
                                kind = tool_kind(btype)
                                content = getattr(block, "content", None)
                                if _is_error_result(content):
                                    yield ToolStatus(kind, "error")
                                else:
                                    if kind == "web_fetch":
                                        fetches += 1
                                    sources.add_result(content)
                                    # Result tokens are unknown mid-stream for
                                    # the real API — the final usage settles
                                    # the ledger.
                                    yield ToolStatus(kind, "done")
                            previous_block = btype or previous_block
                        elif etype == "content_block_delta":
                            delta = event.delta
                            dtype = getattr(delta, "type", "")
                            if dtype == "text_delta" and delta.text:
                                text_sent = True
                                text_ends_clean = delta.text.endswith("\n")
                                yield TextDelta(delta.text)
                            elif dtype == "thinking_delta" and getattr(delta, "thinking", ""):
                                # Summarized thinking (chat-thinking-view).
                                # Empty under display "omitted".
                                yield ThinkingDelta(delta.thinking)
                            elif dtype == "citations_delta":
                                citation = getattr(delta, "citation", None)
                                sources.cite(
                                    getattr(citation, "url", None) or "",
                                    getattr(citation, "title", None) or "",
                                )
                        elif etype == "message_delta":
                            usage = event.usage
                            if usage is not None:
                                if usage.output_tokens is not None:
                                    output_tokens = usage.output_tokens
                                if getattr(usage, "input_tokens", None) is not None:
                                    input_tokens = usage.input_tokens
                                if getattr(usage, "cache_creation_input_tokens", None) is not None:
                                    written = usage.cache_creation_input_tokens
                                if getattr(usage, "cache_read_input_tokens", None) is not None:
                                    read = usage.cache_read_input_tokens
                                server_use = getattr(usage, "server_tool_use", None)
                                requests = getattr(server_use, "web_search_requests", None)
                                if requests is not None:
                                    # Billed searches only — a failed search
                                    # is not counted and not charged.
                                    searches = requests
                                fetched = getattr(server_use, "web_fetch_requests", None)
                                if fetched is not None:
                                    reported_fetches = fetched
                            if event.delta.stop_reason:
                                stop_reason = event.delta.stop_reason
                        if etype not in ("message_start", "message_delta"):
                            continue
                        yield UsageUpdate(
                            done_in + input_tokens,
                            done_out + output_tokens,
                            done_written + written,
                            done_read + read,
                            done_searches + searches,
                            done_fetches + (reported_fetches if reported_fetches is not None else fetches),
                        )
                    final = await stream.get_final_message() if stop_reason == "pause_turn" else None

                done_in += input_tokens
                done_out += output_tokens
                done_written += written
                done_read += read
                done_searches += searches
                done_fetches += reported_fetches if reported_fetches is not None else fetches
                if stop_reason != "pause_turn" or final is None:
                    break
                # Continue the paused turn: the assistant content exactly as
                # it came (encrypted results, signatures and all), the same
                # tools, and what is left of this reply's output budget.
                remaining = request.max_tokens - done_out
                if remaining < 256:
                    stop_reason = "max_tokens"
                    break
                messages = messages + [
                    {
                        "role": "assistant",
                        "content": [
                            block.model_dump(mode="json", exclude_none=True)
                            for block in final.content
                        ],
                    }
                ]
                params = {**params, "messages": messages, "max_tokens": remaining}
            else:
                # Still paused after every continuation allowed: what was
                # said so far is the reply, marked like a cut-off one.
                if stop_reason == "pause_turn":
                    stop_reason = "max_tokens"
            if sources:
                yield ToolSources(sources.ordered())
        except anthropic.APIError as error:
            raise classify(error) from None
        yield StreamEnd(stop_reason)

    def rewrite_video_prompt(self, prompt: str, request: str, model: str = "") -> PromptRewrite:
        import anthropic

        kwargs = self._client_kwargs()
        if self._http_client is not None:
            kwargs["http_client"] = self._http_client
        client = anthropic.Anthropic(**kwargs)

        content = f"현재 프롬프트:\n{prompt.strip() or '(비어 있음)'}\n\n요청:\n{request.strip()}"
        try:
            message = client.messages.create(
                **self.request_params(
                    PROMPT_HELP_SYSTEM,
                    [{"role": "user", "content": content}],
                    min(self._settings.chat_max_output_tokens, 2048),
                    model,
                )
            )
        except anthropic.APIError as error:
            raise classify(error) from None

        text = "".join(block.text for block in message.content if block.type == "text")
        match = _PROMPT_TAG.search(text)
        revised = match.group(1).strip() if match else None
        reply = _PROMPT_TAG.sub("", text).strip() or "프롬프트를 살펴봤어요."
        return PromptRewrite(
            reply=reply,
            revised_prompt=revised or None,
            model=message.model or model or self.model_id,
            input_tokens=message.usage.input_tokens or 0,
            output_tokens=message.usage.output_tokens or 0,
            cache_write_tokens=getattr(message.usage, "cache_creation_input_tokens", None) or 0,
            cache_read_tokens=getattr(message.usage, "cache_read_input_tokens", None) or 0,
        )


    def generate_starter_app(
        self, name: str, idea: str, model: str = "", max_tokens: int = 8000
    ) -> StarterApp:
        """One request, structured JSON back (`STARTER_SCHEMA`). Not cached:
        each request is different, so a cache write would only cost more."""
        import json

        import anthropic

        kwargs = self._client_kwargs()
        kwargs["timeout"] = self._settings.builder_timeout_seconds
        if self._http_client is not None:
            kwargs["http_client"] = self._http_client
        client = anthropic.Anthropic(**kwargs)

        params = self.request_params(
            STARTER_SYSTEM,
            [{"role": "user", "content": starter_request_text(name, idea)}],
            max_tokens,
            model,
        )
        output_config = dict(params.get("output_config", {}))
        output_config["format"] = {"type": "json_schema", "schema": STARTER_SCHEMA}
        params["output_config"] = output_config
        try:
            message = client.messages.create(**params)
        except anthropic.APIError as error:
            raise classify(error) from None

        # What the provider billed, carried on a failure so the club's cost
        # is still recorded (cost-clarity) — the member is not charged.
        billed = (message.usage.input_tokens or 0, message.usage.output_tokens or 0)
        if message.stop_reason in ("max_tokens", "refusal"):
            # A cut-off JSON or a refusal has no app in it.
            raise ClaudeError(
                ProviderErrorKind.UNKNOWN, f"starter {message.stop_reason}", usage=billed
            )
        text = next((block.text for block in message.content if block.type == "text"), "")
        try:
            data = json.loads(text)
            files = [(str(item["path"]), str(item["content"])) for item in data["files"]]
            summary = str(data.get("summary", ""))
        except (ValueError, KeyError, TypeError):
            raise ClaudeError(ProviderErrorKind.UNKNOWN, "starter json", usage=billed) from None
        return StarterApp(
            summary=summary,
            files=files,
            model=message.model or model or self.model_id,
            input_tokens=message.usage.input_tokens or 0,
            output_tokens=message.usage.output_tokens or 0,
        )


    def edit_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        model: str = "",
        max_tokens: int = 16000,
        style: str = "",
    ) -> ProjectEdit:
        """Claude writes whole files through `write_file` (builder-static-runtime).

        Not streamed and not cached (each request carries different files).
        `tool_choice` stays `auto`: a forced tool choice cannot be combined
        with thinking, and the reply's text is the member's summary. Each
        round of calls is acknowledged with tool results so Claude can
        finish; the output budget is shared across rounds, and the usage of
        every round is added up — a failure carries it, so the club's cost
        is still recorded (cost-clarity).
        """
        import anthropic

        kwargs = self._client_kwargs()
        kwargs["timeout"] = self._settings.builder_timeout_seconds
        if self._http_client is not None:
            kwargs["http_client"] = self._http_client
        client = anthropic.Anthropic(**kwargs)

        messages: list[dict[str, Any]] = [
            {"role": "user", "content": edit_request_text(name, files, request, style)}
        ]
        writes: list[tuple[str, str]] = []
        texts: list[str] = []
        input_tokens = output_tokens = 0
        used_model = model or self.model_id
        for _round in range(EDIT_MAX_ROUNDS):
            remaining = max_tokens - output_tokens
            if remaining < 1024:
                raise ClaudeError(
                    ProviderErrorKind.UNKNOWN, "edit budget", usage=(input_tokens, output_tokens)
                )
            params = self.request_params(EDIT_SYSTEM, messages, remaining, model)
            params["tools"] = [WRITE_FILE_TOOL]
            params["tool_choice"] = {"type": "auto"}
            try:
                message = client.messages.create(**params)
            except anthropic.APIError as error:
                failure = classify(error)
                if input_tokens or output_tokens:
                    failure.usage = (input_tokens, output_tokens)
                raise failure from None
            input_tokens += message.usage.input_tokens or 0
            output_tokens += message.usage.output_tokens or 0
            used_model = message.model or used_model
            billed = (input_tokens, output_tokens)
            if message.stop_reason in ("max_tokens", "refusal"):
                # A file cut off half-way, or no answer: nothing usable.
                raise ClaudeError(
                    ProviderErrorKind.UNKNOWN, f"edit {message.stop_reason}", usage=billed
                )
            results: list[dict[str, Any]] = []
            for block in message.content:
                if block.type == "text" and block.text.strip():
                    texts.append(block.text.strip())
                elif block.type == "tool_use":
                    data = block.input if isinstance(block.input, dict) else {}
                    path, content = data.get("path"), data.get("content")
                    if block.name != "write_file" or not isinstance(path, str) or not isinstance(
                        content, str
                    ):
                        raise ClaudeError(ProviderErrorKind.UNKNOWN, "edit tool", usage=billed)
                    writes.append((path, content))
                    results.append(
                        {"type": "tool_result", "tool_use_id": block.id, "content": "저장했습니다."}
                    )
            if message.stop_reason != "tool_use" or not results:
                break
            messages.append(
                {
                    "role": "assistant",
                    # Every block as it came, thinking included: a reply that
                    # used tools must be sent back unchanged.
                    "content": [block.model_dump(exclude_none=True) for block in message.content],
                }
            )
            messages.append({"role": "user", "content": results})
        else:
            raise ClaudeError(
                ProviderErrorKind.UNKNOWN, "edit rounds", usage=(input_tokens, output_tokens)
            )

        return ProjectEdit(
            summary=texts[-1] if texts else "",
            writes=writes,
            model=used_model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )


class UnconfiguredClaudeProvider:
    """Selected as real, but missing its key or model.

    `app.main` refuses to start in that state; this exists so a test or a
    misconfigured process still fails safely, before anything is charged.
    """

    def __init__(self, settings: Settings) -> None:
        self.model_id = settings.anthropic_model.strip() or "unconfigured"

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamEvent]:
        raise ClaudeError(ProviderErrorKind.NOT_IMPLEMENTED, "credential not configured")
        yield  # pragma: no cover — makes this an async generator

    def rewrite_video_prompt(self, prompt: str, request: str, model: str = "") -> PromptRewrite:
        raise ClaudeError(ProviderErrorKind.NOT_IMPLEMENTED, "credential not configured")

    def generate_starter_app(
        self, name: str, idea: str, model: str = "", max_tokens: int = 8000
    ) -> StarterApp:
        raise ClaudeError(ProviderErrorKind.NOT_IMPLEMENTED, "credential not configured")


    def edit_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        model: str = "",
        max_tokens: int = 16000,
        style: str = "",
    ) -> ProjectEdit:
        raise ClaudeError(ProviderErrorKind.NOT_IMPLEMENTED, "credential not configured")


def get_claude_provider(settings: Settings) -> ClaudeProvider:
    if settings.provider_is_mock("claude"):
        return MockClaudeProvider(delay_ms=settings.chat_mock_delay_ms)
    if settings.missing_provider_settings():
        return UnconfiguredClaudeProvider(settings)
    return AnthropicClaudeProvider(settings)
