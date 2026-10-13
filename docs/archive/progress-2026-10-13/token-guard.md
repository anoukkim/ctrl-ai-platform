# token-guard — checklist

Next item 7 (owner, 2026-10-13). Branch `feat-token-guard`. A per-reply
cost cap enforced through `max_tokens`, a long-conversation warning with
the saving of starting fresh, and an optional daily cap per member.
Stopped replies keep today's rule (saved, charged for tokens used).

1. `chat_limits` table (history rows like `exchange_rates`: a new row per
   change, current = newest; defaults in code when the table is empty):
   `reply_cap_krw` (default 100), `long_history_tokens` (default 8,000),
   `daily_cap_krw` (default 0 = off). Alembic migration on
   `c4d8e2a6f1b9`, single head.
2. `services/chat_limits.py`: `current()`, `output_budget()` (output
   tokens the cap still buys after the calibrated input, input priced as
   a cache write when caching is on — the same worst case as the
   pre-check), `history_cost_krw()` (cache-read price where caching is
   on, so the saving is not overstated), `daily_spent_krw()` (KST day).
3. `prepare_turn`: cap-derived `max_tokens` = min(global limit, what the
   cap buys); `PreparedTurn.reply_cap_krw` records when the cap (not the
   global limit) decided. Input alone over the cap → ChatRefusal, nothing
   spent, with the new-conversation suggestion.
4. Capped reply: saved and charged as any `max_tokens` ending (TRUNCATED);
   `chat_messages.capped_krw` (nullable) marks it so the screen shows the
   notice after a reload too, and the member's own 중지 is unchanged.
5. Daily cap: checked in `usage.ensure_affordable` (the pre-check every
   paid feature passes), KST day from `UsageEvent.created_at`, Korean
   refusal before anything is spent. `charge()` deliberately unchecked:
   it settles work the club already paid for.
6. Long-history warning: `ConversationDetail.long_history` and the SSE
   `done` event carry {history_tokens, extra_krw} when the
   calibrated input estimate passes the threshold; the composer shows
   "대화가 길어져 답장마다 약 N원이 더 들어요…" with a 새 대화 button.
7. Admin › System: 채팅 한도 card (three figures, audited like the
   exchange rate: `chat_limits.set`, before/after in detail).
8. Mock provider honors `max_tokens` (1 char = 1 token, like its usage
   figures), ending with `stop_reason: "max_tokens"` — the capped flow
   runs end to end with no key.
9. Tests (spec point 6): max_tokens derivation; capped reply saved,
   charged real usage, carries `capped_krw`; input over cap refused free
   with no provider call; warning figures; daily cap across features and
   the KST midnight boundary; settings audited.
10. Frontend: capped notice (reload-safe via `capped_krw`), warning +
    새 대화, Admin card; vitest for the notice and the warning.

## Status — loop results

- Backend: full suite green with the PostgreSQL tests actually running
  (`ctrlai_tg_test` on the throwaway 55433 server — note its real
  password comes from the container env, not `ctrlai`). Frontend: 331
  vitest (32 files), tsc 0, eslint 0. `npm run build` not run here —
  Turbopack refuses a junctioned node_modules; the main session builds
  on main after merging.
- Browser check on a preview (backend 8210 on `ctrlai_preview_tg`,
  frontend 3210, dev seed + approved 80,000원 wallet): with a 7원 cap a
  real streamed reply stopped at the cap — saved as truncated, charged
  exactly 7원, the notice under the bubble; the long-history warning with
  its figure and a working 새 대화 시작 link above the composer; Admin ›
  System shows the 채팅 한도 card (three fields, last-change line) in
  light theme; daily cap 5원 refused the next send with 402 "오늘 쓸 수
  있는 금액(5원)을 넘어요…"; no console errors. Servers stopped after.
- API checks: POST /chat-limits audited (chat_limits.set), history kept
  as rows; input alone over a 1원 cap refused free with no provider call.

