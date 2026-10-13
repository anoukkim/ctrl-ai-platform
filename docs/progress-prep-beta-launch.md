# prep-beta-launch — progress

Branch `feat-prep-beta-launch`. Nothing is pushed or merged. Work stopped
on 2026-10-13 and **resumed the same day; every item under "Left" below is
now done** and the branch is waiting for the developer's check. Delete
this file when the item merges.

**Resumed 2026-10-13 — done since the stop:**

- The production compose ran locally (`-p ctrlai-prodtest`, 8080/8443):
  all four services healthy (~280 MB memory in total); migrations and
  `bootstrap` (twice — the second left the admin alone); `init_db`
  refused (`APP_ENV is 'beta'`); `/` 200; `/api/site` `is_beta: true`
  with the Korean notice intact through `env_file`; `/docs` and
  `/api/openapi.json` 404; HTTP → 308 to HTTPS; `www` → 301 to the apex;
  HSTS, nosniff, Referrer-Policy and X-Frame-Options present; the session
  cookie `Secure; HttpOnly; SameSite=lax`; top-up 403 in Korean;
  simulator 404; feedback saved and listed; a mock chat reply streamed
  through Caddy and Next.js (first byte 75 ms, last 438 ms — not
  buffered) and charged 7원; `pg_dump` → restore with `ON_ERROR_STOP`
  worked; `anonymise_withdrawn --dry-run` ran. Torn down with
  `down -v` (that project's volumes only).
- `docs/dns-for-domain-owner.md` written (Korean).
- README documents `reset_dev`; `docs/development.md` documents
  `reset_dev`, `bootstrap` and the local production run.
- `docs/deployment.md` checked against Google Cloud's free-trial page
  (stop at the end, 30-day grace, the **Activate** button, credits usable
  within the 90 days) and Anthropic's billing help (auto-reload and spend
  limits on the Billing page); cost figures marked as estimates.
- `docs/ROADMAP.md` M1 line.
- Full verification — results in the final report.

## Done

**Backend** (commit `feat(beta): APP_ENV=beta, startup refusals, …`)

- `APP_ENV=beta` as a third environment. `Settings.is_beta`,
  `top_ups_enabled` (false in beta), `deployed` (set by the prod compose).
- Startup refusals (`Settings.startup_problems()`, checked in `app.main`):
  a real provider without its key; `APP_ENV=development` on a deployed
  server; outside development, an `ADMIN_PASSWORD` that is a known default
  (devpassword, admin, password, memberpassword, changeme, the
  `.env.example` placeholder `change-me-before-deploying`) or shorter than
  12 characters; outside development, the development database password
  (`ctrlai`, `postgres`, `password`, empty).
- API docs (`/docs`, `/redoc`, `/openapi.json`) only in development.
- `GET /api/site` (no guard): environment, beta flag, top-ups flag,
  `DATA_LOCATION_NOTICE`, and which screens get the test-mode label.
- Top-ups refused in beta: member request (403), switching personal
  spending on (403), admin confirming (403; rejecting still works).
- Feedback: `feedback` table (migration `d4f7a1c9e2b5`, revises
  `c6e2d8a4f913`), `POST /api/feedback` (`get_current_user`, 2,000 chars,
  20 per hour counted from rows), `GET /api/admin/feedback`.
- `python -m app.db.bootstrap`: the admin from `ADMIN_*` plus the video
  model catalogue, nothing else; refuses a default/short password and a
  database that holds the dev account (a copied local DB).
- `python -m app.db.reset_dev [--yes]`: development + localhost only;
  drops the schema, migrates, empties local storage, runs the dev seed.
- `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`, `SESSION_COOKIE_DOMAIN` (blank =
  host-only).
- Access table (`docs/architecture.md`) and `EXPECTED_GUARDS` updated.
- `tests/test_beta_launch.py`. Full backend suite: **514 passed, 1 skipped**
  at the first commit (before the DB-password check; that file and
  `test_config.py`, `test_chat.py` passed after it).

**Frontend** (commit `feat(beta): beta banner, test-mode labels, …`)

- `SiteProvider` + `lib/site.ts`; `BetaBanner` on every page in beta
  (`--banner-h` subtracted by every 100vh rule in the shell).
- `TestModeNotice` "테스트 모드 – 실제 AI 결과가 아닙니다" on Chat, Project
  Builder (library + workspace), Video Generator (library + workspace);
  "테스트 모드 – 실제 회원 작품이 아닌 예시입니다" on CtrlAIApps and CtrlAITube.
  Shown only when the backend says so (mock provider and not development).
- 의견 보내기: sidebar footer icon, the banner, and Report Issue (replaces
  its "준비 중" placeholder). Admin › **Feedback** section (`sections.ts`;
  CLAUDE.md section 15 list updated to thirteen).
- Sign-up shows the data-location notice.
- Usage and Admin › Top-ups say top-ups are off in beta.
- `__tests__/beta-launch.test.tsx`. Frontend: **264 passed**; `tsc` and
  lint clean (before the standalone change below).

**Deployment files** (WIP commit)

- `backend/Dockerfile`, `frontend/Dockerfile` (standalone,
  `BACKEND_ORIGIN` build argument), `.dockerignore`s,
  `next.config.ts` `output: "standalone"`. **Both images build locally.**
- `docker-compose.prod.yml` (caddy, web, api, db — no db port, log
  rotation, memory limits, api healthcheck; forces `DEPLOYED`,
  `DATABASE_URL`, `SESSION_COOKIE_SECURE`, `STORAGE_DIR`),
  `docker-compose.build.yml`, `deploy/Caddyfile` (www → apex, security
  headers, `MAX_UPLOAD_MB`).
- `deploy/backup.sh`, `update.sh`, `daily-jobs.sh` (executable in git),
  `.gitattributes` keeping them LF.
- `.github/workflows/images.yml`: tests, then api/web images to ghcr.io
  on push to `main`.
- `.env.example`: `[SERVER]` markers, e2-medium sizes, `SITE_DOMAIN`,
  `IMAGE_PREFIX`/`IMAGE_TAG`, `DATA_LOCATION_NOTICE`, the admin
  placeholder. `.gitignore` ignores `*.sql`, `*.sql.gz`.
- Docs: BACKLOG *Hosting decisions — 2026-10-13* (replaces the
  cloud-neutral note and the e2-micro decisions), item 12 and the old
  working-order line; CLAUDE.md Phase 9 note; `docs/architecture.md` beta
  hosting. `grep` for e2-micro / Always Free / us-*1 now finds nothing in
  those files.

## Half-done

- **`docs/deployment.md`** — full Korean draft written (sections 0–13 and
  a developer appendix). Needs one read-through and these checks before it
  is final:
  - Google's wording for what happens after the free trial (the "30 days
    to upgrade" figure) and the console button names (Upgrade / 전체 계정
    활성화) — confirm against current Google Cloud docs.
  - Anthropic Console names (Limits, Auto-reload) — confirm.
  - Cost figures are estimates (e2-medium ≈ $32 from the owner; disk,
    IP and the ₩60,000 budget are mine) — say so or confirm in the
    pricing calculator.
  - Steps 3-7/3-8 assume the images exist, i.e. this branch merged and the
    workflow ran once.
- **Local production run** — images are built (tagged
  `ghcr.io/anoukkim/ctrl-ai-platform-{api,web}:latest` locally), but the
  stack has **not been started yet**. The env file for it,
  `prodtest.env`, was in the session scratchpad (outside the repo, not
  committed) and will need recreating — the recipe is the appendix of
  `docs/deployment.md`.

## Left, in order

1. **Run the production compose locally** (appendix of
   `docs/deployment.md`, project `-p ctrlai-prodtest`, ports 8080/8443):
   `up -d --build`, `run --rm api alembic upgrade head`,
   `run --rm api python -m app.db.bootstrap`, then check:
   `curl -k https://localhost:8443/` (200, Korean page),
   `/api/site` (`is_beta: true`), `/docs` → 404 through Caddy,
   `http://localhost:8080` → redirect, sign in as the bootstrap admin,
   send a mock chat message (SSE streams through Caddy + Next), feedback
   saved, `deploy/backup.sh`-style `pg_dump` works, `dc ps` shows no db
   port. Also confirm the Korean `DATA_LOCATION_NOTICE` survives
   compose's `env_file` parsing. Then `down -v` (only that project's
   volumes).
2. **`docs/dns-for-domain-owner.md`** (Korean): `@` A `34.47.78.228`,
   `www` CNAME `ctrlai.my`; remove parking/forwarding and any existing
   A/AAAA for `@`/`www`; no `api` record; leave MX alone; TTL; checks with
   `nslookup … 8.8.8.8` and a web DNS checker; what "working" looks like.
3. **README** — document `python -m app.db.reset_dev` (a Launch data
   rule asks for this explicitly), point "Deployment" at the guide.
   **`docs/development.md`** — `reset_dev`, `bootstrap`, the local prod
   proof.
4. Finish the `docs/deployment.md` checks above.
5. `docs/ROADMAP.md` — M1 line for prep-beta-launch.
6. **Full verification:** backend `pytest` (with `DATABASE_URL` at an
   unreachable port, e.g. `postgresql+psycopg://x:x@127.0.0.1:1/none`),
   `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`
   (first build since `output: "standalone"`).
7. Report, the numbered list of owner steps (VM / GitHub / registrar),
   and wait for approval.

## Things to know / about to change

- **Prerequisites the spec names are not met yet:**
  `invite-only-signup` is uncommitted work in its own worktree
  (`../ctrl-ai-platform-worktrees/invite-only-signup`), so point 2's first
  bullet and point 5's invite-code test cannot be verified here;
  `test-database-isolation` is not done; Phase 2 point 10 (one real
  message) is not recorded as run. The guide says not to share the address
  before invite codes merge.
- **Migration heads:** this branch adds `d4f7a1c9e2b5` on
  `c6e2d8a4f913`. `invite-only-signup` adds `c8e1f4a29d57`; whichever
  merges second must set its `down_revision` to the other, or Alembic has
  two heads.
- **Likely merge conflicts with invite-only-signup:** `SignupForm.tsx`
  (one added `<DataLocationNotice />`), `auth.py`, `config.py`,
  `test_membership_access.py`.
- **Two API workers** (`WEB_CONCURRENCY=2`): anything kept in process
  memory is per worker. Feedback and chat limits count database rows, so
  they are fine; check `invite-only-signup`'s `services/rate_limit.py`
  when it lands.
- **Decision to confirm:** the feedback button shows in every environment,
  not only beta (useful locally and in production; harmless).
- **Decision to confirm:** `bootstrap` also writes the video model
  catalogue (reference data Admin edits, like the Claude catalogue the
  migrations seed), not only the admin.
- **Decision recorded:** no `api` subdomain (BACKLOG, Hosting decisions).
- Frontend suite once had two 5 s timeouts under full parallel load
  (`chat.test.tsx`, a builder test); they passed alone and on the next
  full run. Pre-existing flakiness, not this branch — but CI runs the
  same suite before building images.
- On merge: move the item to `docs/archive/done.md` /
  `done-specs.md`, and delete this file.
