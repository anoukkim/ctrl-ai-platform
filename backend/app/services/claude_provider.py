"""The Claude provider, behind `CLAUDE_PROVIDER` (CLAUDE.md section 20).

Two operations, both text only:

* **`stream_chat`** — Chat's reply, streamed piece by piece.
* **`rewrite_video_prompt`** — the Video workspace's 프롬프트 도움받기. It
  rewrites text and has no way to reach the video provider.

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
"""

from __future__ import annotations

import asyncio
import re
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


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class UsageUpdate:
    """Token counts so far. Each update replaces the previous one."""

    input_tokens: int
    output_tokens: int


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


class ClaudeProvider(Protocol):
    #: "mock" or the real model id — what a usage event records.
    model_id: str

    def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamEvent]: ...

    def rewrite_video_prompt(self, prompt: str, request: str) -> PromptRewrite: ...


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
- Project Builder: start an app or website project by describing it in Korean.
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
        "좋은 아이디어예요! Project Builder에서 새 프로젝트로 시작해 볼까요? 코드를 몰라도 "
        "한국어로 설명하면 됩니다. 아래 단추를 누르면 지금 하신 이야기를 그대로 들고 갑니다.",
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


class MockClaudeProvider:
    model_id = "mock"

    def __init__(self, delay_ms: int = 0) -> None:
        self.delay = max(0, delay_ms) / 1000

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamEvent]:
        last = request.messages[-1]["content"] if request.messages else ""
        # An unanswered earlier message may have been joined to this one
        # (see `chat.build_context`); the mock answers only the newest part.
        last = last.rsplit("\n\n", 1)[-1]
        input_tokens = estimate_tokens(request.system) + sum(
            estimate_tokens(message["content"]) for message in request.messages
        )

        failure = MOCK_ERROR.search(last)
        if failure:
            kind = failure.group(1)
            raise ClaudeError(kind if kind in MEMBER_MESSAGE else ProviderErrorKind.UNKNOWN, "mock")

        yield UsageUpdate(input_tokens=input_tokens, output_tokens=0)

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
            yield UsageUpdate(input_tokens=input_tokens, output_tokens=sent)
        yield StreamEnd("end_turn")

    def rewrite_video_prompt(self, prompt: str, request: str) -> PromptRewrite:
        for pattern, reply, addition in _PROMPT_RULES:
            if pattern.search(request):
                revised = None if addition is None else f"{prompt.strip()} {addition}".strip()
                return self._rewrite(prompt, request, reply, revised)
        return self._rewrite(prompt, request, _PROMPT_FALLBACK, None)

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
        self, system: str, messages: list[dict[str, str]], max_tokens: int
    ) -> dict[str, Any]:
        return {
            "model": self.model_id,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
            **thinking_params(
                self.model_id, self._settings.chat_thinking, self._settings.chat_effort
            ),
        }

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamEvent]:
        import anthropic

        kwargs = self._client_kwargs()
        if self._async_http_client is not None:
            kwargs["http_client"] = self._async_http_client
        client = anthropic.AsyncAnthropic(**kwargs)

        input_tokens = 0
        output_tokens = 0
        stop_reason = "end_turn"
        try:
            async with client.messages.stream(
                **self.request_params(request.system, request.messages, request.max_tokens)
            ) as stream:
                async for event in stream:
                    if event.type == "message_start":
                        usage = event.message.usage
                        input_tokens = (
                            (usage.input_tokens or 0)
                            + (getattr(usage, "cache_creation_input_tokens", None) or 0)
                            + (getattr(usage, "cache_read_input_tokens", None) or 0)
                        )
                        output_tokens = usage.output_tokens or 0
                        yield UsageUpdate(input_tokens, output_tokens)
                    elif event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield TextDelta(event.delta.text)
                    elif event.type == "message_delta":
                        if event.usage is not None and event.usage.output_tokens is not None:
                            output_tokens = event.usage.output_tokens
                        if event.delta.stop_reason:
                            stop_reason = event.delta.stop_reason
                        yield UsageUpdate(input_tokens, output_tokens)
        except anthropic.APIError as error:
            raise classify(error) from None
        yield StreamEnd(stop_reason)

    def rewrite_video_prompt(self, prompt: str, request: str) -> PromptRewrite:
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
            model=message.model or self.model_id,
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

    def rewrite_video_prompt(self, prompt: str, request: str) -> PromptRewrite:
        raise ClaudeError(ProviderErrorKind.NOT_IMPLEMENTED, "credential not configured")


def get_claude_provider(settings: Settings) -> ClaudeProvider:
    if settings.provider_is_mock("claude"):
        return MockClaudeProvider(delay_ms=settings.chat_mock_delay_ms)
    if settings.missing_provider_settings():
        return UnconfiguredClaudeProvider(settings)
    return AnthropicClaudeProvider(settings)
