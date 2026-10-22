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
from app.services import app_fonts
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
    #: 생각 깊이 (quality-tuning Q1): the API effort the server chose for
    #: the member's level — None for a model without effort (or a caller
    #: that leaves it to `CHAT_EFFORT`).
    effort: str | None = None
    #: The provider timeout for this call (Admin › System, Q1). None: the
    #: client's default.
    timeout_seconds: float | None = None


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
    #: "end_turn", "max_tokens", "refusal", "pause_turn" (a tool loop that
    #: did not end within its continuations — cut, but not by length), …
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
    #: builder-file-continue: `write_project_file` only — the named file is
    #: not finished. Its entry in `writes` is everything written so far
    #: (the beginning it was given, plus the parts that arrived whole); the
    #: caller saves it and asks again from there.
    incomplete: bool = False
    #: …and the reply was cut at its output limit (rather than ending
    #: without finishing): a sign the call's room is too small.
    cut: bool = False


@dataclass(frozen=True)
class ProjectPlan:
    """만들 계획 (quality-tuning Q2): the files a generation will write, in
    order, each with one Korean sentence on what it is for. Checked by the
    caller before anything is written."""

    summary: str
    #: (path, purpose) in writing order.
    files: list[tuple[str, str]]
    model: str
    input_tokens: int
    output_tokens: int
    #: builder-answer-only: "change" or "question". A question carries
    #: `answer`, and `files` is the change Claude suggests (may be empty).
    kind: str = "change"
    answer: str = ""


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
        self, name: str, idea: str, model: str = "", max_tokens: int = 8000, effort: str | None = None
    ) -> StarterApp: ...

    def edit_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        model: str = "",
        max_tokens: int = 16000,
        style: str = "",
        effort: str | None = None,
    ) -> ProjectEdit: ...

    # quality-tuning Q2: generation in stages — a plan, one call per file,
    # a self-check. Each is its own call, timed out and charged on its own.
    def plan_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        model: str = "",
        max_tokens: int = 4096,
        style: str = "",
        effort: str | None = None,
        images: list[dict] | None = None,
        notes: str = "",
    ) -> ProjectPlan: ...

    def write_project_file(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        plan: list[tuple[str, str]],
        path: str,
        model: str = "",
        max_tokens: int = 16000,
        style: str = "",
        effort: str | None = None,
        images: list[dict] | None = None,
        notes: str = "",
        so_far: str = "",
    ) -> ProjectEdit: ...

    def check_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        model: str = "",
        max_tokens: int = 16000,
        effort: str | None = None,
        notes: str = "",
    ) -> ProjectEdit: ...


# -------------------------------------------------------------- the prompt

CHAT_SYSTEM_PROMPT = """\
You are the assistant inside CTRL+AI, a club where beginners make apps and \
short videos with AI. Most members cannot code and have never used an API.

How to answer:
- Always answer in Korean, whatever language the member writes in.
- Answer completely, with the depth the question needs. Small talk and \
quick facts get a short, friendly answer. How-to, comparison, study and \
planning questions get a thorough one: the reasoning, concrete examples, \
numbered steps the member can follow, and code where it helps — do not \
stop at an outline or leave steps "for later".
- Explain as to a beginner: everyday words, short paragraphs; when a \
technical term is unavoidable, say in one phrase what it means. Be warm and \
practical.
- If your previous turn was cut off by the length limit and the member's \
message starts with [이어서], continue exactly where the text stopped — no \
greeting, no recap, no restarting a code block or a list — as if the two \
parts were one reply. Never start over.
- The screen renders Markdown. When the member asks to compare or organise things, use a table. Put code in a fenced block with its language. Name a file after the language: ```csv a.csv. Keep headings to a minimum; short paragraphs and "-" lists read best. Never write raw HTML outside a code block.
- The screen can preview one fenced `html` or `svg` block in a safe sandbox. For a web page, a small tool or game, a chart or a drawing, write exactly one self-contained ```html block: inline CSS and JavaScript. It may load libraries from cdn.jsdelivr.net or cdnjs.cloudflare.com (an exact version, e.g. Chart.js for a chart, MapLibre GL JS with the OpenFreeMap style for a map) and data or images from https services that need no key — never http, never a key in the code, never an image address written from memory. Make the page complete and polished — every button works — rather than a bare sketch.

When a tool is available (web search, page reading, code execution):
- Use it without announcing it — no "검색해 볼게요" or step-by-step narration.
- After searching or reading, always answer the question with what you found and name the sources you used. If the results are thin, say what you found and what is still uncertain; never end without an answer.
- Never describe tool internals to the member: no JSON, parsing, result formats, retries, usage limits or error codes. If a tool failed, say in one plain sentence that you could not look it up and answer from what you know.

What CTRL+AI offers, to mention when it genuinely helps the member:
- Project Builder: start an app or website project by describing it in Korean. The button below your reply makes a small, working example app from the member's idea that they can try at once and change later — say so when you offer it. Builder apps run in the visitor's browser, and through the CTRL+AI 기능 상자 they can also sign CTRL+AI members in, keep shared data (a board, a poll, a ranking — seen by everyone) and use Claude inside the app (paid by the visitor who uses it, from their own 동아리 지원). So logins, shared boards and data across members are possible; only members of CTRL+AI can sign in to an app. The Builder's start screen also offers four templates: AI 챗봇, 투표·설문, 랭킹 게임, 동아리 게시판.
- Video Generator: make a short video from a description.
- CtrlAIApps: apps other members made. CtrlAITube: their videos.
- Usage: how much of this quarter's budget is left.
- Profile: quarter participation and connected accounts.

Action buttons. When — and only when — the member wants to build an app, \
website, game or tool, end your reply with this exact line on its own:
[[action:builder|NAME]]
When they want to make a video, end with:
[[action:video|NAME]]
For a picture: [[action:image|ENGLISH DESCRIPTION]] (one line, max 300 chars, no [])
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

#: What a member app can do through the CTRL+AI 기능 상자 (app-platform P4),
#: and the rules for using it — one block, shared by every Builder prompt
#: so the starter, the editor and the staged pipeline agree. Kept short:
#: it is sent with every generation (cached, prompt-caching).
_SDK_RULES = """\
- CTRL+AI 기능 상자 — `window.ctrlai`, which CTRL+AI adds to every page \
itself (never add a script tag for it). Every call returns a Promise. Use \
only what the idea needs:
  · `ctrlai.storage.get(key)` (null when empty) / `.set(key, value)` (any \
JSON value) / `.remove(key)`: per app, per visitor, this browser only, \
about 1 MB, works signed out. For settings, drafts and one person's own \
data. Load saved data first, then draw the first screen.
  · `ctrlai.user()` → `{displayName, appUserId}`, or null when signed out. \
`ctrlai.login()` opens CTRL+AI's sign-in and consent window. Only \
CTRL+AI members can sign in.
  · `ctrlai.ai.ask({prompt, system?, json?, images?, model?})` → \
`{text, json, chargedKrw}` and `ctrlai.ai.stream(options, chunk => …)` → \
`{text, chargedKrw}`: Claude, paid by the VISITOR from their own 동아리 \
지원 — a short call is about 10원 on model "fast" (default) and about 30원 \
on "smart"; the server caps one call at 1,000원. `json` is a JSON Schema: the \
answer comes back parsed in `json`. `images` are data URLs (≤ 5 MB each) \
for photos the visitor picked. Needs sign-in: the SDK asks the visitor to \
sign in on the first call; signed out it fails with `error.code === \
"login_required"`.
  · `ctrlai.db` — the app's own database on CTRL+AI's server: named lists \
of JSON objects (≤ 4 KB each). A **private** list (the default): each \
signed-in visitor sees only their own items. A **shared** list \
(`{shared: true}` on every call): everyone reads, signed-out visitors too; \
signed-in members write; each item carries `author.displayName`. \
`save(list, data, {shared})` → item; `list(list, {shared, where: {field: \
value}, orderBy, order, limit ≤ 100, cursor, mine})` → `{items, nextCursor}`; \
`get(list, id, {shared})`; `update(list, id, changes, {shared})`; \
`remove(list, id, {shared})`; `count(list, {shared, where, mine})`; \
`report(list, id, reason)` for a shared item. An item is `{id, data, \
createdAt, updatedAt, mine, canDelete, author}`. Writes need sign-in \
(the SDK asks).
  · Every `ctrlai.db` list the app uses MUST be declared in `ctrlai.json` \
at the project root, exactly like this: {"db": [{"name": "posts", \
"shared": true}, {"name": "notes"}]} (no "shared" = private). A list \
that is not in that file does not exist for visitors. Write this file \
whenever the app uses `ctrlai.db`.
- Using the 기능 상자 well:
  · Call `ctrlai.ai` only from a button the visitor presses — never on \
page load, never in a loop. Beside that button show "1회 약 N원 · 최대 \
M원", with N and M from `ctrlai.ai.estimate(sameOptions)` → \
`{typicalKrw, maxKrw}` (free, works signed out, call it when the screen \
draws; pass `images` as a count when the photo is not picked yet) — or, \
without it, about 10 for "fast" and 30 for "smart", 최대 1,000원. A call \
with the same options never costs more than maxKrw. After the call show \
the real `chargedKrw`. Keep prompts short; use \
`json` with a schema when the app needs structured data; an answer is \
at most `maxTokens` long (1,024 by default, 4,096 with `json`, up to \
8,192) — for a long list or long text pass a bigger `maxTokens` (about \
150 per item in Korean), or ask for fewer items, and handle \
`error.code === "too_long"` (the answer was cut); for facts Claude may
not remember (new films, prices, recent events) pass `webSearch: true`:
Claude searches the web (at most 3 searches, about 15원 each plus their
results, all inside the 1,000원 cap — `estimate` includes it), so use it
only on the button that needs fresh facts; say in Korean \
when a call fails.
  · Every AI feature also has a **demo answer**: a fixed sample, clearly \
marked "데모", shown when the AI cannot be called — outside CTRL+AI \
(`window.ctrlai` missing: there is no switch, so the AI buttons stay and \
give the sample), or when a call fails with code "demo" (nothing is \
charged) or "login_required" (then also "CTRL+AI 회원만 쓸 수 있어요" and a \
로그인 button that calls `ctrlai.login()`). While CTRL+AI's switch is off \
(`ctrlai.ai.mode()` → "demo"; the maker's 데모만 too) the AI buttons are \
**hidden**, with one line saying "위쪽 CTRL+AI 줄의 스위치를 켜면 …"; \
`ctrlai.ai.mode()` → "live" | "demo" tells which it is now, and the \
window event "ctrlai:ai-mode" fires when the visitor flips the switch. \
The screen must always show what the feature would do.
  · **One AI switch, and it is not yours**: CTRL+AI shows a bar above the \
app with the visitor's 실제 AI switch and its state. Never build an AI \
on/off control of your own — no "실제 AI 켜기" / "데모로 보기" button, no \
app-wide "실제 AI · 내 지원금에서" badge, no mode remembered in storage. \
Set the app's live flag from `ctrlai.ai.mode()` at start and from every \
"ctrlai:ai-mode" event (both directions); label each AI result \
("실제 AI · N원" or "데모"), and in 데모 say "위쪽 CTRL+AI 줄의 스위치를 \
켜면 Claude가 …". A "데모 데이터" badge may show only when `window.ctrlai` \
is missing (outside CTRL+AI, where there is no bar).
  · **Free first; AI is its own button**: an action that can work without \
AI (search a built-in list, plan by rules, quote a document, open a blank \
form) always does it for free, with the switch on or off — the switch \
never turns a free button into a paid one. Where AI can do better, add a \
separate button beside it or on its result, its price on it ("✦ AI로 더 \
찾기 · 약 10원"), and call `ctrlai.ai` only from that button. Switch off \
(데모): the AI buttons are hidden and the app says the switch above brings \
them; everything else in the app still works with the visitor's own input.
  · Signed-out visitors can use everything that needs no sign-in: reading \
shared lists, playing, `ctrlai.storage`. Ask for sign-in only when a call \
needs it.
  · Shared data belongs to many people: show `author.displayName`, let the \
author change or delete their item (`item.mine`), show 삭제 when \
`item.canDelete`, offer 신고 (`ctrlai.db.report`) on shared items, and \
escape every text before putting it into HTML.
  · When `window.ctrlai` is missing (the files opened outside CTRL+AI), \
the page still opens: storage falls back to localStorage, exactly like \
this: const store = window.ctrlai && window.ctrlai.connected ? \
ctrlai.storage : { get: async (k) => JSON.parse(localStorage.getItem(k) \
|| "null"), set: async (k, v) => localStorage.setItem(k, JSON.stringify(v)) }; \
lists read as empty, the visitor counts as signed out, AI shows the demo.
"""

#: The Korean fonts CTRL+AI serves to member apps (feat-app-fonts). Built
#: from the catalogue, so a font added there reaches every prompt.
_FONT_RULES = (
    """\
- 글씨체 (fonts) — CTRL+AI serves these Korean fonts to every app; use \
them by name in CSS, nothing to link or download (CTRL+AI adds the font \
file itself, and the font-face rules are not yours to write): """
    + app_fonts.prompt_list()
    + """. Write e.g. font-family: "Jua", "Apple SD Gothic Neo", \
"Malgun Gothic", sans-serif — always keep the system fonts after the name \
as a fallback, and use the name exactly as listed, in quotes. Pick one for \
headings and one for body text at most; Pretendard is a good body font, \
and a bold or rounded one suits a title. Use the weights the app needs \
(400 and 700 exist for most; Pretendard, Noto Sans KR, Noto Serif KR and \
Hahmlet are variable). Use these, not outside web fonts.
"""
)
_SDK_RULES += _FONT_RULES

#: Outside services (app-open-services, owner 2026-10-22): an app may load
#: from any https address. The rules steer Claude to free, keyless ones and
#: away from the two mistakes that break apps — a key in the code, and an
#: address written from memory.
_OUTSIDE_RULES = """\
- Outside services: the app may load scripts, styles, images, fonts and \
data from any https address (never http). Prefer free services that need \
no key and no sign-up: maps — MapLibre GL JS \
(https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js and \
its .css) with the OpenFreeMap style \
https://tiles.openfreemap.org/styles/liberty, showing "© OpenStreetMap \
contributors"; libraries for games, charts, 3D or sound (Phaser, Chart.js, \
Three.js, Tone.js, p5.js …) from cdn.jsdelivr.net or cdnjs.cloudflare.com \
with an exact version; weather — api.open-meteo.com; currency rates — \
api.frankfurter.app; photos — Wikimedia Commons, searched while the app \
runs (https://commons.wikimedia.org/w/api.php with origin=*), showing the \
author and licence.
- Never put an API key, token or password in the code: anyone can read an \
app's files. If an idea needs a service with a key, say so in the summary \
and use a keyless one or the demo instead.
- Never write a photo, file or API address from memory — remembered \
addresses are usually wrong. Use the services above, find images while the \
app runs, or draw with inline SVG or CSS.
- An outside service can be slow or down: show a short Korean message and \
keep the rest of the app working. Send what a visitor types only to the \
service the feature needs, never anywhere else.
"""

STARTER_SYSTEM = (
    """\
You build small starter web apps for CTRL+AI, a Korean club where \
beginners make apps with AI. Most members cannot code. Build a first, \
working version of the app the member describes, so they can see it run \
and then ask for changes.

Rules:
- Static files only: index.html, style.css and app.js (at most two more \
.js or .css files if really needed, plus ctrlai.json when the app uses \
ctrlai.db). Plain HTML, CSS and browser JavaScript — no frameworks, no \
build step, no server code.
"""
    + _SDK_RULES
    + _OUTSIDE_RULES
    + """\
- index.html links its files exactly like this: \
<link rel="stylesheet" href="style.css"> and <script src="app.js"></script>.
- Everything the member sees is in Korean. Short Korean comments in the \
code, so a beginner can follow it.
- As complete as the idea needs: usually 300–1,200 lines across the \
files. Every button works; no placeholders, no "준비 중" stubs, no \
lorem ipsum. The layout fits a phone and a laptop.
- Give each app its own look that fits the idea and the requested style \
(colours, type, layout, mood) — not a default white card. Fonts: the \
글씨체 list above, then local stacks (system-ui, "Apple SD Gothic Neo", \
"Malgun Gothic", serif, monospace, cursive); no other web fonts. \
Keep text readable (contrast).
- Never use alert(), confirm() or prompt(): the preview blocks them. Show messages on the page, and ask "정말 지울까요?" with a second tap instead.
- An app runs in the visitor's browser. What it keeps in ctrlai.storage \
stays on that visitor's device and is never shared with others; what it \
keeps in a shared ctrlai.db list is seen by everyone. Say in the summary \
which the app uses, and when a feature needs sign-in or costs the visitor \
money.

Return JSON only: "summary" is two short Korean sentences — what the app \
does, and one change the member could ask for next. "files" lists every \
file with its path and full content.
"""
)

#: The JSON the starter app comes back as (structured outputs).
STARTER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["change", "question"]},
        "answer": {"type": "string"},
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


EDIT_SYSTEM = (
    """\
You build and change small web apps for CTRL+AI, a Korean club where \
beginners make apps with AI. Most members cannot code. The member tells \
you, in Korean, what to make or change; the project's current files \
follow their request.

Rules:
- Static files only: HTML, CSS and browser JavaScript (.html .css .js \
.json .svg .md .txt). No frameworks, no build step, no TypeScript, no \
server code of any kind — it will be refused. index.html is the entry.
"""
    + _SDK_RULES
    + _OUTSIDE_RULES
    + """\
- An app that still uses localStorage directly keeps working; when you \
touch its saving code anyway, move it to the store above.
- Change only what the request needs. Keep everything else as it is.
- A new app is as complete as the idea needs: usually 300–1,200 lines \
across the files. Every button works; no placeholders, no "준비 중" \
stubs, no lorem ipsum.
- To create or change a file, call write_file with its path and its \
complete new content — never a fragment or a diff. Call it once per file, \
all in this one reply. Do not call it for files that stay the same.
- Everything the member sees is in Korean, with short Korean comments in \
the code. The layout fits a phone and a laptop.
- At most 30 files, 200 KB each.
- Give each app its own look that fits the idea and the requested style \
(colours, type, layout, mood) — not a default white card. Fonts: the \
글씨체 list above, then local stacks (system-ui, "Apple SD Gothic Neo", \
"Malgun Gothic", serif, monospace, cursive); no other web fonts. \
Keep text readable (contrast).
- Never use alert(), confirm() or prompt(): the preview blocks them. Show messages on the page, and ask "정말 지울까요?" with a second tap instead.
- An app runs in the visitor's browser. What it keeps in ctrlai.storage \
stays on that visitor's device and is never shared with others; what it \
keeps in a shared ctrlai.db list is seen by everyone. Say in the reply \
which the app uses, and when a feature needs sign-in or costs the visitor \
money.
- When asked to change the design ("디자인 바꿔 줘"), change the look only: \
keep every element id, every class the JavaScript uses, and all behaviour.

After the tool calls, reply in Korean in one or two short sentences: what \
you changed, and one thing the member could ask for next.
"""
)

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

#: builder-file-continue: a staged file is written in parts, each its own
#: call, so a reply cut off at its output limit keeps every part that
#: arrived whole and the next call carries on after them.
WRITE_PART_TOOL: dict[str, Any] = {
    "name": "write_file_part",
    "description": (
        "Write the next part of one file. Parts are joined exactly as given, "
        "in order. Set done to true on the file's last part."
    ),
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Relative path, e.g. index.html or js/app.js"},
            "content": {"type": "string", "description": "The next part of the file"},
            "done": {"type": "boolean", "description": "True when this is the last part"},
        },
        "required": ["path", "content", "done"],
        "additionalProperties": False,
    },
}

def _part_path(raw: str) -> str:
    """`./app.js` and `/app.js` are app.js — the caller checks paths fully."""
    path = raw.strip()
    while path.startswith(("./", "/")):
        path = path[2:] if path.startswith("./") else path[1:]
    return path

#: Rounds of tool use one generation may take. Claude is asked to write
#: every file in one reply; a second round only happens when it stops to
#: wait for the result of the first call.
EDIT_MAX_ROUNDS = 4


#: builder-images (1): put before the request text when the member attached
#: reference pictures. They guide the look; they are not files of the app.
REFERENCE_NOTE = (
    "The member attached reference picture(s) above, for the look they want. "
    "Follow their design — colours, layout, type, spacing, mood — as far as it "
    "fits the request. Do not embed, link or recreate the pictures as files: "
    "they are not part of the app."
)


def content_tokens(content: str | list[dict]) -> int:
    """The estimate for a user message's content, pictures included — the
    attachments module's, imported late (it imports pricing)."""
    from app.services.attachments import content_tokens as estimate

    return estimate(content)


def with_images(text: str, images: list[dict] | None) -> str | list[dict]:
    """A user message's content: the text alone, or the pictures first and
    the note plus the text after them."""
    if not images:
        return text
    return [*images, {"type": "text", "text": REFERENCE_NOTE + "\n\n" + text}]


def edit_request_text(
    name: str, files: list[tuple[str, str]], request: str, style: str = "", notes: str = ""
) -> str:
    """The member's request (and chosen style), then every current file,
    whole; `notes` (builder-images (2): the app's pictures) at the end."""
    parts = [f"프로젝트 이름: {name.strip()}", "", "요청:", request.strip(), ""]
    if style.strip():
        parts += ["원하는 스타일:", style.strip(), ""]
    if files:
        parts.append("현재 파일:")
        for path, content in files:
            parts.append(f'<file path="{path}">\n{content}\n</file>')
    else:
        parts.append("현재 파일: 없음 (새로 만듭니다)")
    if notes.strip():
        parts += ["", notes.strip()]
    return "\n".join(parts)


# ------------------------------------------------- staged generation (Q2)

#: The rules every staged call shares — the same as EDIT_SYSTEM's.
_APP_RULES = (
    """\
- Static files only: HTML, CSS and browser JavaScript (.html .css .js \
.json .svg .md .txt). No frameworks, no build step, no TypeScript, no \
server code of any kind — it will be refused. index.html is the entry and \
links its files with relative paths (<link rel="stylesheet" \
href="style.css">, <script src="app.js"></script>).
"""
    + _SDK_RULES
    + _OUTSIDE_RULES
    + """\
- Everything the member sees is in Korean, with short Korean comments in \
the code. The layout fits a phone and a laptop.
- As complete as the idea needs: usually 300–1,200 lines across the \
files. Every button works; no placeholders, no "준비 중" stubs, no lorem \
ipsum.
- Give each app its own look that fits the idea and the requested style \
(colours, type, layout, mood) — not a default white card. Fonts: the \
글씨체 list above, then local stacks (system-ui, "Apple SD Gothic Neo", \
"Malgun Gothic", serif, monospace, cursive); no other web fonts. \
Keep text readable (contrast).
- Never use alert(), confirm() or prompt(): the preview blocks them. Show \
messages on the page, and ask "정말 지울까요?" with a second tap instead.
- An app runs in the visitor's browser. ctrlai.storage stays on that \
visitor's device; a shared ctrlai.db list is seen by everyone.
- At most 30 files, 200 KB each.
"""
)

PLAN_SYSTEM = (
    """\
You plan a web app for CTRL+AI, a Korean club where beginners make apps \
with AI. Most members cannot code. The member says, in Korean, what to \
make or change; the project's current files follow. Do not write code \
now: decide which files to create or change, in the order they should be \
written, and say in one short Korean sentence what each one is for.

- A new app needs index.html. Usually index.html, style.css and app.js; \
more .js, .css or .json files only when the app is big enough to need \
them (at most 12 files). When the app will use ctrlai.db, list \
ctrlai.json too (its purpose: the app's lists).
- A change lists only the files that must change or be added — as few as \
possible.
- "summary" is one or two short Korean sentences: what will be built or \
changed.
- First decide "kind". "question" when the member asks something (how the \
app works, where something is, why, what is possible) or says not to \
build or change anything yet ("빌드하지 말고", "답만") — and also when you \
cannot tell whether they want a change. A report of a problem that does \
not say to fix it ("AI 호출이 실패하고 있음", "버튼이 안 눌려") is a \
question too: the answer explains the likely cause, and "files" is the \
fix. A polite request ("글씨 크게 해 줄래?", "추가해 줄 수 있어?") is a \
change, not a question. Then "answer" is your reply in \
Korean for a beginner: short paragraphs, everyday words, concrete about \
this app's files, without code. "files" is then \
the change you would suggest, only when one would clearly help (the \
member applies it with one button), else empty; "summary" says what \
that change would do. "change" when the member asks to make, add, fix or \
change something: "answer" is "". When the project has no index.html \
yet, "kind" is always "change".
- When the files include SPEC.md, it holds what the member asked for and \
decided in Chat (features, data, look): keep to it, and continue from the \
existing index.html's look rather than starting over. SPEC.md, README.md, \
CLAUDE.md, HANDOFF_PROMPT.md and HISTORY.md are guides, never part of the \
app: do not list them.

The app must follow these rules:
"""
    + _APP_RULES
    + """
Return JSON only."""
)

#: The plan comes back as JSON (structured outputs).
PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["change", "question"]},
        "answer": {"type": "string"},
        "summary": {"type": "string"},
        "files": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "purpose": {"type": "string"},
                },
                "required": ["path", "purpose"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["kind", "answer", "summary", "files"],
    "additionalProperties": False,
}

FILE_SYSTEM = (
    """\
You write one file of a web app for CTRL+AI, a Korean club where \
beginners make apps with AI. The member's request, the plan (every file \
and what it is for) and the files written so far follow. Write ONLY the \
file named at the end, in parts: call write_file_part with its path, \
the next part of its content (at most about 4,000 characters, ending at \
a line break) and done false — several calls in one reply, without \
waiting — and done true on the last part. The parts are joined exactly \
as given, so the whole file is complete — never a diff. When the request \
shows the file's beginning as already written, write only what comes \
after it, starting exactly where it stops. The other files are \
written in their own steps, so use exactly the ids, classes, function \
names and paths the plan and the files so far imply, so the parts fit \
together. When the file already exists, keep everything the request does \
not ask to change.

Rules:
"""
    + _APP_RULES
    + """
After the last part, reply with one short Korean sentence about the file."""
)

CHECK_SYSTEM = (
    """\
You check a finished web app for CTRL+AI before the member sees it. Look \
for: a script, stylesheet or link to a file that does not exist; \
getElementById or querySelector for an id or class the HTML does not \
have; a function called but never defined; JavaScript syntax errors; \
buttons that do nothing; alert(), confirm() or prompt(); external URLs; \
a ctrlai.db list name used in the code that ctrlai.json does not declare \
(or no ctrlai.json at all), or a `shared` that differs between the code \
and the file; ctrlai.ai called on page load; an AI feature with no demo \
path for signed-out visitors.

If you find problems, fix them: call write_file with the complete \
corrected file — only files that need a fix, at most 3. Change nothing \
else. If everything is fine, call nothing.

Rules:
"""
    + _APP_RULES
    + """
Then reply in Korean with one short sentence: what you fixed, or \
"점검했어요 — 고칠 곳이 없어요."."""
)

#: How many files one self-check may rewrite.
CHECK_MAX_FIXES = 3


def file_request_text(
    name: str,
    files: list[tuple[str, str]],
    request: str,
    plan: list[tuple[str, str]],
    path: str,
    style: str = "",
    notes: str = "",
    so_far: str = "",
) -> str:
    """The request, the plan, the files so far, and the one file to write —
    with its beginning when an earlier call was cut off (builder-file-continue)."""
    parts = [f"프로젝트 이름: {name.strip()}", "", "요청:", request.strip(), ""]
    if style.strip():
        parts += ["원하는 스타일:", style.strip(), ""]
    parts.append("계획:")
    parts += [f"- {item_path}: {purpose}" for item_path, purpose in plan]
    parts.append("")
    if files:
        parts.append("지금까지의 파일:")
        for file_path, content in files:
            parts.append(f'<file path="{file_path}">\n{content}\n</file>')
    else:
        parts.append("지금까지의 파일: 없음")
    if notes.strip():
        parts += ["", notes.strip()]
    parts += ["", f"지금 쓸 파일: {path}"]
    if so_far:
        parts += [
            "",
            "이 파일은 앞부분까지 이미 썼어요. 아래 글자 바로 뒤부터 이어서 쓰세요 (같은 내용을 다시 쓰지 마세요):",
            f'<written path="{path}">\n{so_far}</written>',
        ]
    return "\n".join(parts)


def check_request_text(name: str, files: list[tuple[str, str]], notes: str = "") -> str:
    parts = [f"프로젝트 이름: {name.strip()}", "", "파일:"]
    for file_path, content in files:
        parts.append(f'<file path="{file_path}">\n{content}\n</file>')
    if notes.strip():
        parts += ["", notes.strip()]
    return "\n".join(parts)


#: Mock only: `[mock-error-file:<path>]` in a request makes writing that
#: file fail (a timeout), so a partial generation and 이어서 만들기 can be
#: seen and tested with no key.
MOCK_ERROR_FILE = re.compile(r"\[mock-error-file:([\w./-]+)\]")
#: Mock only: a file containing this text is "fixed" by the self-check.
MOCK_CHECK_FIX = "MOCK_CHECK_FIX"
#: Mock only (app-platform P4): `MOCK_MANIFEST` in a request makes the
#: file stage write ctrlai.json beside app.js; `MOCK_CHECK_MANIFEST` in a
#: file makes the check stage add a missing ctrlai.json.
#: builder-file-continue (mock): a file cut before any part, and one cut
#: half-way through on its first call.
MOCK_STUCK_FILE = re.compile(r"\[mock-stuck-file:([^\]]+)\]")
MOCK_LONG_FILE = re.compile(r"\[mock-long-file:([^\]]+)\]")
MOCK_LONG_CONTENT = "".join(f"// 긴 파일 {line}번째 줄\n" for line in range(1, 201))
MOCK_MANIFEST = "MOCK_MANIFEST"
MOCK_CHECK_MANIFEST = "MOCK_CHECK_MANIFEST"
MOCK_MANIFEST_JSON = '{"db": [{"name": "posts", "shared": true}]}\n'
#: builder-answer-only (mock): a request that reads as a question rather
#: than a change, and one that also asks for a change to suggest.
_MOCK_QUESTION = re.compile(r"[?？]|답만|빌드\s*하지\s*말|만들지\s*말|고치지\s*말|바꾸지\s*말|설명해")
_MOCK_SUGGEST = re.compile(r"바꾸|바꿔|추가|넣어|고쳐|만들")
#: …but a polite request ("해 줄래?") is a change, as the real prompt says.
_MOCK_POLITE = re.compile(r"(줄래|줄 수 있어|주실래|주세요)\s*[?？]")

#: What the mock says each starter file is for.
_MOCK_PURPOSES = {
    "index.html": "화면의 뼈대와 글을 담아요.",
    "style.css": "색과 글꼴, 배치를 정해요.",
    "app.js": "버튼과 저장 같은 동작을 맡아요.",
}


# ------------------------------------------------------------------- mock

#: Put `[mock-error:<kind>]` in a message to make the mock fail that way —
#: so the Korean error messages can be seen, and tested, with no key.
#: Mock only: the real provider sends the text to Claude like any other.
MOCK_ERROR = re.compile(r"\[mock-error:(\w+)\]")
MOCK_REFUSAL = "[mock-refusal]"
#: `[mock-slow:N]` — the mock says nothing for N seconds (at most 600)
#: before replying, like a long think. quality-tuning Q1 uses it to prove a
#: long reply survives every proxy on the way (keepalives every 10 s).
MOCK_SLOW = re.compile(r"\[mock-slow:(\d+)\]")
#: `[mock-long:N]` — a reply of about N characters: one ```html block of
#: numbered lines (feat-auto-continue: long enough to stop at `max_tokens`
#: two or three times and still be one page when joined).
MOCK_LONG = re.compile(r"\[mock-long:(\d+)\]")
#: How a continuation request begins (`chat.CONTINUE_PROMPT`); the mock
#: answers it with the rest of the reply it cut off.
MOCK_CONTINUE_PREFIX = "[이어서]"


def mock_long_reply(length: int) -> str:
    """A self-contained ```html block of at least `length` characters."""
    head = "```html\n<!doctype html>\n<html lang=\"ko\"><body>\n<h1>긴 답장</h1>\n"
    tail = "</body></html>\n```"
    lines = []
    n = 1
    while len(head) + sum(len(line) for line in lines) + len(tail) < length:
        lines.append(f"<p>줄 {n}: 이 줄은 긴 답장을 만들기 위한 문장이에요.</p>\n")
        n += 1
    return head + "".join(lines) + tail

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
        # A picture — unless the member is asking for an app that draws.
        re.compile(r"^(?!.*(앱|어플|프로그램|사이트|웹|게임|도구)).*(사진|이미지|그림|그려|일러스트|포스터|캐릭터|배경화면)", re.DOTALL),
        "좋아요, 그림으로 만들어 볼게요! 아래 카드에서 설명을 확인하고 크기와 비율을 고른 뒤 "
        "만들기를 누르면 이 대화에 그림이 붙어요.",
        "image",
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
        # feat-auto-continue: a continuation request carries the cut-off
        # partial as the assistant turn before it; the mock answers with
        # the rest of the reply it would have given the turn before that —
        # so everything below (files, tools, rules) reads that turn.
        continued_from: str | None = None
        if last.startswith(MOCK_CONTINUE_PREFIX) and len(request.messages) >= 3:
            continued_from = _text_of(request.messages[-2]["content"])
            newest = request.messages[-3]["content"]
            whole = _text_of(newest)
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

        slow = MOCK_SLOW.search(last)
        if slow:
            await asyncio.sleep(min(int(slow.group(1)), 600))

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
        long = MOCK_LONG.search(last)
        if long:
            reply = mock_long_reply(min(int(long.group(1)), 200_000))
        elif tool_reply is not None:
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
            elif "PROJECT_NAME" in request.system:
                # chat-to-builder-carry: a name from the first request.
                found = re.search(r"첫 요청: (.+)", whole)
                asked = (found.group(1).strip() if found else "") or "채팅에서 만든 앱"
                reply = json.dumps({"name": asked[:16]}, ensure_ascii=False)
            elif "PUBLISH_SUMMARY" in request.system:
                # publish-summary: a deterministic blurb from the project's name,
                # and a note only when changes were listed.
                found = re.search(r"프로젝트 이름: (.+)", whole)
                name = found.group(1).strip() if found else "내 앱"
                changed = "이후 바뀐 것:" in whole
                reply = json.dumps(
                    {"description": f"'{name}'은 쉽게 써 볼 수 있는 작은 앱이에요. 필요한 것을 적고 바로 확인해요.",
                     "note": "최근 요청대로 기능과 모양을 다듬었어요" if changed else ""},
                    ensure_ascii=False,
                )
            else:
                from app.services.app_ai import sample_for

                reply = json.dumps(sample_for(schema), ensure_ascii=False)
            action = None
        if action == "image":
            # The real model writes an English description; the mock keeps
            # the member's words, made safe for the marker.
            described = " ".join(re.sub(r"[\[\]]", " ", last).split())[:400]
            reply = f"{reply}\n[[action:image|A friendly illustration of: {described}]]"
        elif action:
            reply = f"{reply}\n[[action:{action}|{short_title(last)}]]"
        if continued_from is not None:
            # The rest, from where the previous call stopped (the real model
            # is asked to do the same; the mock does it exactly).
            reply = reply[len(continued_from):] if reply.startswith(continued_from) else reply

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
        self, name: str, idea: str, model: str = "", max_tokens: int = 8000, effort: str | None = None
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
        effort: str | None = None,
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

    # ---------------------------------------- staged generation (Q2), mock

    def plan_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        model: str = "",
        max_tokens: int = 4096,
        style: str = "",
        effort: str | None = None,
        images: list[dict] | None = None,
        notes: str = "",
    ) -> ProjectPlan:
        """The files the one-shot mock would write, each with a purpose.

        builder-answer-only: a request that reads as a question (a "?", or
        "답만" / "빌드하지 말고" …) on an app that exists is answered; it
        suggests the edit's files only when it also asks for a change."""
        edit = self.edit_project(name, files, request, model, 16000, style)
        planned = [(path, _MOCK_PURPOSES.get(path, "앱의 한 부분이에요.")) for path, _ in edit.writes]
        kind, answer = "change", ""
        if "index.html" not in dict(files):
            summary = f"'{name.strip() or '내 앱'}'을(를) 파일 {len(planned)}개로 만들어요."
        elif _MOCK_QUESTION.search(request) and not _MOCK_POLITE.search(request):
            kind = "question"
            names = ", ".join(path for path, _ in files)
            answer = (
                f"지금 앱은 파일 {len(files)}개({names})로 되어 있어요. "
                "질문은 실제 Claude가 이 파일들을 읽고 답해 드려요."
            )
            if _MOCK_SUGGEST.search(request):
                answer += " 아래 바꿀 계획을 적용하면 바로 고쳐요."
                summary = f"파일 {len(planned)}개를 바꾸면 돼요: " + ", ".join(path for path, _ in planned)
            else:
                planned, summary = [], ""
        else:
            summary = f"파일 {len(planned)}개를 바꿔요: " + ", ".join(path for path, _ in planned)
        return ProjectPlan(
            summary=summary,
            files=planned,
            model=model or self.model_id,
            input_tokens=estimate_tokens(PLAN_SYSTEM)
            + content_tokens(with_images(edit_request_text(name, files, request, style, notes), images)),
            output_tokens=40 + 30 * len(planned) + len(answer) // 2,
            kind=kind,
            answer=answer,
        )

    def write_project_file(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        plan: list[tuple[str, str]],
        path: str,
        model: str = "",
        max_tokens: int = 16000,
        style: str = "",
        effort: str | None = None,
        images: list[dict] | None = None,
        notes: str = "",
        so_far: str = "",
    ) -> ProjectEdit:
        """That file as the one-shot mock would write it.

        A plan of the three starter files is a new app (the mock's edits
        only ever plan one file); anything else is the mock's edit, run on
        the files as they are now. `[mock-error-file:<path>]` fails here.
        """
        failure = MOCK_ERROR_FILE.search(request)
        if failure and failure.group(1) == path:
            raise ClaudeError(ProviderErrorKind.TIMEOUT, "mock file")
        # builder-file-continue: `[mock-stuck-file:<path>]` is cut before a
        # single part arrives; `[mock-long-file:<path>]` is cut half-way on
        # the first call and finished by the next.
        stuck = MOCK_STUCK_FILE.search(request)
        if stuck and stuck.group(1) == path:
            return ProjectEdit(
                summary="", writes=[(path, so_far)] if so_far else [], model=model or self.model_id,
                input_tokens=estimate_tokens(FILE_SYSTEM) + 400, output_tokens=max_tokens, incomplete=True,
                cut=True,
            )
        long = MOCK_LONG_FILE.search(request)
        if long and long.group(1) == path:
            whole = MOCK_LONG_CONTENT
            half = whole[: len(whole) // 2]
            done = bool(so_far)
            return ProjectEdit(
                summary=f"{path}을(를) 썼어요." if done else "",
                writes=[(path, so_far + whole[len(so_far):] if done else half)],
                model=model or self.model_id,
                input_tokens=estimate_tokens(FILE_SYSTEM) + 400 + len(so_far) // 3,
                output_tokens=len(half) // 3 + 40,
                incomplete=not done,
                cut=not done,
            )
        planned = {item for item, _ in plan}
        if {"index.html", "style.css", "app.js"} <= planned:
            title = name.strip() or "내 앱"
            written = dict(_mock_starter_files(title, request.strip()))
            accent = _mock_style_accent(style or request)
            content = written.get(path, f"/* {path} */\n").replace(MOCK_ACCENT, accent)
        else:
            content = dict(self.edit_project(name, files, request, model, max_tokens, style).writes).get(path)
        writes = [(path, content)] if content is not None else []
        # `MOCK_MANIFEST` in the request: the mock writes ctrlai.json beside
        # app.js, as the SDK rules make the real model do (app-platform P4).
        if MOCK_MANIFEST in request and path == "app.js":
            writes.append(("ctrlai.json", MOCK_MANIFEST_JSON))
        text = file_request_text(name, files, request, plan, path, style, notes)
        return ProjectEdit(
            summary=f"{path}을(를) 썼어요.",
            writes=writes,
            model=model or self.model_id,
            input_tokens=estimate_tokens(FILE_SYSTEM) + content_tokens(with_images(text, images)),
            output_tokens=min(max_tokens, len(content or "") // 3 + 30),
        )

    def check_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        model: str = "",
        max_tokens: int = 16000,
        effort: str | None = None,
        notes: str = "",
    ) -> ProjectEdit:
        """Nothing to fix — unless a file carries `MOCK_CHECK_FIX`, or
        `MOCK_CHECK_MANIFEST` with no ctrlai.json yet (the check adds it)."""
        fixes = [
            (path, content.replace(MOCK_CHECK_FIX, "fixed by check"))
            for path, content in files
            if MOCK_CHECK_FIX in content
        ][:CHECK_MAX_FIXES]
        if any(MOCK_CHECK_MANIFEST in content for _, content in files) and "ctrlai.json" not in dict(files):
            fixes.append(("ctrlai.json", MOCK_MANIFEST_JSON))
        summary = (
            f"점검하면서 {len(fixes)}곳을 고쳤어요." if fixes else "점검했어요 — 고칠 곳이 없어요."
        )
        return ProjectEdit(
            summary=summary,
            writes=fixes,
            model=model or self.model_id,
            input_tokens=estimate_tokens(CHECK_SYSTEM + check_request_text(name, files, notes)),
            output_tokens=40 + sum(len(content) // 3 for _, content in fixes),
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

#: Effort levels used here (생각 깊이, quality-tuning Q1). `between_tools`
#: accepts `high` or below, so 최고 (`max`) turns adaptive thinking on.
_EFFORTS = ("low", "medium", "high", "max")


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
        mode = "between_tools" if off and effort != "max" else "adaptive"
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
        effort: str | None = None,
    ) -> dict[str, Any]:
        """The request body. With `cache_ttl`, two cache breakpoints.

        `effort` is the 생각 깊이 the server chose (quality-tuning Q1); None
        keeps `CHAT_EFFORT`. A model without effort (Haiku 4.5) never gets
        the field either way (`thinking_params`).

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
                effort or self._settings.chat_effort,
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
            request.effort,
        )
        if request.timeout_seconds:
            params["timeout"] = float(request.timeout_seconds)
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
                # said so far is the reply, saved as a cut-off one — under
                # its own stop reason, so feat-auto-continue (which goes on
                # only after a real length cut, "max_tokens") does not keep
                # calling a turn that will not end.
                pass
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
        self, name: str, idea: str, model: str = "", max_tokens: int = 8000, effort: str | None = None
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
            effort=effort,
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
        effort: str | None = None,
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
        return self._tool_rounds(
            EDIT_SYSTEM, edit_request_text(name, files, request, style), model, max_tokens, effort
        )

    # ------------------------------------- staged generation (Q2), real

    def plan_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        model: str = "",
        max_tokens: int = 4096,
        style: str = "",
        effort: str | None = None,
        images: list[dict] | None = None,
        notes: str = "",
    ) -> ProjectPlan:
        """One small call, structured JSON back (`PLAN_SCHEMA`). Not cached."""
        import json

        import anthropic

        client = self._builder_client()
        params = self.request_params(
            PLAN_SYSTEM,
            [{"role": "user", "content": with_images(edit_request_text(name, files, request, style, notes), images)}],
            max_tokens,
            model,
            effort=effort,
        )
        output_config = dict(params.get("output_config", {}))
        output_config["format"] = {"type": "json_schema", "schema": PLAN_SCHEMA}
        params["output_config"] = output_config
        try:
            message = client.messages.create(**params)
        except anthropic.APIError as error:
            raise classify(error) from None
        billed = (message.usage.input_tokens or 0, message.usage.output_tokens or 0)
        if message.stop_reason in ("max_tokens", "refusal"):
            raise ClaudeError(ProviderErrorKind.UNKNOWN, f"plan {message.stop_reason}", usage=billed)
        text = next((block.text for block in message.content if block.type == "text"), "")
        try:
            data = json.loads(text)
            planned = [(str(item["path"]), str(item["purpose"])) for item in data["files"]]
            summary = str(data.get("summary", ""))
            kind = "question" if data.get("kind") == "question" else "change"
            answer = str(data.get("answer", ""))
        except (ValueError, KeyError, TypeError):
            raise ClaudeError(ProviderErrorKind.UNKNOWN, "plan json", usage=billed) from None
        return ProjectPlan(
            summary=summary,
            files=planned,
            model=message.model or model or self.model_id,
            input_tokens=billed[0],
            output_tokens=billed[1],
            kind=kind,
            answer=answer,
        )

    def write_project_file(
        self,
        name: str,
        files: list[tuple[str, str]],
        request: str,
        plan: list[tuple[str, str]],
        path: str,
        model: str = "",
        max_tokens: int = 16000,
        style: str = "",
        effort: str | None = None,
        images: list[dict] | None = None,
        notes: str = "",
        so_far: str = "",
    ) -> ProjectEdit:
        """One file in `write_file_part` parts (builder-file-continue), with
        the plan, the files so far and — after a cut — its beginning."""
        return self._part_rounds(
            path,
            so_far,
            with_images(file_request_text(name, files, request, plan, path, style, notes, so_far), images),
            model,
            max_tokens,
            effort,
        )

    def check_project(
        self,
        name: str,
        files: list[tuple[str, str]],
        model: str = "",
        max_tokens: int = 16000,
        effort: str | None = None,
        notes: str = "",
    ) -> ProjectEdit:
        """The self-check: fixes come back as `write_file` calls."""
        return self._tool_rounds(CHECK_SYSTEM, check_request_text(name, files, notes), model, max_tokens, effort)

    def _builder_client(self):
        import anthropic

        kwargs = self._client_kwargs()
        # Per call, not per whole generation (quality-tuning Q2).
        kwargs["timeout"] = self._settings.builder_timeout_seconds
        if self._http_client is not None:
            kwargs["http_client"] = self._http_client
        return anthropic.Anthropic(**kwargs)

    def _part_rounds(
        self,
        path: str,
        so_far: str,
        user_text: str | list[dict],
        model: str,
        max_tokens: int,
        effort: str | None,
    ) -> ProjectEdit:
        """One request of `write_file_part` calls (builder-file-continue).

        Exactly one request, so its cost stays inside the room the caller
        checked the wallet for; the caller calls again for the rest. A cut
        is not a failure: every part that arrived whole is kept — the block
        being written when the limit hit is the last one and is dropped —
        and the edit comes back `incomplete` (and `cut`), the file so far in
        `writes`. Another file written beside it (ctrlai.json) counts only
        once done. A reply that ends on its own has finished the file,
        whether or not its last part said done.
        """
        import anthropic

        client = self._builder_client()
        params = self.request_params(
            FILE_SYSTEM, [{"role": "user", "content": user_text}], max_tokens, model, effort=effort
        )
        params["tools"] = [WRITE_PART_TOOL]
        params["tool_choice"] = {"type": "auto"}
        try:
            message = client.messages.create(**params)
        except anthropic.APIError as error:
            raise classify(error) from None
        billed = (message.usage.input_tokens or 0, message.usage.output_tokens or 0)
        if message.stop_reason == "refusal":
            raise ClaudeError(ProviderErrorKind.UNKNOWN, "edit refusal", usage=billed)
        cut = message.stop_reason == "max_tokens"
        blocks = list(message.content)
        if cut and blocks and blocks[-1].type == "tool_use":
            blocks = blocks[:-1]  # the block being written when the limit hit
        written: dict[str, str] = {path: so_far}
        finished: set[str] = set()
        texts: list[str] = []
        for block in blocks:
            if block.type == "text" and block.text.strip():
                texts.append(block.text.strip())
            elif block.type == "tool_use":
                data = block.input if isinstance(block.input, dict) else {}
                part_path, content = data.get("path"), data.get("content")
                if block.name != "write_file_part" or not isinstance(part_path, str) or not isinstance(content, str):
                    raise ClaudeError(ProviderErrorKind.UNKNOWN, "edit tool", usage=billed)
                part_path = _part_path(part_path)
                written[part_path] = written.get(part_path, "") + content
                if data.get("done") is True:
                    finished.add(part_path)
        if message.stop_reason == "end_turn" and (written[path] or so_far):
            finished.add(path)
        writes = [(path, written[path])] if written[path] else []
        writes += [(other, content) for other, content in written.items() if other != path and other in finished]
        return ProjectEdit(
            summary=texts[-1] if texts else "",
            writes=writes,
            model=message.model or model or self.model_id,
            input_tokens=billed[0],
            output_tokens=billed[1],
            incomplete=path not in finished,
            cut=cut,
        )

    def _tool_rounds(
        self, system: str, user_text: str | list[dict], model: str, max_tokens: int, effort: str | None
    ) -> ProjectEdit:
        """Rounds of `write_file` until Claude stops, the usage added up."""
        import anthropic

        client = self._builder_client()

        messages: list[dict[str, Any]] = [{"role": "user", "content": user_text}]
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
            params = self.request_params(system, messages, remaining, model, effort=effort)
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
        self, name: str, idea: str, model: str = "", max_tokens: int = 8000, effort: str | None = None
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
        effort: str | None = None,
    ) -> ProjectEdit:
        raise ClaudeError(ProviderErrorKind.NOT_IMPLEMENTED, "credential not configured")

    def plan_project(self, *args: Any, **kwargs: Any) -> ProjectPlan:
        raise ClaudeError(ProviderErrorKind.NOT_IMPLEMENTED, "credential not configured")

    def write_project_file(self, *args: Any, **kwargs: Any) -> ProjectEdit:
        raise ClaudeError(ProviderErrorKind.NOT_IMPLEMENTED, "credential not configured")

    def check_project(self, *args: Any, **kwargs: Any) -> ProjectEdit:
        raise ClaudeError(ProviderErrorKind.NOT_IMPLEMENTED, "credential not configured")


def get_claude_provider(settings: Settings) -> ClaudeProvider:
    if settings.provider_is_mock("claude"):
        return MockClaudeProvider(delay_ms=settings.chat_mock_delay_ms)
    if settings.missing_provider_settings():
        return UnconfiguredClaudeProvider(settings)
    return AnthropicClaudeProvider(settings)
