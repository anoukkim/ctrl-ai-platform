"""Server tools in Chat (chat-plus-tools): which run, and what they cost.

Three Anthropic server tools — 웹 검색, 웹 페이지 읽기, 코드 실행 — each
switched on per catalogue model by an admin and per conversation by the
member, off by default. A tool is **sent only when both switches are on**;
turning a tool on or off changes the request's tool list, which breaks the
prompt cache, which is why the member's switch is per conversation.

The money, same shape as everything else around `services/usage.py`: the
fee is exact after the reply (billed searches × the catalogue's per-search
dollar price × the rate, rounded up), result tokens are billed once,
inside this reply — they are **not** persisted and never re-sent on later
turns — and token-guard's per-reply cap covers all of it: the cap reserves
each enabled tool's full worst case (`cap_extra_krw`), so a tooled reply's
charge stays inside the cap, and a tool whose worst case alone reaches the
cap is refused before anything is spent.

Mock only until Phase 9: no real API call, no real fee. The request
mapping for the real tools lives in `claude_provider.server_tool_params`.
"""

from __future__ import annotations

from decimal import ROUND_CEILING, Decimal

from app.models import Conversation
from app.services.chat_models import ChosenModel
from app.services.pricing import Price

#: Every kind there is, in display order.
KINDS: tuple[str, ...] = ("web_search", "web_fetch", "code_execution")

#: Korean names, for refusals and notices.
LABELS: dict[str, str] = {
    "web_search": "웹 검색",
    "web_fetch": "페이지 읽기",
    "code_execution": "코드 실행",
}

#: Result-token reserves the cap sets aside per use. Search results and
#: code output have no API-side cap, so these are our own defensible
#: worst cases: a search's result blocks run to roughly a thousand tokens
#: each in practice — 2,000 is double that; code output is ordinarily a
#: few lines — 1,000 covers a long traceback. Fetch needs no constant of
#: its own: the admin's 채팅 한도 settings bound it (tool-cap-defaults —
#: 1회 × 10,000토큰 by default), and the API enforces them.
SEARCH_RESULT_RESERVE_TOKENS = 2_000
CODE_RESULT_RESERVE_TOKENS = 1_000


def tools_in_force(conversation: Conversation, model: ChosenModel) -> tuple[str, ...]:
    """The tools this turn sends: the member's toggle AND the model's switch."""
    pairs = (
        ("web_search", conversation.use_web_search and model.tools_web_search),
        ("web_fetch", conversation.use_web_fetch and model.tools_web_fetch),
        ("code_execution", conversation.use_code_execution and model.tools_code_execution),
    )
    return tuple(kind for kind, on in pairs if on)


def search_fee_krw(price: Price, per_call_usd: Decimal, searches: int) -> int:
    """Billed searches × the catalogue's per-search price, in won, rounded up."""
    if searches <= 0:
        return 0
    won = (Decimal(searches) * per_call_usd * price.usd_krw).to_integral_value(
        rounding=ROUND_CEILING
    )
    return int(won)


def cap_extra_krw(
    price: Price,
    tools: tuple[str, ...],
    per_call_usd: Decimal,
    *,
    fetch_max_uses: int,
    fetch_max_content_tokens: int,
    search_max_uses: int = 5,
) -> int:
    """What the per-reply cap reserves for the enabled tools: everything.

    The owner's rule (2026-10-14): the cap includes tool fees **and**
    result tokens. Result tokens arrive as input in the middle of the
    request, outside `max_tokens`' reach, so the only way the cap can
    honestly include them is to reserve their worst case up front —
    priced the dear way, like the pre-check prices input. A tool whose
    worst case alone reaches the cap cannot be used until it is turned
    off or the admin raises the 1회 비용 한도; the refusal in
    `chat.prepare_turn` says exactly that. At the morning-of-2026-10-14
    defaults (cap 200원, fetch 1회 × 10,000토큰) every tool fits on every
    member-visible model: on Sonnet 5.5 the fetch reserve is ≈35원 and
    the search reserve ≈63원 (fees + 6,000 result tokens).
    """
    extra = 0
    if "web_search" in tools:
        extra += search_fee_krw(price, per_call_usd, search_max_uses)
        extra += price.worst_case_krw(search_max_uses * SEARCH_RESULT_RESERVE_TOKENS, 0)
    if "web_fetch" in tools:
        extra += price.worst_case_krw(fetch_max_uses * fetch_max_content_tokens, 0)
    if "code_execution" in tools:
        extra += price.worst_case_krw(CODE_RESULT_RESERVE_TOKENS, 0)
    return extra


def worst_case_extra_krw(
    price: Price,
    tools: tuple[str, ...],
    per_call_usd: Decimal,
    *,
    fetch_max_uses: int,
    fetch_max_content_tokens: int,
    search_max_uses: int = 5,
) -> int:
    """What the **wallet** pre-check adds on top of the token worst case.

    * web search — `max_uses` searches at the catalogue price (the result
      tokens ride inside the reply's own usage);
    * web fetch — the fetch cap: up to `max_uses × max_content_tokens`
      tokens entering the context, priced as plain input;
    * code execution — no fee of its own (free alongside the 20260209
      tools; the organisation's free container-hours otherwise), and its
      output is ordinary tokens.
    """
    extra = 0
    if "web_search" in tools:
        extra += search_fee_krw(price, per_call_usd, search_max_uses)
    if "web_fetch" in tools:
        extra += price.krw(fetch_max_uses * fetch_max_content_tokens, 0)
    return extra
