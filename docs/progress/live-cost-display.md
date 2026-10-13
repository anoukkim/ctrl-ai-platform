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
   `wallet_remaining_krw` (from `charge()`'s locked result);
   `MyQuarterProvider.applyWalletRemaining` patches the context without a
   fetch (the existing AnimatedNumber card animates). Stopped/error paths
   keep the existing refresh.
5. **A stopped or capped reply gets the same receipt**: capped replies
   end normally (the done event carries everything); a stopped reply's
   connection is gone, so the conversation is refetched shortly after and
   the persisted receipt (point 3) fills in.
6. **A failed call** shows "이 시도는 청구되지 않았어요." under the error.
7. **Tests**: the running figure never renders without 약; the receipt's
   numbers equal the usage event's; the wallet card changes without a
   reload; a failed call shows no charge. Backend tests for the start
   estimate, the done usage/wallet fields and the detail receipts.

## Status

(filled at the end of the loop)
