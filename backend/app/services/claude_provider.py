"""The Claude provider, behind `CLAUDE_PROVIDER` — only as much as the
Video workspace's prompt helper needs.

Phase 2 (Chat) builds the real Anthropic adapter, streaming and token
pricing. This module is the seam it extends: one operation,
`rewrite_video_prompt`, which **only rewrites text**. It never generates
video and has no way to reach the video provider.

* **`MockClaudeProvider`** — the default. Canned Korean replies chosen by
  keyword, the same table the workspace used to hold in the browser.
* **`anthropic`** — not built here. Selecting it refuses with
  `ClaudeUnavailableError` before anything is charged.

The charge is a flat amount for now (`VIDEO_PROMPT_HELP_CHARGE_KRW`,
agreed 2026-10-07), recorded with the token counts the mock reports.
Phase 2 replaces the flat amount with per-token pricing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

from app.core.config import Settings


class ClaudeUnavailableError(Exception):
    """The configured Claude provider cannot serve the request. Korean message."""


@dataclass(frozen=True)
class PromptRewrite:
    reply: str
    #: None when Claude answered without changing the prompt.
    revised_prompt: str | None
    model: str
    input_tokens: int
    output_tokens: int


class ClaudeProvider(Protocol):
    name: str

    def rewrite_video_prompt(self, prompt: str, request: str) -> PromptRewrite: ...


#: (pattern, reply, what to add to the prompt — None means leave it alone)
_RULES: list[tuple[re.Pattern[str], str, str | None]] = [
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

_FALLBACK = (
    "지금은 예시 답변만 드릴 수 있어요. 밝기, 카메라 움직임, 인물 구도처럼 "
    "바꾸고 싶은 점을 말씀해 주시면 프롬프트를 고쳐 드립니다."
)


class MockClaudeProvider:
    name = "claude"

    def rewrite_video_prompt(self, prompt: str, request: str) -> PromptRewrite:
        for pattern, reply, addition in _RULES:
            if pattern.search(request):
                revised = None if addition is None else f"{prompt.strip()} {addition}".strip()
                return self._result(prompt, request, reply, revised)
        return self._result(prompt, request, _FALLBACK, None)

    @staticmethod
    def _result(prompt: str, request: str, reply: str, revised: str | None) -> PromptRewrite:
        # A rough stand-in for token counts — characters, not tokens — so
        # the ledger row has the shape Phase 2 will fill with real figures.
        return PromptRewrite(
            reply=reply,
            revised_prompt=revised,
            model="mock",
            input_tokens=len(prompt) + len(request),
            output_tokens=len(reply) + len(revised or ""),
        )


class UnavailableClaudeProvider:
    name = "claude"

    def rewrite_video_prompt(self, prompt: str, request: str) -> PromptRewrite:
        raise ClaudeUnavailableError(
            "Claude 실제 연동은 아직 만들어지지 않았습니다 (Phase 2). 관리자에게 알려 주세요."
        )


def get_claude_provider(settings: Settings) -> ClaudeProvider:
    if settings.provider_is_mock("claude"):
        return MockClaudeProvider()
    return UnavailableClaudeProvider()
