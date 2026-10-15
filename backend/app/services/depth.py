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
  smaller `max_tokens` (token-guard).

The numbers are admin settings (Admin › System › 채팅 한도, audited) kept in
`chat_limits.depth_levels`; with nothing set the `DEFAULTS` below apply.
Q0 (RUN-2026-10-15) justified them: no real reply came near the old 4,096
tokens or 200원, so 보통 keeps 200원 and doubles the room.
"""

from __future__ import annotations

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


@dataclass(frozen=True)
class Level:
    name: str
    max_tokens: int
    cap_krw: int

    @property
    def effort(self) -> str:
        return self.name


#: (max_tokens, cap_krw) per surface and level, in force with no admin row.
DEFAULTS: dict[str, dict[str, tuple[int, int]]] = {
    "chat": {
        "low": (4096, 200),
        "medium": (8192, 200),
        "high": (16000, 400),
        "max": (32000, 800),
    },
    # Builder calls write whole files; today's "약 275원 · 최대 443원" sits
    # inside 보통's 500원.
    "builder": {
        "low": (16000, 500),
        "medium": (16000, 500),
        "high": (32000, 900),
        "max": (32000, 1200),
    },
}

#: Bounds an admin may set — they catch typos (a cap in dollars).
MAX_TOKENS_RANGE = (1024, 64000)
CAP_RANGE = (10, 5000)


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
        tokens, cap = DEFAULTS[surface][name]
        row = saved.get(name) or {}
        out[name] = Level(
            name=name,
            max_tokens=int(row.get("max_tokens", tokens)),
            cap_krw=int(row.get("cap_krw", cap)),
        )
    return out


def resolve(stored: dict | None, surface: str, model_id: str, level: str | None) -> tuple[Level, str | None]:
    """The level a call runs at, and the effort to send (None = send none).

    A level the model does not offer — or any made-up value — falls back to
    보통: the client's word never sets a number. A model without effort runs
    at 보통's room and cap.
    """
    levels = table(stored, surface)
    offered = levels_for(model_id)
    if level in offered:
        chosen = levels[level]
        return chosen, chosen.effort
    return levels[DEFAULT_LEVEL], (DEFAULT_LEVEL if offered else None)


def clean(level: str | None) -> str | None:
    """A level name as stored, or None. Unknown names are refused by the
    caller with `is_level`."""
    return level if level in LEVELS else None


def is_level(level: str | None) -> bool:
    return level in LEVELS


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
            }
        )
    return out


def note_for(model_id: str) -> str:
    """One line when a depth needs thinking on — said in the picker."""
    if model_id.startswith("claude-sonnet-5-5"):
        return "최고에서는 생각을 켜고 답해요 — 시간과 비용이 더 들어요."
    return ""


def full_table(stored: dict | None) -> dict:
    """Both surfaces as plain numbers — what Admin › System shows."""
    return {
        surface: {
            name: {"max_tokens": level.max_tokens, "cap_krw": level.cap_krw}
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
            tokens, cap = DEFAULTS[surface][name]
            tokens = int(row.get("max_tokens", tokens))
            cap = int(row.get("cap_krw", cap))
            if not MAX_TOKENS_RANGE[0] <= tokens <= MAX_TOKENS_RANGE[1]:
                raise ValueError(
                    f"{LABELS[name]}의 최대 토큰은 {MAX_TOKENS_RANGE[0]:,}–{MAX_TOKENS_RANGE[1]:,} 사이여야 해요."
                )
            if not CAP_RANGE[0] <= cap <= CAP_RANGE[1]:
                raise ValueError(f"{LABELS[name]}의 1회 한도는 {CAP_RANGE[0]}–{CAP_RANGE[1]:,}원 사이여야 해요.")
            out[surface][name] = {"max_tokens": tokens, "cap_krw": cap}
    return out


def summary(stored: dict) -> str:
    """One line for the audit log: 채팅 낮음 4,096/200원 · …"""
    parts = []
    for surface, title in (("chat", "채팅"), ("builder", "빌더")):
        steps = " · ".join(
            f"{LABELS[name]} {stored[surface][name]['max_tokens']:,}/{stored[surface][name]['cap_krw']:,}원"
            for name in LEVELS
        )
        parts.append(f"{title} {steps}")
    return " | ".join(parts)
