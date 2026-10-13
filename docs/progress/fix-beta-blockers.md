# fix-beta-blockers — checklist

Branch `feat-fix-beta-blockers`. PART A1 of the owner's overnight batch
(2026-10-14): five blockers before the beta. Merge pre-approved when the
loop is clean.

1. Profile shows only the signed-in member's own data: the mock "yurikim"
   apps are gone; the 내가 만든 앱 card is an honest empty state (준비 중,
   Phase 5) for everyone. `MOCK_APPS` stays only on the CtrlAIApps
   placeholder screens (Phase 5) and their tests.
2. `docs/index.html` and `docs/.nojekyll` (old ui-polish prototype, 3 MB)
   removed. **Owner:** turn off GitHub Pages at
   github.com/anoukkim/ctrl-ai-platform → Settings → Pages → Build and
   deployment → Source → **None** (I cannot and did not change repo
   settings).
3. No test writes into the real `backend/var/storage`: tests use a
   temporary storage dir, and a guard fails the run if the real dir
   changes.
4. `httpx2` pinned in `requirements.txt` (it is imported at runtime by
   the Anthropic adapter), with a test that the runtime requirements
   cover it.
5. `python -m app.db.init_db` (seed path) and `python -m app.db.reset_dev`
   refuse to run outside development (beta/production), with tests.

## Status

1. ✅ `frontend/app/profile/page.tsx` — mock path removed, EmptyState
   always, section-level 준비 중 badge; stale QUARTER_RANGE docstring
   fixed; page-level 준비 중 badge removed (the page is real data now).
   Test `__tests__/profile-own-data.test.tsx`.
2. ⏳
3. ⏳
4. ⏳
5. ⏳
