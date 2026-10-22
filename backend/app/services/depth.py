"""생각 깊이 — how hard Claude works on one reply (quality-tuning Q1).

The member picks a model and a depth (낮음 · 보통 · 높음, and 최고 where the
model's API has a `max` effort). The client sends only the model id and the
level **name**; everything else is decided here, on the server, per
surface (chat or builder):

* `effort` — the API's `output_config.effort` (checked against Anthropic's
  docs, 2026-10-15: Sonnet 5.5 and Opus 5.5 take low/medium/high/xhigh/max;
  Haiku 4.5 rejects `effort` — it gets no slider and no effort at all);
* `max_tokens` — the most the reply may write;
* `cap_krw` — the most one call may cost, enforced before the call as a
  smaller `max_tokens` (token-guard);
* `total_cap_krw` — feat-auto-continue (owner-polish 11, 2026-10-16): when a
  chat reply stops at `max_tokens`, the server **continues it by itself**
  in further calls, each under `cap_krw` again, until the reply ends or the
  whole reply reaches this figure. 0 = no automatic continuation (the old
  behaviour: one call, then 이어서 쓰기 by hand). Builder calls do not
  continue (they write whole files per stage), so their value is unused.

The numbers are admin settings (Admin › System › 채팅 한도, audited) kept in
`chat_limits.depth_levels`; with nothing set the `DEFAULTS` below apply.
Q0 (RUN-2026-10-15) justified them: no real reply came near the old 4,096
tokens or 200원, so 보통 keeps 200원 and doubles the room.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Level names, in slider order. The API effort has the same name.
LEVELS = ("low", "medium", "high", "max")
DEFAULT_LEVEL = "medium"

LABELS = {"low": "낮음", "medium": "보통", "high": "높음", "max": "최고"}
HINTS = {
    "low": "짧은 질문에 빨라요",
    "medium": "대부분의 질문에 알맞아요",
    "high": "어려운 문제, 긴 글, 코드에 좋아요",
    "max": "가장 깊이 생각해요 — 시간과 비용이 가장 많이 들어요",
}

SURFACES = ("chat", "builder")

# ------------------------------------------------------------ 자동 (auto-depth)
#
# Owner, 2026-10-22: "빌더도 중간에 멈추니까 그냥 기본적으로 자동으로 두고
# 선택하고 싶으면 하는거고". 자동 is the default (a conversation, a project
# or a member with nothing chosen); the server picks 낮음 · 보통 · 높음 for
# each request by the rules in `auto_level` — no extra call, nothing
# charged. It never picks 최고: the member chooses that one. So 자동's
# "최대 M원" is 높음's cap, which the admin already sets in Models › 한도.
AUTO = "auto"
AUTO_LABEL = "자동"
AUTO_HINT = "요청에 맞춰 낮음 · 보통 · 높음 중에서 골라요"
AUTO_MAX = "high"

#: Words that mean the request needs more thought — code, analysis,
#: comparison, planning, long writing, maths.
_HARD = re.compile(
    r"코드|코딩|함수|버그|에러|오류|디버그|리팩터|알고리즘|구현|"
    r"비교|분석|설계|계획|전략|기획|보고서|논문|요약해|정리해|단계별|자세히|"
    r"수학|증명|계산|문제 풀|왜 그런|원인|"
    r"code|debug|error|function|algorithm|analy[sz]e|compare|design|plan",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class AutoHint:
    """What 자동 looks at for one request."""

    text: str = ""
    #: Files attached to this message (chat).
    files: int = 0
    #: The Builder is writing the app for the first time.
    creating: bool = False


def auto_level(surface: str, hint: AutoHint | None) -> str:
    """The depth 자동 picks for one request: 낮음, 보통 or 높음.

    Chat — 높음 for code, analysis, planning, attachments, a code block or a
    long message; 낮음 for a short one-liner with none of that; else 보통.
    Builder — 높음 for the first build or a long change request (so a
    whole app is not cut at 보통's per-call cap); else 보통.
    """
    hint = hint or AutoHint()
    text = hint.text.strip()
    if surface == "builder":
        return "high" if hint.creating or len(text) > 300 else "medium"
    if hint.files or "```" in text or len(text) > 600 or _HARD.search(text):
        return "high"
    if len(text) <= 30:
        return "low"
    return "medium"


@dataclass(frozen=True)
class Level:
    name: str
    max_tokens: int
    cap_krw: int
    #: The whole reply's ceiling across automatic continuations (chat).
    total_cap_krw: int = 0

    @property
    def effort(self) -> str:
        return self.name


#: (max_tokens, cap_krw, total_cap_krw) per surface and level, in force
#: with no admin row. The total caps (feat-auto-continue): 보통's 1,500원
#: is about seven continuations of its 200원 call — roughly 50,000 output
#: tokens on Sonnet, far past any answer a member has asked for, so a
#: runaway reply is what it stops, not a long one; the others scale with
#: their call cap (낮음 3×, 높음 7.5×, 최고 7.5×). The owner's example was
#: 보통 1,500원 · 높음 3,000원.
DEFAULTS: dict[str, dict[str, tuple[int, int, int]]] = {
    "chat": {
        "low": (4096, 200, 600),
        "medium": (8192, 200, 1500),
        "high": (16000, 400, 3000),
        "max": (32000, 800, 6000),
    },
    # Builder calls write whole files; today's "약 275원 · 최대 443원" sits
    # inside 보통's 500원. No automatic continuation there (0).
    "builder": {
        "low": (16000, 500, 0),
        "medium": (16000, 500, 0),
        "high": (32000, 900, 0),
        "max": (32000, 1200, 0),
    },
}

#: Bounds an admin may set — they catch typos (a cap in dollars).
MAX_TOKENS_RANGE = (1024, 64000)
CAP_RANGE = (10, 5000)
#: 0 turns automatic continuation off; otherwise at least the call cap.
TOTAL_CAP_RANGE = (0, 50_000)


def levels_for(model_id: str) -> tuple[str, ...]:
    """The depths a model offers. Empty: the model has no effort parameter
    (Haiku 4.5, other providers) — no slider, and no effort is ever sent."""
    model = model_id.strip().lower()
    if not model.startswith("claude-") or model.startswith("claude-haiku"):
        return ()
    families = ("claude-opus-", "claude-sonnet-5", "claude-sonnet-4-6", "claude-fable", "claude-mythos")
    if model.startswith(families):
        return LEVELS
    return ()


def table(stored: dict | None, surface: str) -> dict[str, Level]:
    """Every level for a surface: the admin's numbers over the defaults."""
    out: dict[str, Level] = {}
    saved = (stored or {}).get(surface) or {}
    for name in LEVELS:
        tokens, cap, total = DEFAULTS[surface][name]
        row = saved.get(name) or {}
        out[name] = Level(
            name=name,
            max_tokens=int(row.get("max_tokens", tokens)),
            cap_krw=int(row.get("cap_krw", cap)),
            total_cap_krw=int(row.get("total_cap_krw", total)),
        )
    return out


def resolve(
    stored: dict | None,
    surface: str,
    model_id: str,
    level: str | None,
    hint: AutoHint | None = None,
) -> tuple[Level, str | None]:
    """The level a call runs at, and the effort to send (None = send none).

    Nothing chosen, or 자동, picks by `auto_level` (auto-depth). A level the
    model does not offer — or any made-up value — falls back to 보통: the
    client's word never sets a number. A model without effort runs at
    보통's room and cap.
    """
    levels = table(stored, surface)
    offered = levels_for(model_id)
    if offered and (level is None or level == AUTO):
        level = auto_level(surface, hint)
    if level in offered:
        chosen = levels[level]
        return chosen, chosen.effort
    return levels[DEFAULT_LEVEL], (DEFAULT_LEVEL if offered else None)


def clean(level: str | None) -> str | None:
    """A level name as stored (자동 included), or None. Unknown names are
    refused by the caller with `is_level`."""
    return level if is_level(level) else None


def is_level(level: str | None) -> bool:
    return level in LEVELS or level == AUTO


#: "1회 약 N원" per depth, relative to the model's typical reply (the
#: calibrated figure the picker already showed). Effort mostly changes how
#: much is written and thought, so the estimate scales with it; the cap is
#: the hard number.
ESTIMATE_FACTORS = {"low": 0.7, "medium": 1.0, "high": 1.8, "max": 3.0}


def options(stored: dict | None, surface: str, model_id: str, base_krw: int | None) -> list[dict]:
    """The slider's steps for one model: label, hint, estimate, maximum."""
    levels = table(stored, surface)
    out = []
    for name in levels_for(model_id):
        level = levels[name]
        estimate = None
        if base_krw is not None:
            estimate = max(1, min(round(base_krw * ESTIMATE_FACTORS[name]), level.cap_krw))
        out.append(
            {
                "level": name,
                "label": LABELS[name],
                "hint": HINTS[name],
                "estimate_krw": estimate,
                "max_krw": level.cap_krw,
                # feat-auto-continue: the whole reply's ceiling (0 = one call only).
                "total_krw": level.total_cap_krw,
            }
        )
    return out


def auto_option(stored: dict | None, surface: str, model_id: str, base_krw: int | None) -> dict | None:
    """The picker's 자동 switch for one model: its estimate (보통's) and its
    maximum (높음's cap — the most 자동 can pick). None when the model has no
    depths."""
    if not levels_for(model_id):
        return None
    levels = table(stored, surface)
    top = levels[AUTO_MAX]
    estimate = None
    if base_krw is not None:
        estimate = max(1, min(round(base_krw * ESTIMATE_FACTORS["medium"]), top.cap_krw))
    return {
        "level": AUTO,
        "label": AUTO_LABEL,
        "hint": AUTO_HINT,
        "estimate_krw": estimate,
        "max_krw": top.cap_krw,
        "total_krw": top.total_cap_krw,
    }


def note_for(model_id: str) -> str:
    """One line when a depth needs thinking on — said in the picker."""
    if model_id.startswith("claude-sonnet-5-5"):
        return "최고에서는 생각을 켜고 답해요 — 시간과 비용이 더 들어요."
    return ""


def full_table(stored: dict | None) -> dict:
    """Both surfaces as plain numbers — what Admin › System shows."""
    return {
        surface: {
            name: {"max_tokens": level.max_tokens, "cap_krw": level.cap_krw, "total_cap_krw": level.total_cap_krw}
            for name, level in table(stored, surface).items()
        }
        for surface in SURFACES
    }


def checked_table(wanted: dict) -> dict:
    """An admin's per-depth numbers, every one inside its bounds. Raises
    ValueError with a Korean sentence on the first one that is not."""
    out: dict = {}
    for surface in SURFACES:
        rows = (wanted or {}).get(surface) or {}
        out[surface] = {}
        for name in LEVELS:
            row = rows.get(name) or {}
            tokens, cap, total = DEFAULTS[surface][name]
            tokens = int(row.get("max_tokens", tokens))
            cap = int(row.get("cap_krw", cap))
            total = int(row.get("total_cap_krw", total))
            if not MAX_TOKENS_RANGE[0] <= tokens <= MAX_TOKENS_RANGE[1]:
                raise ValueError(
                    f"{LABELS[name]}의 최대 토큰은 {MAX_TOKENS_RANGE[0]:,}–{MAX_TOKENS_RANGE[1]:,} 사이여야 해요."
                )
            if not CAP_RANGE[0] <= cap <= CAP_RANGE[1]:
                raise ValueError(f"{LABELS[name]}의 1회 한도는 {CAP_RANGE[0]}–{CAP_RANGE[1]:,}원 사이여야 해요.")
            if total != 0 and not cap <= total <= TOTAL_CAP_RANGE[1]:
                raise ValueError(
                    f"{LABELS[name]}의 전체 한도는 0(이어 쓰기 없음)이거나 1회 한도 이상 "
                    f"{TOTAL_CAP_RANGE[1]:,}원 이하여야 해요."
                )
            out[surface][name] = {"max_tokens": tokens, "cap_krw": cap, "total_cap_krw": total}
    return out


def summary(stored: dict) -> str:
    """One line for the audit log: 채팅 낮음 4,096/200원 · …"""
    parts = []
    for surface, title in (("chat", "채팅"), ("builder", "빌더")):
        steps = "·".join(
            f"{LABELS[name]} {stored[surface][name]['max_tokens']:,}/{stored[surface][name]['cap_krw']:,}원"
            for name in LEVELS
        )
        # feat-auto-continue: the whole-reply ceilings in one short clause
        # (the audit summary column is 300 characters; the full table is
        # in the row's detail either way).
        totals = [stored[surface][name].get("total_cap_krw") or 0 for name in LEVELS]
        if any(totals):
            steps += "·전체 " + "/".join(f"{total:,}" for total in totals) + "원"
        parts.append(f"{title} {steps}")
    return " | ".join(parts)
