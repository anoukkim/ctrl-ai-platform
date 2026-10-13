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
2. ✅ `docs/index.html` + `docs/.nojekyll` removed. Owner turns Pages off
   (settings note above).
3. ✅ Autouse `isolated_storage` fixture in `tests/conftest.py` redirects
   every test's storage to its tmp dir (the leaks were test_video.py and
   test_membership_access.py — five GIFs); a session guard mirrors the
   database guard and fails the run on any change to the real dir
   (proven with a deliberate probe write, exit 1).
4. ✅ `httpx2` pinned in `requirements.txt`; requirements-dev notes the
   move; `tests/test_runtime_requirements.py` walks every import under
   `app/` (ast, function-level included) and refuses any third-party
   module requirements.txt does not cover.
5. ✅ Both scripts already refused APP_ENV=beta/production (tested in
   test_beta_launch.py). New gap closed: `DEPLOYED=true` (production
   compose) now refuses both even with APP_ENV mis-set to development,
   with tests.

## Loop results — 2026-10-14

- Backend: 642 tests, full suite green on the throwaway PostgreSQL
  (`ctrlai_a1_test` on ctrlai-run-pg:55433); the storage guard confirms
  no `backend/var/storage` was created.
- Frontend: 322 vitest in 30 files, green. `tsc --noEmit` 0, `eslint` 0.
- `npm run build` cannot run in this worktree: Turbopack refuses the
  node_modules junction ("Symlink points out of the filesystem root").
  tsc covers the types; the build must be re-run on `main` after the
  merge (the run's loop re-runs step 4 on main anyway).
- Browser check skipped deliberately: the only screen change is Profile,
  covered by `profile-own-data.test.tsx`, and a live server would have
  needed the real dev database.
- One fixture iteration: the storage override is copied **per request**,
  so tests that monkeypatch the cached settings object (app_env) keep
  working.
