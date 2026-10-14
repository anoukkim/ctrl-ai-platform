# live-cost-display — checklist

Next item 8 (owner, 2026-10-13; built in the 2026-10-14 overnight batch).
Spec: BACKLOG › "live-cost-display — full spec". Branch
`feat-live-cost-display` from main `767d88a` (token-guard merged).

1. **While streaming**: "약 N원" beside the reply, updated as text
   arrives. The backend's `start` event carries `estimate`
   (`base_krw` — the calibrated input side priced the way the pre-check
   prices it, cache-write when caching is on — and `won_per_1k_output`);
   the client adds `tokens(streamed text) × rate` (1 char = 1 token, the
   same rule as `pricing.estimate_tokens`). Always labelled 약; updated
   at most a few times a second.
2. **When it ends**: the `done` event gains `usage` (`input_tokens`,
   `output_tokens`, `cache_write_tokens`, `cache_read_tokens` — null
   cache fields when caching is off, matching the ledger row) and the
   receipt renders 입력 / 출력 / 캐시 읽기 / 합계 — the 합계 is
   `charged_krw`, the **ledger's figure**, replacing the estimate.
3. **Reload**: conversation detail attaches each reply's `receipt` from
   its usage event (one query; no schema change), so receipts survive a
   reload.
4. **Sidebar wallet updates at once**: the `done` event carries
   `wallet_remaining_krw` — only for a **community-funded** charge (a
   personal-funded one carries null, so the screen refetches and the
   personal figures stay fresh); `MyQuarterProvider.applyWalletRemaining`
   patches the context without a fetch and reports whether it could —
   when it could not (still loading, no wallet), and on every stopped,
   disconnected and settle path, the screen falls back to `refresh()`.
   A true server error charges nothing, so it refreshes nothing.
5. **A stopped or capped reply gets the same receipt**: capped replies
   end normally (the done event carries everything); a stopped reply's
   connection is gone, so the conversation is refetched shortly after and
   the persisted receipt (point 3) fills in.
6. **A failed call** shows "이 시도는 청구되지 않았어요." under the error.
7. **Tests**: the running figure never renders without 약; the receipt's
   numbers equal the usage event's; the wallet card changes without a
   reload; a failed call shows no charge. Backend tests for the start
   estimate, the done usage/wallet fields and the detail receipts.

## Status — loop results

- Backend: full suite green via the throwaway PG (ctrlai_lcd_test on
  55433, real container password — PG row-lock tests ran, no skips) with
  DATABASE_URL on a dead port. 5 new tests in test_live_cost.py.
- Frontend: 338 vitest green (33 files; 7 new in live-cost.test.tsx —
  one pre-existing SSE-shape assertion extended for the new null fields),
  tsc 0, eslint 0. `npm run build` not run here (worktree); run on main
  at merge time.
- Browser (preview 8220/3220, practice DB ctrlai_preview_lcd, approved
  80,000원 wallet): while the mock streamed, 약 9원 → 약 11원 beside the
  bubble; on finish the receipt replaced it (입력 1,836토큰 · 출력
  150토큰 · 캐시 읽기 0토큰 · 합계 9원); the sidebar quarter card and
  남은 지원금 went 80,000원 → 79,991원 → 79,986원 **without a reload**;
  the second reply's receipt showed 캐시 읽기 1,836토큰 at 합계 5원 —
  the cache visibly saving money. Receipts still there after a reload
  (detail enrichment), light and dark themes both checked; preview
  servers stopped, helper scripts deleted.
- Design note: a **stopped** reply cannot receive the done event (the
  member cut the connection), so the screen refetches the conversation
  ~0.9s later and the persisted receipt fills in; if the member has
  already moved to another conversation nothing is overwritten
  (activeIdRef guard).

## Review round 2 — fixes

1. A client-side stream loss is its own outcome (`disconnected`), treated
   like 중지: the backend's detached task **does** save and charge what
   streamed, so the "이 시도는 청구되지 않았어요" note now appears only
   for a server-sent `error` event (nothing charged, by construction).
   The member sees "연결이 끊어졌습니다. 여기까지 온 답장은 저장되고, 쓴
   만큼만 차감됩니다."
2. The late settle no longer replaces the whole thread: it finds the
   reply saved **after my message** (`savedUserId` from the start event)
   and swaps only that bubble, so a message sent in the same conversation
   within 0.9s survives; when settlement is slower it retries at 0.9s /
   1.5s / 3s and leaves the partial text alone until the saved version
   exists.
3. `wallet_remaining_krw` only for community-funded charges (above).
4. No ledger row (quarter closed mid-stream) → no `usage`, so no 0원
   receipt that a reload would contradict.
5. `applyWalletRemaining` returns whether it applied; the done path falls
   back to `refresh()` when it could not.
6. Switching conversations within the settle window still refreshes the
   wallet, just never touches the other conversation's screen.

Tests added: disconnected (no not-charged note; settle fills the
receipt), the same-conversation re-send race, the slow-settlement retry,
the apply-fallback, personal-funded `wallet_remaining_krw: null`
(backend), and no-ledger-row → no receipt (backend). Suites re-run green:
backend full (PG tests running), frontend 342 vitest, tsc 0, eslint 0.
