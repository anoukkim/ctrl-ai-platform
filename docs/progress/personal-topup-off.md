# personal-topup-off — checklist

Owner decision 2026-10-14 (overnight batch, PART A2; pre-approved to merge
when clean): personal top-ups (개인 충전) are not offered. Members see
only the 동아리 지원 wallet. Keep tables and code; no migration that
drops data.

1. One setting `PERSONAL_TOPUP_ENABLED` (default **false**, in
   `.env.example`); `Settings.top_ups_enabled` now reads it, and the beta
   still forces it off.
2. The backend top-up and personal-spend routes refuse with a Korean
   message in **every** environment while off (the message no longer says
   베타).
3. `charge()` / `ensure_affordable()` never use personal money while off
   — an earlier opt-in and a real balance change nothing; the refusal is
   the short "이번 분기 지원금이 부족합니다." without the 개인 사용
   advice. Settings threaded through all 8 call sites.
4. Members are not shown a personal balance at all: `/api/usage/me` and
   `/api/quarters/me` return `personal: null` while off; the Usage 개인
   잔액 block is gone; the Usage page copy mentions only the wallet.
5. Admin › Top-ups hidden (`sections.ts` `hidden: true`); the dashboard's
   손이 필요한 일 card and the sidebar Admin badge no longer count
   top-ups (counts only for visible sections). The route and screen stay
   in the code; old pending requests can still be settled at
   `/admin/topups` directly.
6. Withdrawal: the 환불 대기 copy on the member screen already appears
   only when an existing balance or unreviewed request makes it true
   (`preview.refund_hold`). **Decision:** it is kept for that case —
   hiding a true "your money becomes 환불 대기" from a member who has
   money would mislead them; with top-ups off nobody can acquire a new
   balance, so it never shows for anyone else. The backend refund logic
   is untouched, as the owner asked.
7. Docs: CLAUDE.md §1 (decision row), §9 (Usage example + rules), §12
   (Top-ups hidden), §14 (models marked kept-but-off), §15 (eleven
   visible sections); `docs/product.md` (route table, nav list, search
   table, withdrawal note). Backlog item **personal-topup-ui** added
   under After the beta (in the earlier docs commit on main).
8. Tests: new `tests/test_personal_topup_off.py` (setting off by default
   in every env; charge/ensure_affordable/cap_to_available never touch
   personal money; the spend switch 403s; members see `personal: null`).
   Existing kept-machinery tests now run with the switch on
   (`TOPUPS_ON` / `topups_on` fixtures); beta tests assert the beta
   refusal even with the switch on; `admin-sections` counts eleven.

## Status

(filled at the end of the loop)
