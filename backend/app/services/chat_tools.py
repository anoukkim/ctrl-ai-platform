"""Server tools in Chat (chat-plus-tools): which run, and what they cost.

Three Anthropic server tools — 웹 검색, 웹 페이지 읽기, 코드 실행 — each
switched on per catalogue model by an admin and per conversation by the
member, off by default. A tool is **sent only when both switches are on**;
turning a tool on or off changes the request's tool list, which breaks the
prompt cache, which is why the member's switch is per conversation.

The money side, same shape as everything else in `services/usage.py`'s
world: the fee is known exactly after the reply (billed searches × the
catalogue's per-search dollar price × the rate, rounded up), and the
pre-check adds the worst case before anything is spent — `max_uses`
searches plus the fetch cap priced as plain input. token-guard's per-reply
cap covers the fees too: the output budget shrinks by the worst-case tool
cost, so the cap means what it says with tools on.

Mock only until Phase 9: no real API call, no real fee. The request
mapping for the real tools lives in `claude_provider.server_tool_params`.
"""

from __future__ import annotations

from decimal import ROUND_CEILING, Decimal

from app.models import Conversation
from app.services.chat_models import ChosenModel
from app.services.claude_provider import (
    WEB_FETCH_MAX_CONTENT_TOKENS,
    WEB_FETCH_MAX_USES,
    WEB_SEARCH_MAX_USES,
)
from app.services.pricing import Price

#: Every kind there is, in display order.
KINDS: tuple[str, ...] = ("web_search", "web_fetch", "code_execution")


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


def cap_extra_krw(price: Price, tools: tuple[str, ...], per_call_usd: Decimal) -> int:
    """What token-guard's per-reply cap sets aside for tools: the fees.

    Only the deterministic part. Result tokens cannot be bounded by
    `max_tokens` — they arrive as *input* in the middle of the request,
    like a fetched page — so, exactly as with thinking tokens, the cap
    covers them at settle time: the reply is charged its real usage, and
    the next turn's input-over-cap refusal catches a conversation the
    results have made too dear. Subtracting the full fetch cap here would
    make 웹 페이지 읽기 unusable under the default 100원 cap.
    """
    if "web_search" in tools:
        return search_fee_krw(price, per_call_usd, WEB_SEARCH_MAX_USES)
    return 0


def worst_case_extra_krw(
    price: Price, tools: tuple[str, ...], per_call_usd: Decimal
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
    extra = cap_extra_krw(price, tools, per_call_usd)
    if "web_fetch" in tools:
        extra += price.krw(WEB_FETCH_MAX_USES * WEB_FETCH_MAX_CONTENT_TOKENS, 0)
    return extra
