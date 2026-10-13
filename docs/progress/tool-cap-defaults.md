# tool-cap-defaults — checklist

Owner decision 2026-10-14 (morning), pre-approved to merge when clean:
the per-reply cap stays strict; its default rises 100원 → **200원**; web
fetch becomes **1회 × 10,000토큰**, both admin-editable and audited; tests
prove 웹 검색 and 페이지 읽기 are usable at 200원 on every member-visible
model.

1. `chat_limits.DEFAULTS.reply_cap_krw` 100 → 200. **No data migration
   for the cap**: the table is never seeded (`current()` returns the
   code's defaults with no row — model docstring says so), so on the
   server and the dev DB the new default applies by itself; any existing
   row was written by an admin and is theirs.
2. `chat_limits` gains `web_fetch_max_uses` (default 1) and
   `web_fetch_max_content_tokens` (default 10,000): model columns,
   migration `c9f2e6a8d4b1` on head `a8d4f1c7e9b3` (server_default so
   existing admin rows get the new defaults; downgrade drops).
3. The limits flow everywhere the old constants were baked in:
   `ChatRequest.fetch_max_uses/_max_content_tokens` (set by
   `prepare_turn` from the current limits) → the real adapter's
   `web_fetch_20260209` block and the mock (its 500-token fetch result is
   capped by the setting); `chat_tools.cap_extra_krw` and
   `worst_case_extra_krw` take the two values as required kwargs.
4. Admin › System › 채팅 한도: two new fields, bounds in
   `ChatLimitsWrite` (1–5회, 1,000–100,000토큰), audit summary and
   before/after carry them.
5. Member copy quotes live values: `/api/chat/info` carries the fetch
   limits; `toolCostEffect` renders them (no hardcoded 2회/20,000토큰);
   the cap notice already interpolates the real cap.
6. Worst case recomputed (Sonnet 5.5, cache-write $2.50/MTok, 1,400원/$):
   fetch reserve = 1 × 10,000 tokens ≈ **35원**; search reserve = 3 fees
   (≈42원) + 6,000 tokens ≈ **63원**. Both leave output budget at a
   200원 cap on every member-visible model (Haiku, Sonnet) — pinned by a
   test iterating `visibility=members` rows; the refusal path pinned with
   a deliberately low cap.
7. Docs: owner-decision blocks appended to the token-guard and
   chat-plus-tools specs in done-specs; `docs/api-distribution.md`
   numbers updated.

## Status

(filled at the end of the loop)

## Status — loop results

- Branch from main `263a6ec`; merged main again after docs-cleanup landed
  (`fc01737`) — clean, docs edits applied on the new layout.
- Backend: full suite green with the PostgreSQL tests running
  (`ctrlai_tcd_test`); single Alembic head `c9f2e6a8d4b1`. Frontend: 350
  vitest, tsc 0, eslint 0 (one new exhaustive-deps warning introduced and
  fixed). `npm run build` not run here (worktree Turbopack) — run on main
  at merge.
- Browser check (preview 8250/3250, fresh DB on the amended chain, dev
  admin with an approved wallet): Admin › System › 채팅 한도 shows 200원
  and the two fetch fields (both themes); a 페이지 읽기 reply ran at the
  default cap end to end (tool event, source, receipt); a 30원 cap
  refused with "켜 둔 도구(페이지 읽기)의 최대 비용까지 치면 1회 비용
  한도(30원)에 닿아요…"; limits restored; preview servers stopped and the
  scratch credential files deleted.
- Decisions: no data migration for the 200원 default (the table is never
  seeded — any existing row is an admin's and stays theirs); the fetch
  bounds ride on each ChatRequest so the adapter, the mock and the cap
  arithmetic can never disagree with the setting.
