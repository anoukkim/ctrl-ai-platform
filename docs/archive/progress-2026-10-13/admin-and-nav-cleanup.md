# admin-and-nav-cleanup — checklist

Branch `feat-admin-and-nav-cleanup`. Spec: `docs/BACKLOG.md` ›
admin-and-nav-cleanup (owner, 2026-10-14).

## Requirements

1. Report Issue out of the Account menu; `/issues` removed and redirected to Chat (`/`).
2. 의견 보내기 (sidebar footer) stays the one way to send feedback; no screen still points members to Report Issue.
3. anonymous-feedback-board spec: no menu item, no `/issues`; its member board is a page reached from "다른 의견 보기" inside the 의견 보내기 dialog.
4. CLAUDE.md §1 and §15, `docs/product.md`, `sections.ts` updated.
5. Dev Tools gone from Admin: section, page, tab. `/admin/dev` no longer exists.
6. `POST /api/admin/simulate-usage` removed (no test needs it beyond its own); its client function and tests go; `python -m app.db.reset_dev` stays.
7. AI Models table: one control per cell in 공개 범위 (badge, select and 기본으로 no longer share a cell); nothing overlaps at 1280 and 390 px; the table scrolls inside its own box; both themes.
8. "Claude Models" → **AI Models**; `/admin/claude-models` redirects to `/admin/ai-models`.
9. Grouped by provider with a heading each, Anthropic (Claude) first.
10. "+ 모델 추가" asks for the provider first.
11. A provider with no adapter is shown as 연결 준비 중; its models cannot be made visible (members or admin-only) or default — enforced in the backend, tested.
12. docs-deepseek merged (research only); deepseek-research moves to Done.
13. DeepSeek provider entry (연결 준비 중) with the recommended model, research prices, visibility disabled; no adapter, no DeepSeek call.
14. Every test that counts Admin sections updated; CLAUDE.md §15 section list.

## Status — self-review against the diff

1. ✅ `frontend/app/components/AppShell.tsx` (item gone); `frontend/app/issues/page.tsx` → `redirect("/")`; its CSS deleted.
2. ✅ Builder/Video error copy now says ‘의견 보내기’; `FeedbackButton` comment; nothing else names Report Issue.
3. ✅ `docs/BACKLOG.md` › anonymous-feedback-board — "Owner decision — 2026-10-14" block.
4. ✅ CLAUDE.md §1 (decision table names) and §15 (Account list, Admin list of twelve, AI Models note); `docs/product.md`; `sections.ts`.
5. ✅ `frontend/app/admin/dev` deleted; section removed from `sections.ts`; Dev Tools CSS removed.
6. ✅ `admin_quarters.py` route, `SimulateUsageRequest`, `simulateUsage()` and the simulator's own tests removed (no other test used it); `USAGE_SIMULATED` kept so old audit rows still read; CLAUDE.md Phase 1c note updated; `reset_dev` untouched.
7. ✅ `ModelCatalog.tsx` — 공개 범위 is the select alone (`.visibilitySelect` width auto), 기본 is the badge or the button; Playwright asserts no overlapping boxes and one control per cell at 1280/390 in both themes. Root cause of the overlap/overflow: the admin frame grid sized to the table's min-content — fixed with `minmax(0, 1fr)`.
8. ✅ `sections.ts` key `ai-models`, `/admin/ai-models`; `/admin/claude-models` → redirect.
9. ✅ `groupByProvider` with the backend's provider order (`GET /api/admin/chat-models/providers`), Anthropic first.
10. ✅ `NewModelForm` shows only the provider select until one is chosen.
11. ✅ `chat_models.check_open` in create and update (before the other default/visibility checks); tests `test_a_model_of_a_provider_not_connected_cannot_be_opened_or_made_default`, `test_a_model_added_for_a_provider_not_connected_starts_and_stays_closed`.
12. ✅ `docs-deepseek` merged into this branch (`--no-ff`); deepseek-research moves to Done with this item.
13. ✅ Migration `c4d8e2a6f1b9` and `PENDING_CATALOGUE`: `deepseek/deepseek-v4.1-flash`, $0.30 / $1.20, disabled; no adapter, `KNOWN_PROVIDERS` still Anthropic only.
14. ✅ `admin-sections.test.ts`, `beta-launch.test.tsx`, `sidebar-collapse.test.tsx`, `test_membership_access.py`, `test_chat_models.py`.

Also: vitest `testTimeout` 15 s — three tests that import a whole screen inside the test timed out at 5 s when the full suite ran cold on this machine (main too), and passed alone.

## Review round 1 — 2026-10-14 (independent subagent)

No blocking findings. 10 points, all addressed:

1. BACKLOG › anonymous-feedback-board summary rewritten to the 2026-10-14
   decision (no menu item, no `/issues`, board via "다른 의견 보기").
2. deepseek-research moved to Done (row in done.md, spec to done-specs.md,
   Next renumbered, Merge order section removed, intro note updated).
3. The "Owner decision — 2026-10-14" heading moved below the 2026-10-13
   list's "Points 2–6 stand" bullet it had split.
4. Stale wording: `.env.example` says AI Models; `models/feedback.py`
   docstring no longer describes Report Issue.
5. New `__tests__/ai-models-catalog.test.tsx`: grouping (Anthropic first,
   연결 준비 중 badge), closed not-ready rows fully locked, a stray open
   row can still be closed, + 모델 추가 asks the provider first.
6. DeepSeek seed and migration now carry cache read $0.006 (research:
   Together and Fireworks both list it) instead of the null → $0.03 rule.
7. Note under more-chat-providers: the row's provider id `deepseek` vs
   "whose API serves it" — decide keep-or-migrate when the adapter lands.
8. Model-ID error copy names 슬래시(/), which the regex already allowed.
9. A stray open row of a not-ready provider keeps its visibility select
   enabled with only 사용 안 함 offered, so it can be closed.
10. NewModelForm's not-ready note starts "이 제공자는…" (no 은(는) after a
    parenthesised label).

Also from the reviewer: the local dev PostgreSQL has migration drift
(invite_codes ran with its pre-merge down_revision, so alembic believes
prompt-caching/feedback ran when they did not). Not a branch bug; fixed
locally by `python -m app.db.reset_dev` + `alembic upgrade head` before
the browser checks (the owner's overnight instructions end with a fresh
dev seed anyway).
