# The development phases — full plan and history

Moved out of `CLAUDE.md` sections 20 and 23 (docs-cleanup, 2026-10-14),
text unchanged below the line. **Phases are feature names, not the plan**:
order and status live in [`../BACKLOG.md`](../BACKLOG.md) and
[`../ROADMAP.md`](../ROADMAP.md). The standing rules that still bind every
new piece of work — the provider rule, the soft-delete listing rule for
Phases 5 and 8, localhost OAuth callbacks until go-live, never running
member code on the main backend, asking before any paid cloud resource —
are kept in `CLAUDE.md`; this file is the long-form plan they came from,
with the Phase 0–1c delivery history.

---

# 20. Development Phases

> **Status and order now live in [`docs/ROADMAP.md`](../ROADMAP.md)
> (milestones M0–M4) and [`docs/BACKLOG.md`](../BACKLOG.md) › Next (in
> order).** The phases below stay as **feature names** — "Phase 3" still
> means the Builder MVP — and their specs and rules still apply, but the
> ✅ markers and the numbering are not the plan.

Do not build the whole platform at once.

**Build every phase locally first. Deploy last.** There is no domain, no
server and no provider API key, and none of Phases 0–8 need one. Going live
is Phase 9 and nothing before it depends on that work.

## The provider rule — applies to every phase

Every external provider sits behind a **provider interface with a mock
implementation**, and the implementation is chosen by an environment
variable. **The mock is the default.**

| Provider | Variable | Values |
| -------- | -------- | ------ |
| Claude | `CLAUDE_PROVIDER` | `mock` (default) \| `anthropic` |
| Higgsfield | `VIDEO_PROVIDER` | `mock` (default) \| `higgsfield` |
| GitHub | `GITHUB_PROVIDER` | `mock` (default) \| `github` |
| Google/YouTube | `YOUTUBE_PROVIDER` | `mock` (default) \| `google` |

Consequences, all deliberate:

- Every phase can be built, run and tested with **no API keys and no domain**.
- A mock returns plausible, deterministic data so the UI and the usage
  ledger can be exercised end to end — including failure paths.
- Switching to a real provider is a configuration change in Phase 9, not a
  rewrite. If swapping the variable requires touching a screen or a route,
  the interface was drawn in the wrong place.
- Tests run against mocks and therefore never contact a paid API.
- OAuth phases (4 and 7) use **localhost callback URLs** during development.
  Production callback URLs are registered in Phase 9.

The existing `VideoModel` catalogue already follows this shape: the model
list lives in the database, and the provider field names who would serve it.

## Phase 0 — Product Shell ✅ Complete

Goal: make the product concept visible locally.

Build:
- Next.js frontend
- FastAPI backend
- PostgreSQL via Docker Compose
- `/api/health`
- main navigation
- Chat as opening/default page
- Builder mock page
- Video Generator mock page
- CtrlAIApps mock page
- CtrlAITube mock page
- Usage mock page
- Profile mock page
- Admin mock page
- responsive basic layout
- mock data only where appropriate

The Chat page should visibly offer routes such as:
- Build an App
- Make a Video
- Browse Apps
- Watch CtrlAITube

Builder page should visually show future:
- Claude panel
- files/editor area
- preview
- GitHub connection/push action

Video page should visually show future:
- prompt
- Improve with Claude
- Generate with Higgsfield
- Publish to YouTube

Do NOT implement real authentication/provider APIs/GitHub/YouTube yet.

**Delivered.** The shell runs locally: Next.js frontend with every screen and
the full navigation, FastAPI backend, PostgreSQL via Docker Compose,
`/api/health`, Korean-first UI, and a single dark theme. Anything not yet
built renders a **준비 중** badge with disabled controls.

## Phase 1 — Accounts + Quarters + Credits ✅ Complete

Phase 1 is three sub-phases. Do them in order: 1b and 1c both assume a real
signed-in user, which only 1a provides.

Status below reflects what has actually been verified running, not what
exists on disk.

### Phase 1a — Auth and the foundations underneath it ✅ Complete

- ✅ **Alembic migrations replace `create_all`** — Alembic owns the schema
  (`alembic upgrade head`, then `python -m app.db.init_db` to seed).
  `create_all` is gone from application code; it survives only in
  `tests/conftest.py`, which builds a throwaway in-memory SQLite schema.
  `create_all` must not be reintroduced: every schema change is a migration,
  and migrations are what run in production in Phase 9.
- ✅ **username/password auth** — `POST /api/auth/register`, `/login`,
  `/logout`, `GET /api/auth/me`. Passwords are hashed with **Argon2id**
  (`app/core/security.py`) and `password_hash` appears in no response
  schema. Sessions are **rows** in `user_sessions`, not self-contained
  tokens, so signing out — or deactivating an account — takes effect on the
  very next request.
- ✅ **Next.js rewrites proxy `/api/*` to FastAPI** — `next.config.ts`
  forwards to `BACKEND_ORIGIN`. The browser sees one origin, which is what
  makes the **HttpOnly** session cookie work: it is sent automatically and
  no script on the page can read it. No CORS credentials dance, and no
  token in `localStorage`. The same arrangement holds in production.

`get_current_user` in `api/deps.py` now resolves the session cookie to a
real member and is in front of every member and admin route. Account status
is re-checked on each request, not only at sign-in.

Phase 1a also introduced **`account_status`** (`active` / `inactive` /
`former`), replacing the Phase 0 `is_active` boolean. Phase 1a only blocks
sign-in for anything that is not `active`; the participation rules that
hang off it are Phase 1b.

### Phase 1b — Quarters and membership ✅ Complete

- ✅ `Quarter`
- ✅ `QuarterApplication` — one live application per member per quarter,
  and the Build/Video split must total exactly 100% *(the split is gone
  since `single-wallet`, 2026-10-08: one wallet, nothing to choose)*
- ✅ active / inactive / former behaviour, **enforced in the backend**

Participation is a real model, `QuarterMembership`, with one row per
member per quarter. It is per quarter rather than a single flag on the
user because CTRL+AI runs by quarter: someone may be active in Q1, sit out
Q2 and return in Q3, and that history is what attribution depends on.

**A missing row means "not participating."** No inactive row is written
for every member who did not apply.

Two statuses answer two different questions and must not be confused:

| Column | Question it answers |
| ------ | ------------------- |
| `User.account_status` | May this person use CTRL+AI at all? |
| `QuarterMembership.status` | Are they participating in *this* quarter? |

The rules, as enforced:

- **active** — may create; everything works.
- **inactive** — may sign in, may read everything they own, **may not use
  paid creation features**. `require_active_member` guards project
  creation and video version generation (the budget-spending call). Reads
  stay open, so their work never disappears.
- **former** — cannot sign in at all, and an open session stops working on
  the next request. Their account is kept rather than deleted precisely so
  published work keeps their name with the 탈퇴 회원 label.

Approving an application is what makes a member a participant: it writes
the membership row alongside the allocation. Without that the member would
have a budget they could not spend.

Admins can also set participation directly
(`PUT /api/admin/quarters/{id}/members/{user_id}`). Setting `former` closes
the account at the same time, so the two statuses cannot drift apart.

### Phase 1c — Allocation, usage and administration ✅ Complete

- ✅ `QuarterAllocation` — created by admin approval, copying the requested figures
- ✅ `PersonalBalance` / `PersonalTopUp`
- ✅ `UsageEvent` and the **Usage page on real data**
- ✅ admin member list
- ✅ admin quarter enrolment
- ✅ admin credit allocation, in KRW
- ✅ **audit log for admin changes**

**Money moves in one transaction.** `app/services/usage.py` is the only
place a budget is reduced. It locks the allocation row with
`SELECT ... FOR UPDATE`, checks the money is there, then deducts it and
writes the `UsageEvent` — all before committing. Without the lock, two
concurrent requests both read the same remaining figure, both decide the
charge is affordable, and the member ends up overdrawn. There is a test
that proves this: with the lock removed, eight concurrent 20,000원 charges
against a 100,000원 budget spend 160,000원.

A charge is paid from **one** pot, never split. Personal money is used
only when the member has enabled overage and has enough, which keeps the
Usage screen explainable and matches section 9.

**The audit log is append-only.** Nothing in the application updates or
deletes a row, and the API exposes only a list. `actor_user_id` is
`ON DELETE SET NULL` with the username denormalised, so removing an admin
account never erases the record of what they changed.

**Simulate usage** (`POST /api/admin/simulate-usage`, Admin › Dev Tools)
spent a budget without calling a provider, so the Usage screen and the
audit log could be exercised before Phases 2 and 6. Removed with Dev
Tools on 2026-10-14 (admin-and-nav-cleanup): Chat and video now charge
through `charge()` under their mocks, and no test needed it any more.
`python -m app.db.reset_dev` stays.

## Phase 2 — Chat

Implement:
- backend Claude adapter **behind `CLAUDE_PROVIDER`, mock by default**
- chat conversations/messages
- general chat
- basic intent actions/links into Builder and Video Generator
- usage event recording
- credit checks

The mock Claude provider returns canned Korean replies, so the whole of
Chat — conversation storage, routing, usage recording and budget checks —
is built and tested with no Anthropic key.

Do not create a complex AI agent router initially.
Simple explicit routing/actions are enough.

## Phase 3 — Builder MVP

> **Groundwork already exists — extend it, do not rebuild it.** The Phase 1
> branch built `BuilderProject` (model, schema, `routes/builder.py` with full
> CRUD and per-owner access), the project library at `/builder`, and the
> `/builder/[projectId]` workspace with its file tree, editor pane, Claude
> panel and `PreviewPane`. All of it persists to PostgreSQL and is covered by
> tests. **What is missing is the provider**: nothing calls Claude, no project
> files are generated, and `PreviewPane` renders a `MockRuntime` behind a
> documented adapter boundary. Phase 3 fills that in.

Implement:
- Projects — *extend the existing `BuilderProject`*
- create project from prompt
- Claude generates/edits text project files
- project file browser — *the UI shell exists; give it real files*
- simple text/code editor
- project history/save
- no arbitrary live code execution yet

## Phase 4 — GitHub Integration

Implement:
- GitHub App **behind `GITHUB_PROVIDER`, mock by default**
- connect account/install app
- authorized repository selection
- create repository if permitted
- push/commit project
- sync repository metadata

The mock provider simulates a connected account and a repository push, so
the Profile connection flow and the Builder push action are built without a
registered GitHub App. Use a **localhost callback URL** during development;
the production callback is registered in Phase 9.

## Phase 5 — CtrlAIApps

Implement:
- publish Builder project as App
- public listing
- app detail
- creator attribution
- reactions
- comments
- threaded replies
- inactive/former creator attribution

**Every listing query must filter on the project's `deleted_at`.** Deleting
is soft (`project-video-management`): the row stays so an admin can restore
it, and a member who deletes their work is told it is gone. If a published
listing joins the project without that filter, the work disappears from the
member's own library and stays on the community screen — the one place they
cannot remove it from. The models carry the same note.

## Phase 6 — Video Generator

> **Groundwork already exists — extend it, do not rebuild it.** The Phase 1
> branch built `VideoProject`, `VideoVersion` and the `VideoModel` catalogue
> (with an admin allowlist enforced in the backend: a hidden or disabled model
> is refused), `routes/video.py`, the library at `/video`, and the
> `/video/[projectId]` workspace with its iterative version loop — generate,
> compare versions, mark a final. Versions persist and are covered by tests.
> **What is missing is the provider**: creating a version records a row and
> returns a placeholder; Higgsfield is never contacted and nothing is charged.
> Phase 6 fills that in.

Implement:
- Claude prompt/script assistance
- Higgsfield provider adapter **behind `VIDEO_PROVIDER`, mock by default**
- generation request
- generation status
- final result
- Video record — *extend the existing `VideoProject` / `VideoVersion`*
- usage tracking / credit deduction

The mock video provider returns a placeholder asset after a simulated delay,
which is enough to exercise the version loop, the status transitions and the
budget deduction without spending anything.

## Phase 7 — YouTube Integration

Implement:
- Google OAuth **behind `YOUTUBE_PROVIDER`, mock by default**
- connect channel
- upload selected generated video
- title/description/privacy
- save YouTube ID
- embed in CTRL+AI

Use a **localhost callback URL** during development. Note that YouTube API
projects which have not passed Google's audit may have uploaded videos
forced to private — treat public publishing as part of Phase 9.

## Phase 8 — CtrlAITube

Implement:
- community video feed
- **entries created from a pasted YouTube URL**
- YouTube embeds
- creator attribution
- CTRL+AI reactions
- CTRL+AI comments
- threaded replies
- optionally show YouTube comments in a separate labeled area

**Every listing query must filter on the project's `deleted_at`.** Deleting
is soft (`project-video-management`): the row stays so an admin can restore
it, and a member who deletes their work is told it is gone. If a published
listing joins the project without that filter, the work disappears from the
member's own library and stays on the community screen — the one place they
cannot remove it from. The models carry the same note.

**Phase 8 does not depend on Phase 7.** A member can paste the URL of a
video they uploaded to YouTube themselves; CTRL+AI extracts the video ID and
creates the entry. Automatic publishing from Phase 7 is a convenience on top
of this, not a prerequisite — so the community feed can be built and filled
with real videos before any Google OAuth work exists.

## Phase 9 — Go Live 💳 **requires paid cloud resources**

Everything before this phase runs on a laptop. This is the only phase that
costs money and the only one that needs a domain or an API key.

> **Ask before creating any paid cloud resource.** Domains, managed
> databases, hosting plans and provider API keys all bill someone. Confirm
> first — this is also rule 5 of section 21.

> **Beta hosting is decided (2026-10-13).** The domain `ctrlai.my` is
> bought. The beta runs on one Compute Engine VM, `ctrlai-server` — an
> **e2-medium** (2 vCPU, 4 GB, paid, about US$32 a month) in **Seoul**
> (`asia-northeast3-c`), static IP `34.47.78.228` — with Docker Compose
> and PostgreSQL on the VM. It is billed on the Google Cloud free trial
> (₩407,626, 2026-10-13 to about 2027-01-11); the billing account must be
> upgraded to paid before the trial ends. See `docs/archive/done-specs.md` ›
> prep-beta-launch › **Hosting decisions — 2026-10-13**, and
> `docs/deployment.md` for the step-by-step guide. The managed PostgreSQL
> and Secret Manager lines below describe the target after the beta.

Implement:

- **domain** — register and point DNS
- **HTTPS** — certificate and redirect; no plaintext HTTP in production
- **frontend hosting** — the Next.js app, with the `/api/*` rewrite from
  Phase 1a pointing at the deployed backend
- **backend hosting** — bind the platform's port
  (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`)
- **managed PostgreSQL** — point `DATABASE_URL` at it; the database must not
  be reachable from the public internet
- **Secret Manager** — provider keys, database credentials and the session
  signing key; none of them in the repository, none in `NEXT_PUBLIC_*`
- **production CORS** — `CORS_ALLOW_ORIGINS` set to the real frontend origin
  only. With the Phase 1a rewrite the browser sees one origin, so this stays
  narrow.
- **production cookie settings** — `Secure`, `HttpOnly`, `SameSite`
- **run Alembic migrations in production** — `alembic upgrade head` as part
  of deployment. This is why Phase 1a replaced `create_all`: a production
  database is migrated, never re-created.
- **switch providers from mock to real** — flip `CLAUDE_PROVIDER`,
  `VIDEO_PROVIDER`, `GITHUB_PROVIDER`, `YOUTUBE_PROVIDER` and supply the
  keys. If this needs a code change, the provider rule was not followed.
- **update OAuth callback URLs** — replace the localhost callbacks from
  Phases 4 and 7 with production URLs, in the GitHub App and Google Cloud
  console

Deploy one piece at a time and verify each before the next. A broken
deployment with real members on it is far more expensive than a slow one.

## Later — Secure App Runtime

Only later:
- execute/run generated apps
- live preview
- deploy member apps
- isolated containers/sandbox
- resource limits
- secrets/environment variables
- deployment URLs

Never execute arbitrary member code directly on the primary backend.

---

# 23. Current status

**Phase 0 and Phase 1 are complete.** Accounts, quarters, participation,
budgets, the usage ledger and the audit log all work end to end against a
real database, with no provider connected.

- **Phase 1a** — auth: Argon2id, HttpOnly same-origin session cookie,
  real `get_current_user` / `require_admin`. Merged.
- **Phase 1b** — membership: per-quarter `QuarterMembership`,
  `require_active_member` on paid creation. Merged.
- **Phase 1c** — usage ledger and audit log: charging and the
  `UsageEvent` row in one locked transaction, the real admin member list,
  the append-only audit log. Merged.

## What to work on next

**The next task is always the top of "Next" in
[`docs/BACKLOG.md`](../BACKLOG.md)** — or whichever item the developer
names. This section does not repeat it.

That is deliberate. This file used to name the next task outright, and the
backlog was reordered twice in one day; the named task fell to seventh
place while this section still called it next. Two places claiming to hold
the same answer means one of them is wrong, and the reader cannot tell
which. The backlog is the single ordered queue (section 22), so it is the
only place the order is written.

What belongs here instead is what does *not* change when the queue is
reordered: the phase plan (section 20), the rules every phase follows, and
the standing constraints below.

No mock data remains in the money path. What is still mock: the CtrlAI
Apps and CtrlAITube listings (Phases 5 and 8) and the Chat replies
(Phase 2).

Do not start Phase 9 or create any paid cloud resource without asking
first.
