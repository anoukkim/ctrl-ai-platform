# Ctrl AI — Architecture Notes

How the platform is put together: the request flow, the guard on every
endpoint, the provider boundary and the data model are **built and
current**; the *Target infrastructure* section below is direction for
after the beta. For screens and product rules see
[`product.md`](product.md); for the standing rules and working method see
[`CLAUDE.md`](../CLAUDE.md), which wins wherever the two disagree.

Three long-standing corrections worth keeping in mind: Ctrl AI calls
**hosted provider APIs** (Claude, Higgsfield) rather than running its own
GPU models; videos live on **YouTube** rather than being served by Ctrl AI;
and money is denominated in **KRW**, not in per-provider units.

---

## Request flow

```text
Browser  ->  Next.js (frontend)  ->  FastAPI (backend)  ->  PostgreSQL
                                            \------------>  AI providers
```

The browser never talks to the database or to a provider directly. Every
request that costs money or touches data goes through the Ctrl AI backend,
because that is the only place a permission check, a quarterly budget limit
and a provider API key can live safely.

From Phase 1a the frontend also **proxies `/api/*` to the backend** through
Next.js rewrites, so the browser sees a single origin and the session cookie
can be `HttpOnly` and same-origin. The same arrangement holds in production.

## Access rules per endpoint

Three guards, answering three different questions. Every route picks
exactly one, and the choice is the whole of the authorization story for
that route — there is no second check further in.

| Guard | Question | Refusal |
| ----- | -------- | ------- |
| `get_current_user` | Is anyone signed in, and is the account usable? | 401, or 403 for a `former` account |
| `require_admin` | Is this person an `admin`? | 403 |
| `require_active_member` | Are they **participating in the current quarter**? | 403 |

`require_active_member` builds on `get_current_user`, so signing in is
assumed. A **missing** `QuarterMembership` row means "not participating":
no inactive row is written for members who never applied.

The two statuses are not the same question, and conflating them is the
easiest mistake here:

* `User.account_status` — may this person use CTRL+AI at all?
* `QuarterMembership.status` — are they taking part in *this* quarter?

### The table

Every endpoint, and what guards it. A new route belongs in this table on
the same commit that adds it.

| Endpoint | Guard | Why |
| -------- | ----- | --- |
| `GET /api/health` | none | Must answer while the database is down |
| `GET /api/site` | none | Beta banner, test-mode labels, the sign-up data-location notice — needed before signing in |
| `GET /_ctrlai/sdk.js`, `GET /_ctrlai/shell.js` | none | The app platform's two scripts (apps origin only, outside `/api`) |
| `GET /_ctrlai/shell/{slug}` | none | The trusted shell of a published app or a working copy; 404 otherwise |
| `GET /_ctrlai/v1/app`, `POST /_ctrlai/v1/login/start`, `POST /_ctrlai/v1/logout` | `app_call` | `app_request` (`X-CtrlAI-App` naming a live app, same-origin) + who is signed in to this app — only its own `ctrlai_app_<slug>` cookie, never the site's session |
| `GET /_ctrlai/v1/user`, `POST /_ctrlai/v1/ai/ask`, `POST /_ctrlai/v1/ai/stream` | `signed_in_visitor` | Signed in to this app, its 기능 상자 running; the AI routes also need the "ai" consent, participation this quarter and the visitor's own wallet (`app_ai`) |
| `POST /_ctrlai/v1/data/{list,count,get,save,update,remove,report}` | `running_app` | `ctrlai.db` (P3): `app_call` + the 기능 상자 running. Reads work signed out on shared collections; a write needs the app's own cookie and the "data" consent (checked inside, so the SDK can ask the visitor to sign in and try again) |
| `GET /{slug}/_ctrlai/callback`, `GET /_ctrlai/callback.js` | none | The end of signing in: a one-time code (60 s) that only the browser holding the matching state cookie can spend |
| `GET`/`POST /api/app-connect/{slug}` | `get_current_user` | The consent screen and 허용 — spends nothing |
| `GET /api/me/app-consents`, `POST /api/me/app-consents/{consent_id}/revoke` | `get_current_user` | Profile › 연결된 앱 |
| `POST /api/admin/apps/{project_id}/sdk` | `require_admin` | 기능 상자 정지/재개, audited |
| `GET /api/admin/apps/{project_id}/data`, `POST /api/admin/apps/data/{item_id}/hide`, `POST …/delete` | `require_admin` | Admin › Content › 데이터 (P3): an app's collections and shared items; 숨기기 / 지우기 with a reason, audited |
| `POST /api/feedback` | `get_current_user` | 의견 보내기 — spends nothing; open to members not participating |
| `POST /api/auth/register` | none | Creating the account — needs a usable invite code; limited per address, counted in `signup_attempts` |
| `POST /api/auth/login` | none | `former` is refused here, 403 |
| `POST /api/auth/logout` | none | Signing out must always work |
| `GET /api/auth/google/start` | none | Google로 계속하기: a single-use state + PKCE verifier, then to Google (404 where Google sign-in is off) |
| `GET /api/auth/google/callback` | none | State must match the cookie and an unexpired row; matched by Google `sub` only |
| `GET /api/auth/google/pending` | none | The setup screen's Google sign-up, from its HttpOnly cookie |
| `POST /api/auth/google/complete` | none | Creates the account: username, name, invite code (none for a verified ADMIN_EMAIL) |
| `GET /api/auth/google/mock-consent` (+ `/approve`) | none | Development's stand-in Google page; 404 elsewhere |
| `GET /api/account/google` | `get_current_user` | Is Google linked |
| `GET /api/account/google/link/start` | `get_current_user` | Profile › 연결하기 |
| `GET /api/auth/me` | `get_current_user` | |
| `GET /api/account/withdrawal` | `get_current_user` | What withdrawing would do |
| `POST /api/account/withdrawal` | `get_current_user` | **Deliberately open** — leaving must not need participation; password re-checked |
| `GET /api/account/sign-in` | `get_current_user` | Profile › 로그인 방법: password set? Google linked? |
| `PUT /api/account/password` | `get_current_user` | **Deliberately open** — set a first password, or change it (current password re-checked, under the sign-in limit) |
| `POST /api/account/password/remove` | `get_current_user` | **Deliberately open** — only while Google is linked; row locked; current password re-checked |
| `POST /api/account/google/unlink` | `get_current_user` | **Deliberately open** — only while a password is set; row locked; that password re-checked |
| `GET /api/chat/info` | `get_current_user` | Mock or real, and the rate limit |
| `GET /api/chat/conversations` | `get_current_user` | Reading your own conversations — works while inactive |
| `GET /api/chat/conversations/{id}` | `get_current_user` | Reading your own conversation |
| `POST /api/chat/conversations` | **`require_active_member`** | Creating |
| `PATCH /api/chat/conversations/{id}` | **`require_active_member`** | Renaming |
| `DELETE /api/chat/conversations/{id}` | **`require_active_member`** | A real delete; its usage events stay |
| `POST /api/chat/conversations/{id}/messages` | **`require_active_member`** | Claude replies — spends the wallet |
| `POST /api/chat/conversations/{id}/attachments` | **`require_active_member`** | Attach a file to the next message (bytes as the body, `?name=`); checked, then stored |
| `DELETE /api/chat/attachments/{id}` | **`require_active_member`** | ✕ on a file not sent yet |
| `GET /api/chat/attachments/{id}/file` | `get_current_user` | The member's own stored copy — works while not taking part |
| `GET /api/chat/conversations/{id}/attachments/estimate` | `get_current_user` | What the waiting files add to a reply |
| `GET /api/chat/conversations/{id}/attachments/pending` | `get_current_user` | Files uploaded, not sent yet |
| `GET /api/builder/projects` | `get_current_user` | Reading your own work |
| `GET /api/builder/projects/{id}` | `get_current_user` | Reading your own work |
| `POST /api/builder/projects` | **`require_active_member`** | Creating |
| `PATCH /api/builder/projects/{id}` | **`require_active_member`** | Editing |
| `DELETE /api/builder/projects/{id}` | **`require_active_member`** | Changing your work |
| `GET /api/builder/projects/{id}/files` | `get_current_user` | Reading your own work |
| `GET /api/builder/starter-estimate` | `get_current_user` | A price, nothing spent |
| `POST /api/builder/projects/{id}/starter` | **`require_active_member`** | Claude writes a starter app — spends the wallet |
| `GET /api/builder/projects/{id}/generate-estimate` | `get_current_user` | A price, nothing spent |
| `POST /api/builder/projects/{id}/generate` | **`require_active_member`** | 만들기 / 고치기: Claude writes files — spends the wallet |
| `GET /api/builder/projects/{id}/versions` | `get_current_user` | Reading your own work |
| `GET /api/builder/projects/{id}/versions/{n}/files` | `get_current_user` | 이 버전 보기 — reading an old version (free, read-only) |
| `POST /api/builder/projects/{id}/versions/{n}/restore` | **`require_active_member`** | 되돌리기 — changing your work (free) |
| `POST /api/builder/projects/{id}/runtime` | **`require_active_member`** | 미리보기 갱신 — writes the files to `apps.ctrlai.my` |
| `PATCH /api/builder/projects/{id}/versions/{n}` | **`require_active_member`** | 버전 저장 — name or pin a version |
| `POST /api/builder/projects/{id}/publish` | **`require_active_member`** | 게시 / 업데이트 게시 |
| `POST /api/builder/projects/{id}/unpublish` | `get_current_user` | 게시 취소 — taking your own app down works while inactive |
| `GET /api/apps`, `GET /api/apps/mine`, `GET /api/apps/{slug}` | `get_current_user` | CtrlAIApps listing, the member's own published apps (Profile), and detail |
| `POST /api/apps/{slug}/report` | `get_current_user` | 신고 — not creating anything |
| `GET/POST /api/admin/apps…` | `require_admin` | Admin › Content: published apps, reports, unpublish (audited) |
| `GET /api/builder/projects/{id}/download` | `get_current_user` | Taking a copy out — works while inactive |
| `GET /api/video/models` | `get_current_user` | Reading the catalogue |
| `GET /api/video/projects` | `get_current_user` | Reading your own work |
| `GET /api/video/projects/{id}` | `get_current_user` | Reading your own work |
| `POST /api/video/projects` | **`require_active_member`** | Creating |
| `PATCH /api/video/projects/{id}` | **`require_active_member`** | Editing |
| `POST /api/video/projects/{id}/versions` | **`require_active_member`** | Generating — spends budget |
| `POST /api/video/projects/{id}/versions/{vid}/edit` | **`require_active_member`** | Editing a version — spends the wallet |
| `POST /api/video/projects/{id}/versions/{vid}/extend` | **`require_active_member`** | Extending a version — spends the wallet |
| `POST /api/video/projects/{id}/prompt-help` | **`require_active_member`** | Claude rewrites the prompt — spends the wallet |
| `DELETE /api/video/projects/{id}` | **`require_active_member`** | Changing your work |
| `GET /api/video/projects/{id}/versions/{vid}/download` | `get_current_user` | Taking a copy out — works while inactive |
| `GET /api/quarters/current` | `get_current_user` | |
| `GET /api/quarters/me` | `get_current_user` | |
| `POST /api/quarters/{id}/apply` | `get_current_user` | **Deliberately open** — see below |
| `POST /api/quarters/applications/{id}/cancel` | `get_current_user` | Same |
| `GET /api/quarters/me/wallet` | `get_current_user` | Own money |
| `PATCH /api/quarters/me/wallet` | `get_current_user` | Own money; switching spending **on** is refused while `PERSONAL_TOPUP_ENABLED` is off (personal-topup-off) |
| `POST /api/quarters/me/top-ups` | `get_current_user` | Own money; refused while `PERSONAL_TOPUP_ENABLED` is off (default everywhere; the beta forces it off) |
| `GET /api/quarters/me/top-ups` | `get_current_user` | Own money |
| `GET /api/usage/me` | `get_current_user` | Reading your own ledger |
| `GET /api/users` | `require_admin` | |
| `GET /api/admin/quarters` | `require_admin` | |
| `POST /api/admin/quarters` | `require_admin` | |
| `PATCH /api/admin/quarters/{id}` | `require_admin` | |
| `GET /api/admin/quarters/{id}/applications` | `require_admin` | |
| `POST /api/admin/applications/{id}/review` | `require_admin` | Approving writes the allocation |
| `GET /api/admin/quarters/{id}/members` | `require_admin` | |
| `PUT /api/admin/quarters/{id}/members/{user_id}` | `require_admin` | |
| `PUT /api/admin/quarters/{id}/allocations/{user_id}` | `require_admin` | Sets a member's one wallet |
| `GET /api/admin/quarters/{id}/budget` | `require_admin` | Admin › Budget: wallets and spend by provider, read-only |
| `PUT /api/admin/members/{user_id}/role` | `require_admin` | |
| `GET /api/admin/top-ups` | `require_admin` | |
| `POST /api/admin/top-ups/{id}/confirm` | `require_admin` | |
| `GET /api/admin/video-models` | `require_admin` | |
| `PATCH /api/admin/video-models/{id}` | `require_admin` | |
| `GET /api/admin/audit` | `require_admin` | Read-only; the log is append-only |
| `GET /api/admin/invites` | `require_admin` | Invite codes, with who signed up with each |
| `POST /api/admin/invites` | `require_admin` | Generated or custom code; audited |
| `PATCH /api/admin/invites/{invite_id}` | `require_admin` | Change 최대 가입 수 later, never below the sign-ups made; audited |
| `POST /api/admin/invites/{invite_id}/deactivate` | `require_admin` | Stops new sign-ups only; audited |
| `POST /api/admin/invites/{invite_id}/reactivate` | `require_admin` | Audited |
| `GET /api/admin/feedback` | `require_admin` | Admin › Feedback, read-only |
| `GET /api/admin/dashboard` | `require_admin` | Read-only; counts and the last 10 audit rows |
| `GET /api/admin/members/{user_id}` | `require_admin` | Read-only; one member's history, budgets and audit trail |
| `GET /api/admin/stats/applications` | `require_admin` | Read-only; grouped counts for one quarter |
| `GET /api/admin/stats/members` | `require_admin` | Read-only; grouped counts for one quarter |
| `GET /api/admin/quarters-with-stats` | `require_admin` | Read-only; every quarter with its figures |
| `GET /api/admin/claude-pricing` | `require_admin` | Claude prices, exchange rate, chat limits |
| `GET /api/admin/chat-models` | `require_admin` | The AI model catalogue (Admin › AI Models) |
| `GET /api/admin/chat-models/providers` | `require_admin` | Providers in display order; `ready` false = 연결 준비 중, its models stay closed |
| `POST /api/admin/chat-models` | `require_admin` | Audited |
| `PATCH /api/admin/chat-models/{id}` | `require_admin` | Audited (prices incl. cache-read price) |
| `GET /api/admin/chat-models/calibration` | `require_admin` | Cost calibration: estimates vs real replies, read-only |
| `POST /api/admin/claude-pricing/exchange-rate` | `require_admin` | A new rate row; history kept; audited |
| `GET /api/admin/providers` | `require_admin` | Read-only; never returns a credential |
| `POST /api/admin/providers/{provider}/check` | `require_admin` | Runs on request only; records the outcome |
| `GET /api/admin/deleted-items` | `require_admin` | The only route that can see soft-deleted work |
| `POST /api/admin/work/{kind}/{id}/restore` | `require_admin` | Not participation-gated: moderating is not creating |
| `DELETE /api/admin/work/{kind}/{id}` | `require_admin` | Any member's work; audited |
| `GET /api/admin/members/{user_id}/withdrawal` | `require_admin` | Read-only; what withdrawing would do |
| `POST /api/admin/members/{user_id}/withdrawal` | `require_admin` | Same rules as the member's own; audited |
| `POST /api/admin/members/{user_id}/withdrawal/restore` | `require_admin` | 복구, within 30 days only; audited |
| `POST /api/admin/members/{user_id}/withdrawal/refund` | `require_admin` | 환불 완료 기록; audited |
| `GET /` | none | Service banner |

Two entries that look like exceptions and are not:

* **Applying for a quarter stays on `get_current_user`.** Applying is the
  only way to stop being inactive. Guarding it with
  `require_active_member` would be a locked door whose key is behind it.
* **Admin routes are guarded by role, not participation.** An admin who
  sat out the quarter still has to run the community. The same admin is
  still refused on every creation route above: the role opens Admin, it
  does not open creation.
* **Withdrawing stays on `get_current_user`.** A member who sat the
  quarter out still owns their account, and leaving CTRL+AI must not be
  behind participating in it. It spends nothing, and the password is
  asked for again.

### Adding a route

**A new route is created with its guard already on it**, not guarded
later: a rule applied after the fact is a rule that was missing for every
release before it. The browser also hides and disables the matching
controls, which is a courtesy and nothing more.

### This table is tested

`tests/test_membership_access.py` holds the same map as Python and
compares it against the routes FastAPI actually registered. Adding a
route, or changing one's guard, fails that test until the map is updated
— which is the point. The original bug was three endpoints quietly
missing a guard, and a table that only lived in a document would have
gone stale the same way. The same module also exercises each guarded
endpoint as an inactive, unenrolled, active and admin member.

## Provider boundary

Every external provider sits behind an interface with a **mock
implementation selected by an environment variable**, mock by default
(`CLAUDE_PROVIDER`, `VIDEO_PROVIDER`, `GITHUB_PROVIDER`,
`YOUTUBE_PROVIDER`, and `GOOGLE_LOGIN_PROVIDER` for Google sign-in). See
the provider rule in `CLAUDE.md`.

This is what makes it possible to build every phase locally with no API keys
and no domain, and it is why going live is a configuration change rather
than a rewrite.

```text
Backend
  ├─ ClaudeProvider      ── MockClaude      | Anthropic
  ├─ VideoProvider       ── MockVideo       | Higgsfield
  ├─ GitHubProvider      ── MockGitHub      | GitHub App
  └─ YouTubeProvider     ── MockYouTube     | Google OAuth
```

Members never hold provider keys. Ctrl AI owns provider access and records
usage per member and quarter.

---

## Target infrastructure

Hosting is expected to be Google Cloud, but nothing here is created until
Phase 9, and every item below bills someone.

### Beta hosting (decided 2026-10-13)

The invite-only beta does **not** use the full layout below. It runs on
`ctrlai.my` from one Compute Engine VM, `ctrlai-server`: an **e2-medium**
(2 vCPU, 4 GB RAM, paid) in **Seoul** (`asia-northeast3-c`), Debian 13,
a 30 GB standard disk and the static IP `34.47.78.228`, on the Google
Cloud free trial until about 2027-01-11. Docker Compose
(`docker-compose.prod.yml`) runs four services:

```text
Internet ─ 80/443 ─▶ caddy (HTTPS, Let's Encrypt; www → apex)
                       └─▶ web  (Next.js standalone, /api/* rewrite)
                             └─▶ api (FastAPI, reads the server's .env)
                                   └─▶ db (PostgreSQL 16, no published port)
```

There is no `api` subdomain: the browser only talks to `ctrlai.my`.
Images are built by GitHub Actions and pulled from ghcr.io. Secrets sit
in a `chmod 600` `.env` on the VM — the beta-only exception in
`CLAUDE.md` section 17. The full decision is in `docs/archive/done-specs.md` ›
prep-beta-launch › **Hosting decisions — 2026-10-13**; running it is
`docs/deployment.md`. The layout below is the target after the beta.

```text
Google Cloud
│
├─ Frontend hosting
│   └─ Next.js app
│
├─ Backend hosting
│   └─ FastAPI (uvicorn)
│
├─ Cloud SQL
│   └─ PostgreSQL          (not reachable from the public internet)
│
├─ Cloud Storage
│   ├─ Generated video assets awaiting publication
│   ├─ Images and thumbnails
│   └─ Member file uploads
│
├─ Secret Manager
│   ├─ Provider API keys
│   ├─ Database credentials
│   └─ Session signing key
│
└─ Later — isolated runtime for member apps
    └─ Containers with resource limits, never the main backend
```

**Corrected from the earlier draft:** there is no GPU Compute Engine and no
self-hosted Ollama/LLM tier. Ctrl AI calls hosted provider APIs. If local
model hosting is ever revisited it is a new decision, not a carried-over
assumption.

## Storage responsibilities

Large files do not belong in PostgreSQL.

| Data | Storage |
| ---- | ------- |
| Member accounts, roles, sessions | PostgreSQL |
| Quarters, applications, allocations | PostgreSQL |
| Usage events and balances | PostgreSQL |
| Project and app metadata | PostgreSQL |
| Ctrl AI reactions and comments | PostgreSQL |
| Generated video assets (pre-publication) | Cloud Storage |
| Published videos | YouTube — Ctrl AI stores only the video ID |
| Images and thumbnails | Cloud Storage |
| Member source code | GitHub, via the member's own connected account |
| Provider keys and credentials | Secret Manager |

**Corrected from the earlier draft:** published videos are not stored by
Ctrl AI. CtrlAITube embeds YouTube and keeps its own comment thread in
PostgreSQL, deliberately separate from YouTube's comments.

## Core data model

Moved here from `CLAUDE.md` section 14 (docs-cleanup, 2026-10-14); this
is now the authoritative statement of direction. It is direction, not a
promise to implement everything at once — the real schema is whatever
Alembic has migrated (`backend/app/models/`).

- **User** — id, username, email, password_hash (Argon2id, or the
  unusable sentinel for Google-only accounts), display_name, avatar_url,
  account_status (`active` / `inactive` / `former`), role (`admin` /
  `member` — the only two), invite_code_id, timestamps.
- **Quarter** — code ("2026-Q1"), display_name, starts_at/ends_at,
  application_opens_at/closes_at, status (`draft` / `application_open` /
  `active` / `closed`), **subsidy_limit_krw** (copied per quarter at
  creation; changing the default never moves an existing quarter).
- **QuarterApplication** — one live application per member per quarter;
  requested_budget_krw (the quarter's amount when applying), status
  (`draft` / `submitted` / `approved` / `rejected` / `cancelled`),
  review fields.
- **QuarterMembership** — one row per member per quarter; **a missing
  row means "not participating"**. Answers a different question from
  `User.account_status` and must not be conflated with it.
- **QuarterAllocation** — the one 동아리 지원 wallet: budget_krw,
  consumed_krw, pricing_snapshot (provider prices captured at approval),
  approval fields.
- **PersonalBalance / PersonalTopUp** — kept, feature off
  (`personal-topup-off`, 2026-10-14): balance_krw, consumed_krw,
  overage_enabled (ignored entirely while `PERSONAL_TOPUP_ENABLED` is
  false); top-ups carry status (`requested` / `confirmed` / `rejected` /
  `cancelled`) and settlement fields.
- **UsageEvent** — the ledger row written with every charge in one
  transaction: user, quarter, funding_source (`community` / `personal`),
  provider, feature (`chat` / `build` / `video_prompt` / `video_generate`
  / `video_edit` / `video_extend`), model_id, provider_units /
  provider_unit, provider_cost / provider_currency (what the provider
  charged) **separate from** charged_krw (what moved a budget), token and
  cache-token counts, exchange rate, and nullable links to the
  conversation / project / video version that caused it (`ON DELETE SET
  NULL`, so history survives deletes).
- **Project (BuilderProject) / BuilderProjectFile** — owner, name,
  description, status (`draft` / `building` / `ready` / `published`),
  github_repo, preview_url, **deleted_at** (soft delete — every member
  listing filters on it).
- **App** (Phase 5) — the published, community-facing object: project_id,
  owner, slug, thumbnail, launch_url, published_at. A project is the
  private working object; an app is the published listing. Listings must
  filter the underlying project's `deleted_at`.
- **Video (VideoProject / VideoVersion) / VideoModel** — owner, prompt,
  provider job id, `asset_storage_key` (served through the storage
  interface, never a provider URL), youtube_video_id (Phase 7/8), status,
  per-version settings validated against the model's capabilities,
  **deleted_at** (soft delete, same rule).
- **Reactions / Comments** (Phases 5 and 8) — per app and per video, with
  `parent_comment_id` for threads; CTRL+AI comments stay separate from
  YouTube comments.
- **ConnectedAccount** — provider (`google`, later `github`),
  provider_account_id (Google's stable `sub` — accounts are linked by it,
  never by email), encrypted credential reference.
- **Supporting tables that exist today** — user_sessions (server-side
  sessions), invite_codes + signup_attempts + login_attempts, chat
  conversations/messages, chat_models (the AI Models catalogue),
  exchange_rates, feedback, account_withdrawals, oauth_states /
  pending_google_signups, audit_log (append-only).

Alembic owns the schema. `create_all` is not used, and a production
database is migrated, never re-created.

---

## Member app platform (CTRL+AI 기능 상자)

Owner decisions of 2026-10-15 are in CLAUDE.md §2 ("Member app platform").
Built in phases P1–P5 (BACKLOG › app-platform). **P1 (the shell, the SDK,
`ctrlai.storage`)**, **P2 (sign-in, `ctrlai.user`, `ctrlai.ai`)** and **P3
(`ctrlai.db`)** are in place:

```text
ctrlai.my (Builder / CtrlAIApps)
  └─ iframe  apps.ctrlai.my/<slug>/            OUR shell  (sandbox: scripts, same-origin, forms, popups)
       └─ iframe  /<slug>/_app/index.html      the member's files (sandbox: scripts, forms, popups,
                                               downloads — never same-origin: opaque origin)
            loads /_ctrlai/sdk.js  ── postMessage ──▶ shell ── same-origin ──▶ /_ctrlai/v1/*
```

* **Who serves what** (`deploy/Caddyfile`, mirrored locally by
  `backend/app/dev_apps_server.py`): `/<slug>/` → the api's
  `/_ctrlai/shell/<slug>` (the shell page; 404 for unknown, unpublished or
  deleted projects; a draft slug is the Builder's 미리보기 mode);
  `/<slug>/_app/<file>` → the static file from `apps_data`, with
  `app_shell.app_files_csp` (a `sandbox` CSP, so the files are fenced in
  even when opened on their own; `connect-src 'none'`; framed only by the
  shell and the site; never a cookie); `/_ctrlai/*` → the api router
  `app/api/routes/app_platform.py`, mounted **outside `/api`** — the site
  forwards only `/api/*`, so none of it is reachable from `ctrlai.my`;
  `/<slug>` and `/<slug>/<file>` (old addresses) → 301 to the new ones.
* **The shell** (`app/static/ctrlai/shell.js`) learns its slug from its
  own address, refuses to run without its own origin (a copy opened from
  an app inherits the sandbox), and accepts a message only when
  `event.source` is its own app frame **and** the origin is opaque.
* **The SDK** (`app/static/ctrlai/sdk.js`) is injected first into every
  HTML page when the files are written (`app_runtime.SDK_TAG`; pages
  written before P1 are rewritten by `python -m app.db.rewrite_app_runtime`).
  It sends only to the shell's origin and defines `ctrlai.storage` and a
  `localStorage` kept by the shell — the saved copy is handed over in
  `window.name` at start, so old apps that read `localStorage`
  synchronously keep working.
* **Storage**: the shell origin's `localStorage`, key
  `ctrlai:<slug>:l:<key>` (the app's `localStorage`) and
  `ctrlai:<slug>:k:<key>` (`ctrlai.storage`, JSON); about 1 MB per app.
  Per visitor, works signed out.
* **`/_ctrlai/v1/*`** sits behind `app_request`: an `X-CtrlAI-App: <slug>`
  header naming a live app, and `Sec-Fetch-Site: same-origin` when the
  browser sends it. The router never reads the site's session cookie (a
  test holds it). P2 adds the app-scoped cookie `ctrlai_app_<slug>`
  (Path `/_ctrlai/`, `SameSite=Strict`, host-only), which the member's
  opaque frame can never send.
* **P2 — sign-in, `ctrlai.user`, `ctrlai.ai`.** `ctrlai.login()` (or the
  first AI call while signed out) → the shell asks `/_ctrlai/v1/login/start`
  (a `state`, kept in a cookie with Path `/<slug>/_ctrlai/`) and opens
  `ctrlai.my/apps/connect?app=…&state=…` in a new window (if the browser
  blocks it, the shell shows "CTRL+AI 회원만 쓸 수 있어요" + 로그인). The
  consent page (site session) shows the app, its maker, what it may do and
  "1회 약 N원 (최대 200원)"; 허용 → `POST /api/app-connect/<slug>` records
  an `AppConsent` (audited) and a one-time `AppLoginCode` (60 s, hash
  only) → the window goes to `apps.<domain>/<slug>/_ctrlai/callback`, which
  spends the code only with the matching state cookie and sets
  `ctrlai_app_<slug>` (HttpOnly, `SameSite=Strict`, Path `/_ctrlai/`,
  host-only; an `AppSession`, hash only, 30 days); `callback.js` tells the
  shell (same origin, only the window it opened) and closes. `ctrlai.user()`
  is `{displayName, appUserId}` — `appUserId` is a random per-app id, never
  the email, username or balance. Profile › 연결된 앱 revokes (audited;
  every app session ends).
  `ctrlai.ai.ask/stream` (`services/app_ai.py`): the signed-in visitor
  pays from their own 동아리 지원 (`usage.charge`, feature `app_ai`,
  `builder_project_id` = the app); they must have allowed "ai" and be an
  active member this quarter. "fast"/"smart" map to the members' Haiku /
  Sonnet catalogue rows; per visitor 10 and per app 60 calls a minute;
  the per-call cap (200원) is worked out as `max_tokens` (a JSON retry
  shares it); the visitor's app-AI day cap (`chat_limits.app_ai_daily_cap_krw`,
  2,000원 by default, Admin › System, audited, 0 = off), then the wallet;
  images ≤ 5 MB (4 at most), re-encoded like Chat's; our safety preamble
  comes before the app's system prompt; a JSON Schema is checked (a safe
  subset) with one automatic retry. One ledger row per call; Usage shows
  "앱 · <앱 이름>", the shell shows "앱 AI · N원 · 내 동아리 지원금에서".
  **Kill switch**: Admin › Content › 기능 상자 멈추기 (a reason, audited) —
  every `/_ctrlai/v1` call of that app is refused at once.
* **P3 — `ctrlai.db`** (`services/app_data.py`, `/_ctrlai/v1/data/*`).
  An app's data is **collections** of JSON objects (`app_data_collections`,
  `app_data_items`). A collection is a **(name, kind)** pair — **private**
  (a visitor sees only their own items) or **shared** (everyone reads,
  signed-out visitors too; signed-in members write, and each item carries
  its author's display name and per-app id — the consent screen's "data"
  line says so) — and the kind is part of every call (`shared: true`,
  else private): `posts` private and `posts` shared are two lists, so a
  visitor who writes first can never decide what another call means
  (security review 2026-10-16, Vuln 1: with the kind fixed by the first
  save, Mallory could pre-create a name as shared and every later default
  — private — save landed in public). A signed-out visitor's read of a
  private list is refused before the lookup, so it learns nothing, not
  even whether the list exists. Items ≤ 4 KB; per app ≤ 2,000 items, 5 MB, 20
  collections; per visitor ≤ 30 writes a minute in one app (`app_data_writes`,
  counted in the database so every API worker sees the same count); the
  app row is locked for a write so two saves cannot both slip under the
  quota. Queries — `list` (`where` = equality on top-level fields, `orderBy`
  createdAt / updatedAt / a field, `limit` ≤ 100, an offset `cursor`,
  `mine`), `get`, `count` — read one collection of one app and filter in
  Python, so SQLite and PostgreSQL behave alike; no raw SQL, and every
  lookup is scoped by project **and space** — the Builder's 미리보기 has
  its own space ("preview"), so trying an app never touches its live data.
  The author updates or removes their item; the app's owner may remove any
  shared item of their app. `ctrlai.db.report(collection, id, reason)` puts
  a shared item in the admin's queue (`AppReport.data_item_id` + an excerpt
  that outlives the item). Admin › Content shows each app's data size, and
  per app its collections and shared items with 숨기기 (`hidden_at`, gone
  for everyone, the row kept) or 지우기 — both need a reason, both audited
  (`app_data.hidden` / `app_data.deleted`, with the excerpt), both close the
  item's open reports. A consent given before P3 lacks "data": the first
  write answers 403 `consent_required` and the shell reopens the consent
  window, then tries once more.
* **P4 — the app's lists are the owner's to declare** (security review of
  P3, 2026-10-16; `services/app_manifest.py`). A collection exists because
  the project's **`ctrlai.json`** names it — `{"db": [{"name": "posts",
  "shared": true}, {"name": "notes"}]}`, read whenever the files are
  written to the runtime, so the 미리보기 space and the published space
  each get their lists — or because the **owner** saved into it first. A
  visitor's save into a list that is not there is a 404 `no_collection`;
  reads of a missing list stay empty. A wrong `ctrlai.json` is refused by
  the Builder's file check (`builder_files.check_project`) with the
  reason, never ignored. The file is served with the app (names only,
  nothing secret), ships in the ZIP, and taking an entry out never
  deletes a list. **The Builder knows the SDK**: one `_SDK_RULES` block in
  the starter, edit and staged prompts (`claude_provider.py`) — storage,
  sign-in, `ctrlai.ai` only from a button with "1회 약 N원 · 최대 200원"
  beside it and a demo answer marked "데모" when signed out or outside
  CTRL+AI, `ctrlai.db` with `ctrlai.json`; the self-check looks for an
  undeclared list and AI on page load. **Templates**
  (`services/builder_templates.py`, files in `backend/examples/templates/`):
  AI 챗봇, 투표·설문, 랭킹 게임, 동아리 게시판 — `POST
  /api/builder/projects/from-template` copies one into a new project
  (`require_active_member`, free, version note "템플릿: …"); each is checked
  by the project file rules and declares its lists. **The 미리보기 is the
  maker's own use**: AI from it is charged to the maker with feature
  `app_ai_preview` (the same rates and day cap as `app_ai`), the shell's
  toast says "미리보기 사용 · N원 · 내 지원금에서" and Usage lists "앱
  미리보기 · <이름>"; its data stays in the preview space. Proven in a real
  browser (`frontend/e2e/app-platform-p4.spec.ts`).
* **P4b — the price before the button, the showcases live, Admin › Apps.**
  `ctrlai.ai.estimate(options)` (`POST /_ctrlai/v1/ai/estimate`, behind
  `app_call` — free, signed out too) prices a call with the formulas
  `prepare()` checks with, every image counted at its upper bound
  (`IMAGE_TOKENS_UPPER`, the long edge's square after re-encoding) →
  `{typicalKrw, maxKrw}`. **A call made with the same options never costs
  more than `maxKrw`**: the JSON retry's `prepare` is given the first
  attempt's worst case as its cap (`Prepared.max_krw`), so the second
  attempt spends only what the first left, or is refused as `bad_json`
  before any provider call. SDK version "4". The three **showcase apps**
  run on 실제 AI when the visitor is signed in (a per-app toggle kept in
  storage; the demo logic stays): the receipt ledger sends a PNG of the
  photo with a JSON schema and writes the month's pattern on request; the
  trip planner asks for days of place ids checked against the city's list
  (the demo planner fills a day that does not fit) and classifies a request
  into rain/cheap/relax; the doc chatbot sends its BM25 passages and shows
  the sources, calling nothing when nothing matches. Every button shows
  "1회 약 N원 · 최대 M원" from `estimate` first, and opening or switching
  spends nothing (`frontend/e2e/app-platform-p4b.spec.ts`). **Admin › Apps**
  (`GET /api/admin/apps/overview`, `GET /api/admin/apps/{id}`,
  `require_admin`): every app that uses the 기능 상자 — published, or with
  a consent or an AI call (the maker's 미리보기 counts) — with the
  visitors' calls and won today and this quarter, the maker's 미리보기
  this quarter apart, active consents, data, open reports, and the
  actions (기능 상자 멈추기/켜기, 공유 데이터 숨기기/지우기, 게시 내리기, ZIP
  미리보기); Admin › Content keeps the 신고 queue. **/help/apps** is the
  members' guide. A 고치기 request never becomes a project's description
  (only a 만들기 does); a template project starts with none.
* **Proven in a real browser** (`frontend/e2e/app-platform.spec.ts`,
  `npm run e2e`, run against the local apps server and against the real
  Caddyfile in a container): the app's origin is opaque and its fetches
  are blocked; its image, form and navigation requests to `/_ctrlai` carry
  no app cookie while the shell's do; an app opening another app's shell
  gets an inert sandboxed copy; a page that opens a shell in a popup can
  neither feed it messages nor navigate its app frame; storage is per app
  and survives reloads; the member's files opened directly are sandboxed.
  P2 (`frontend/e2e/app-platform-p2.spec.ts`, the local stack): an AI call
  while signed out opens the consent window; 허용 closes it and the call
  goes through, charged; `ctrlai.user()` has only the two fields; a stream
  arrives in pieces; a JSON answer comes back parsed; revoking from the
  site signs the app out.

---

## Security principles

These hold from the beginning, not from Phase 9:

- never commit secrets; never commit a real `.env`
- never store plaintext passwords — store secure hashes
- never expose Anthropic or Higgsfield master credentials to the frontend
- never expose the Google client secret or OAuth refresh tokens
- never put a secret in `NEXT_PUBLIC_*` — that prefix embeds the value in
  the browser bundle, readable by anyone
- do not ask members to paste GitHub personal access tokens; use a GitHub
  App with fine-grained permissions
- **authorization is checked in the backend**, never only in the UI
- keep PostgreSQL unreachable from the public internet
- require HTTPS for public access
- inactive and former members lose paid creation access
- provider usage must be attributable to a member and a quarter
- **apply the budget check before calling a paid API**, not after
- never execute arbitrary member code on the main backend; member apps
  require an isolated sandbox with resource limits
- store production secrets in Secret Manager
- record administrative membership and allocation changes in an audit log

External traffic should follow:

```text
Internet  ->  HTTPS  ->  Ctrl AI frontend  ->  Backend  ->  Internal services
```

rather than exposing internal services directly.

---

## Long-term goal

Ctrl AI is not intended to be only a shared chatbot. The aim is a community
platform where members who do not code can still:

**Use AI → Create → Develop → Publish → Share**

through one environment, with the infrastructure hidden from them.
