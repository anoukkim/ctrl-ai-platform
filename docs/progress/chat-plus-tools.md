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

## Status — loop results

- Backend: full suite green (SQLite fixtures; a separate run with the
  throwaway PG on `ctrlai_cpt_test` ran the row-lock tests — the single
  failure in a PowerShell-driven run was the known console-encoding flake
  in `test_the_run_refuses_to_start_on_the_developer_database`, which
  passes under Bash, the normal runner). 12 new tests in
  `test_chat_tools.py`; live-cost assertions extended for the receipt's
  검색 fields. Migration `d9e2f7a4c3b8` ran on PostgreSQL
  (`ctrlai_preview_cpt`), chained after `b5d7f3a2c8e1`.
- Frontend: 345 vitest (7 new in `chat-tools.test.tsx`), tsc 0, eslint 0.
  `npm run build` not run in the worktree (Turbopack) — run on main at
  merge time.
- Browser (preview 8230/3230, practice DB, dev admin with an approved
  80,000원 wallet): Admin › AI Models editor shows the 도구 checkboxes
  and 검색 1회 요금 field; saving opened all three on Sonnet (audited).
  In Chat the three chips appear by the model picker; clicking 웹 검색
  opened the cost dialog and 켜기 turned it on; a 검색 message produced
  sources as numbered domain links (data.seoul.go.kr · kosis.kr ·
  yna.co.kr) and the receipt "… · 검색 2회 28원 · 합계 39원"; the
  sidebar wallet moved to 79,927원 without a reload. Dark and light; no
  console errors; no sideways scroll. The 검색 중… line transitions too
  fast to catch with the mock's delays — its rendering is pinned by
  vitest.

## Decisions

1. **The cap reserves every enabled tool's full worst case**
   (`chat_tools.cap_extra_krw`, review round 2 — replaces round 1's
   fees-only design): the owner's rule says the cap includes tool fees
   AND result tokens, and result tokens land as input outside
   `max_tokens`' reach, so the only honest enforcement is an up-front
   reserve — 3 × fee + 3 × 2,000 result tokens for search, 2 × 20,000
   tokens for fetch, 1,000 tokens for code output (documented constants).
   A tool whose worst case alone reaches the cap is **refused free**,
   naming the tool and saying the admin can raise the 1회 비용 한도 —
   deliberately, 웹 페이지 읽기 is unusable at the default 100원 cap
   (≈250원 covers it on Sonnet). Tool results are billed once, inside
   this reply; they are **not** persisted or re-sent on later turns. The
   **wallet** pre-check keeps its own full worst case.
2. Tool toggles appear once the conversation exists (after the first
   message) — the toggle is the conversation's, and a brand-new chat has
   no row yet. Turning a tool **off** never needs the model's permission.
3. The member payload is `extra="forbid"` — the file-id refusal is a 422
   at the schema, not a string scan.
4. The mock's triggers: 검색 (two billed searches), a URL (fetch), 실행/
   계산 (code output), 검색 오류 (a tool error charged tokens only).

## Review round 2 (coordinator, enforcing the owner's cap rule)

1. The cap now reserves each enabled tool's **full worst case** (fees +
   result-token reserves; constants documented in `chat_tools.py`); a
   tool over the cap is refused free, naming the tool and that the admin
   can raise the 1회 비용 한도. Pinned by tests: a tooled reply's final
   charge ≤ the cap; 페이지 읽기 refused at the default 100원 cap.
2. The false "results are re-billed next turn" narrative removed from
   `chat_tools.py`, `claude_provider.py`, the toggle copy, deployment.md
   and this file — results are billed once, inside the reply; they are
   never persisted or re-sent.
3. The running 약 N원 jumps when a tool use completes: the done `tool`
   SSE event carries `added_krw` (result tokens priced + fees); backend
   and vitest tests pin it. The ledger's receipt still settles.
4. Source URLs are filtered to http/https **at save** (`_safe_sources`);
   a doctored `javascript:` source is dropped (tested).
5. `usage_events.web_fetch_count` added — **migration `d9e2f7a4c3b8`
   amended in place** (unmerged, so allowed; any scratch DB that ran the
   old version must be recreated). The mock prompt cache keys on the
   tool list, so toggling a tool breaks the cached prefix in test mode
   (tested); the real adapter handles `web_fetch_tool_result.content`
   being a single object, emits ToolStatus "error" for error blocks and
   counts fetches; duplicate source URLs no longer collide as React keys.
6. Browser re-check (preview 8230/3230, fresh DB on the amended
   migration): 페이지 읽기 at the default cap refused with the exact
   Korean message; after the admin raised the cap to 500원 the fetch ran
   (source "1. example.com", receipt 합계 10원, no 검색 line); the
   toggle dialog shows the corrected cost copy.
