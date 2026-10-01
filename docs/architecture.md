# Ctrl AI — Architecture Notes

Longer-term architecture: what the platform is expected to look like once it
is deployed, and the rules that hold while it is built.

**Nothing in this document is built yet.** It is direction, not status. For
what exists today see [`README.md`](../README.md); for the product
definition and the phase plan see [`CLAUDE.md`](../CLAUDE.md), which wins
wherever the two disagree.

These notes were rescued from an earlier draft of the README and corrected
to match the current product definition. The main corrections: Ctrl AI calls
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
| `POST /api/auth/register` | none | Creating the account |
| `POST /api/auth/login` | none | `former` is refused here, 403 |
| `POST /api/auth/logout` | none | Signing out must always work |
| `GET /api/auth/me` | `get_current_user` | |
| `GET /api/builder/projects` | `get_current_user` | Reading your own work |
| `GET /api/builder/projects/{id}` | `get_current_user` | Reading your own work |
| `POST /api/builder/projects` | **`require_active_member`** | Creating |
| `PATCH /api/builder/projects/{id}` | **`require_active_member`** | Editing |
| `DELETE /api/builder/projects/{id}` | **`require_active_member`** | Changing your work |
| `GET /api/video/models` | `get_current_user` | Reading the catalogue |
| `GET /api/video/projects` | `get_current_user` | Reading your own work |
| `GET /api/video/projects/{id}` | `get_current_user` | Reading your own work |
| `POST /api/video/projects` | **`require_active_member`** | Creating |
| `PATCH /api/video/projects/{id}` | **`require_active_member`** | Editing |
| `POST /api/video/projects/{id}/versions` | **`require_active_member`** | Generating — spends budget |
| `GET /api/quarters/current` | `get_current_user` | |
| `GET /api/quarters/me` | `get_current_user` | |
| `POST /api/quarters/{id}/apply` | `get_current_user` | **Deliberately open** — see below |
| `POST /api/quarters/applications/{id}/cancel` | `get_current_user` | Same |
| `GET /api/quarters/me/wallet` | `get_current_user` | Own money |
| `PATCH /api/quarters/me/wallet` | `get_current_user` | Own money, no community budget touched |
| `POST /api/quarters/me/top-ups` | `get_current_user` | Own money |
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
| `PUT /api/admin/quarters/{id}/allocations/{user_id}` | `require_admin` | |
| `PUT /api/admin/members/{user_id}/role` | `require_admin` | |
| `GET /api/admin/top-ups` | `require_admin` | |
| `POST /api/admin/top-ups/{id}/confirm` | `require_admin` | |
| `GET /api/admin/video-models` | `require_admin` | |
| `PATCH /api/admin/video-models/{id}` | `require_admin` | |
| `GET /api/admin/audit` | `require_admin` | Read-only; the log is append-only |
| `POST /api/admin/simulate-usage` | `require_admin` | 404 outside development |
| `GET /` | none | Service banner |

Two entries that look like exceptions and are not:

* **Applying for a quarter stays on `get_current_user`.** Applying is the
  only way to stop being inactive. Guarding it with
  `require_active_member` would be a locked door whose key is behind it.
* **Admin routes are guarded by role, not participation.** An admin who
  sat out the quarter still has to run the community. The same admin is
  still refused on every creation route above: the role opens Admin, it
  does not open creation.

### Not yet in the table

Chat has no backend route — the replies are chosen in the browser, and
Phase 2 builds the real one. The Claude panels in Project Builder and
Video Generator are the same. **Each must be created with
`require_active_member` already on it**, not have it added later: a rule
applied after the fact is a rule that was missing for every release
before it.

The browser also hides and disables these controls, which is a courtesy
and nothing more.

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
(`CLAUDE_PROVIDER`, `VIDEO_PROVIDER`, `GITHUB_PROVIDER`, `YOUTUBE_PROVIDER`).
See section 20 of `CLAUDE.md`.

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

## Database tables

The tables that matter are specified in section 14 of `CLAUDE.md` — `User`,
`Quarter`, `QuarterApplication`, `QuarterAllocation`, `PersonalBalance`,
`PersonalTopUp`, `UsageEvent`, `Project`, `App`, `Video`, their reaction and
comment tables, and `ConnectedAccount`. That section is authoritative; this
document does not duplicate it.

Alembic owns the schema. `create_all` is not used, and a production database
is migrated, never re-created.

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
