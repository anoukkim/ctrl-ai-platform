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

    def __init__(self, kind: str, detail: str = "") -> None:
        self.kind = kind
        #: For the Admin status board: an HTTP status and error type, never
        #: a request body and never the key.
        self.detail = detail
        super().__init__(MEMBER_MESSAGE.get(kind, MEMBER_MESSAGE[ProviderErrorKind.UNKNOWN]))


# ------------------------------------------------------------- data shapes


@dataclass(frozen=True)
class ChatRequest:
    system: str
    #: [{"role": "user" | "assistant", "content": str}, ...], alternating,
    #: starting and ending with the member.
    messages: list[dict[str, str]]
    max_tokens: int
    #: The provider's model id, from the chat model catalogue. Empty means
    #: the provider's own `model_id` (the `ANTHROPIC_MODEL` fallback).
    model: str = ""
    #: "5m" / "1h" to mark the prompt cacheable; None sends no marker.
    cache_ttl: str | None = None


@dataclass(frozen=True)
class TextDelta:
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


@dataclass(frozen=True)
class StreamEnd:
    #: "end_turn", "max_tokens", "refusal", …
    stop_reason: str


StreamEvent = TextDelta | UsageUpdate | StreamEnd


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


# -------------------------------------------------------------- the prompt

CHAT_SYSTEM_PROMPT = """\
You are the assistant inside CTRL+AI, a club where beginners make apps and \
short videos with AI. Most members cannot code and have never used an API.

How to answer:
- Always answer in Korean, whatever language the member writes in.
- Explain simply, as to a beginner. Short paragraphs, everyday words; when \
a technical term is unavoidable, say in one phrase what it means.
- Be warm and practical. Prefer one clear next step over a long list.
- Write plain text. The screen does not render Markdown, so use no headings, tables, bold or code fences; line breaks and simple "-" lists are fine.

What CTRL+AI offers, to mention when it genuinely helps the member:
- Project Builder: start an app or website project by describing it in Korean. The button below your reply makes a small, working example app from the member's idea that they can try at once and change later — say so when you offer it.
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
preview blocks them all. Use inline SVG or CSS for icons and charts, and \
localStorage if the app should remember data.
- index.html links its files exactly like this: \
<link rel="stylesheet" href="style.css"> and <script src="app.js"></script>.
- Everything the member sees is in Korean. Short Korean comments in the \
code, so a beginner can follow it.
- Small and complete beats big: about 300 lines in total, every button \
works, the layout fits a phone and a laptop.

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


# ------------------------------------------------------------------- mock

#: Put `[mock-error:<kind>]` in a message to make the mock fail that way —
#: so the Korean error messages can be seen, and tested, with no key.
#: Mock only: the real provider sends the text to Claude like any other.
MOCK_ERROR = re.compile(r"\[mock-error:(\w+)\]")
MOCK_REFUSAL = "[mock-refusal]"

#: (pattern, reply, action) — checked in order. An action adds the button.
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
        self, model: str, ttl: str | None, blocks: list[str], now: float | None = None
    ) -> tuple[int, int, int]:
        """(uncached input, cache write, cache read) for one request."""
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


class MockClaudeProvider:
    model_id = "mock"

    def __init__(self, delay_ms: int = 0) -> None:
        self.delay = max(0, delay_ms) / 1000

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamEvent]:
        last = request.messages[-1]["content"] if request.messages else ""
        # An unanswered earlier message may have been joined to this one
        # (see `chat.build_context`); the mock answers only the newest part.
        last = last.rsplit("\n\n", 1)[-1]

        failure = MOCK_ERROR.search(last)
        if failure:
            kind = failure.group(1)
            raise ClaudeError(kind if kind in MEMBER_MESSAGE else ProviderErrorKind.UNKNOWN, "mock")

        uncached, written, read = MOCK_PROMPT_CACHE.bill(
            request.model or self.model_id,
            request.cache_ttl,
            [request.system, *(message["content"] for message in request.messages)],
        )

        def usage(output_tokens: int) -> UsageUpdate:
            return UsageUpdate(uncached, output_tokens, written, read)

        yield usage(0)

        if MOCK_REFUSAL in last:
            yield StreamEnd("refusal")
            return

        reply, action = _CHAT_FALLBACK, None
        for pattern, text, rule_action in _CHAT_RULES:
            if pattern.search(last):
                reply, action = text, rule_action
                break
        if action:
            reply = f"{reply}\n[[action:{action}|{short_title(last)}]]"

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
        yield StreamEnd("end_turn")

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
            """// 브라우저에 목록을 저장해 두는 열쇠 이름
const KEY = "starter-items";

// 저장된 목록을 불러옵니다. 처음이면 빈 목록입니다.
let items = JSON.parse(localStorage.getItem(KEY) || "[]");

const form = document.getElementById("add-form");
const input = document.getElementById("new-item");
const list = document.getElementById("items");
const count = document.getElementById("count");

// 목록을 저장하고 화면을 다시 그립니다.
function save() {
  localStorage.setItem(KEY, JSON.stringify(items));
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

render();
""",
        ),
    ]


# --------------------------------------------------------------- anthropic

#: Effort levels used here. `between_tools` accepts `high` or below.
_EFFORTS = ("low", "medium", "high")


def thinking_params(model: str, thinking: str, effort: str) -> dict[str, Any]:
    """The request fields that set how much Claude thinks, per model.

    "off" is what was agreed for chat (2026-10-07): no thinking where the
    model allows it, otherwise the lowest effort.

    * **Sonnet 5.5** — thinking off is `{"type": "between_tools"}`;
      `{"type": "disabled"}` is rejected. Effort must be `high` or below.
    * **Opus 5.5** (and other current models) — thinking cannot be turned
      off, so "off" leaves adaptive thinking on and relies on low effort.
    * **Haiku 4.5** — does not think unless asked with a token budget, and
      rejects `effort`, so it gets neither field.

    Thinking text is never shown or stored either way; it is only paid for.
    """
    chosen = effort.strip().lower()
    effort = chosen if chosen in _EFFORTS else "low"
    off = thinking.strip().lower() != "on"

    if model.startswith("claude-haiku-4-5"):
        return {}
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
            **thinking_params(model, self._settings.chat_thinking, self._settings.chat_effort),
        }
        if cache_ttl is not None:
            marker: dict[str, str] = {"type": "ephemeral"}
            if cache_ttl == "1h":
                marker["ttl"] = "1h"
            params["system"] = [{"type": "text", "text": system, "cache_control": marker}]
            params["cache_control"] = dict(marker)
        return params

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamEvent]:
        import anthropic

        kwargs = self._client_kwargs()
        if self._async_http_client is not None:
            kwargs["http_client"] = self._async_http_client
        client = anthropic.AsyncAnthropic(**kwargs)

        input_tokens = 0
        output_tokens = 0
        written = 0
        read = 0
        stop_reason = "end_turn"
        try:
            async with client.messages.stream(
                **self.request_params(
                    request.system,
                    request.messages,
                    request.max_tokens,
                    request.model,
                    request.cache_ttl,
                )
            ) as stream:
                async for event in stream:
                    if event.type == "message_start":
                        usage = event.message.usage
                        input_tokens = usage.input_tokens or 0
                        written = getattr(usage, "cache_creation_input_tokens", None) or 0
                        read = getattr(usage, "cache_read_input_tokens", None) or 0
                        output_tokens = usage.output_tokens or 0
                        yield UsageUpdate(input_tokens, output_tokens, written, read)
                    elif event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield TextDelta(event.delta.text)
                    elif event.type == "message_delta":
                        usage = event.usage
                        if usage is not None:
                            if usage.output_tokens is not None:
                                output_tokens = usage.output_tokens
                            # The final counts, when the delta carries them.
                            if getattr(usage, "input_tokens", None) is not None:
                                input_tokens = usage.input_tokens
                            if getattr(usage, "cache_creation_input_tokens", None) is not None:
                                written = usage.cache_creation_input_tokens
                            if getattr(usage, "cache_read_input_tokens", None) is not None:
                                read = usage.cache_read_input_tokens
                        if event.delta.stop_reason:
                            stop_reason = event.delta.stop_reason
                        yield UsageUpdate(input_tokens, output_tokens, written, read)
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

        if message.stop_reason in ("max_tokens", "refusal"):
            # A cut-off JSON or a refusal has no app in it.
            raise ClaudeError(ProviderErrorKind.UNKNOWN, f"starter {message.stop_reason}")
        text = next((block.text for block in message.content if block.type == "text"), "")
        try:
            data = json.loads(text)
            files = [(str(item["path"]), str(item["content"])) for item in data["files"]]
            summary = str(data.get("summary", ""))
        except (ValueError, KeyError, TypeError):
            raise ClaudeError(ProviderErrorKind.UNKNOWN, "starter json") from None
        return StarterApp(
            summary=summary,
            files=files,
            model=message.model or model or self.model_id,
            input_tokens=message.usage.input_tokens or 0,
            output_tokens=message.usage.output_tokens or 0,
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


def get_claude_provider(settings: Settings) -> ClaudeProvider:
    if settings.provider_is_mock("claude"):
        return MockClaudeProvider(delay_ms=settings.chat_mock_delay_ms)
    if settings.missing_provider_settings():
        return UnconfiguredClaudeProvider(settings)
    return AnthropicClaudeProvider(settings)
