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

## Status

(filled in at step 6)
