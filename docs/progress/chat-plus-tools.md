# chat-plus-tools — checklist

Next item 8 · branch `feat-chat-plus-tools` (on top of `feat-live-cost-display`).
Owner rules of 2026-10-14 win over the 2026-10-07 spec: **mock tools only**
(no real API call, no real fee), per-model admin switches + per-conversation
member toggles (off by default, cost shown first), fees inside token-guard's
cap and on the receipt, tool status lines while running, sources as links,
code execution never on our server.

1. Migration (head `b5d7f3a2c8e1`): `chat_models.tools_web_search/_web_fetch/
   _code_execution` (false) + `web_search_usd_per_call` (0.01 $);
   `conversations.use_web_search/_web_fetch/_code_execution` (false);
   `chat_messages.sources` (JSON); `usage_events.web_search_count`,
   `tool_fee_krw`.
2. Provider shapes: `ChatRequest.tools` (kinds); `ToolStatus` and
   `ToolSources` stream events; `UsageUpdate.web_search_count`. The real
   adapter maps kinds → `web_search_20260209` (`web_search_20250305` on
   Haiku, no dynamic filtering), `web_fetch_20260209` (max_uses 2,
   max_content_tokens 20,000), `code_execution_20260521` — written, never
   called for real.
3. Mock: deterministic triggers (검색 → two searches with sources; a URL →
   fetch; 실행/계산 → code output; 검색 오류 → tool error, Korean notice,
   tokens-only charge); result tokens added to input; honors the cap.
4. `prepare_turn`: effective tools = conversation flag AND model flag;
   worst case += 3 × search price + 2 × 20,000 input tokens (fetch cap);
   token-guard's cap covers tool fees (output budget shrinks; input+fees
   over the cap refuses free).
5. `finish_turn`: fee = searches × catalogue `web_search_usd_per_call` ×
   rate (ceil); charged = token KRW + fee; `UsageEvent.web_search_count` /
   `tool_fee_krw`; sources saved on the reply; receipt and `done.usage`
   carry the fee and count.
6. Routes: conversation PATCH toggles (400 for a tool the model does not
   allow); detail/read carry the flags and sources; `ChatModelOption`
   carries allowances + per-search KRW; `ChatMessageCreate` forbids extra
   fields (a member-supplied file id is a 422).
7. Admin › AI Models: per-model tool switches + per-search price in the
   editor (audited like every other field).
8. Member UI: toggle chips by the model picker, ConfirmDialog with the
   cost before enabling; "검색 중… / 페이지 읽는 중… / 코드 실행 중…"
   while running; numbered source links with domains; receipt line
   "검색 N회 M원".
9. docs/deployment.md: what changes when CLAUDE_PROVIDER=anthropic (real
   per-search fees; how to keep tools off).
10. Tests — spec list: tool sent only when model AND conversation allow;
    Haiku gets the 20250305 search; searches charged at the catalogue
    price; pre-check includes max_uses; member file id refused; tool error
    → Korean + tokens-only; mock covers search/fetch/code. Plus: cap
    includes fees; receipt shows them; per-conversation toggle warns.

## Status

(filled at the end of the loop)
