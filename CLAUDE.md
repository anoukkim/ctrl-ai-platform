# CTRL+AI — Product + Claude Code Project Instructions

Slimmed on 2026-10-14 (docs-cleanup): this file holds the product
principle, the settled decisions, the standing rules (providers, money,
security) and the working method. What moved, and where:

| Was here | Now lives in |
| -------- | ------------ |
| Screens, routes, language, design, money mechanics, withdrawal | [`docs/product.md`](docs/product.md) |
| Product-area direction (Chat router, Builder, CtrlAIApps, Video, YouTube, CtrlAITube, Admin-eventually) | [`docs/product.md`](docs/product.md) › Direction |
| Request flow, endpoint guards, provider boundary, data model, target infrastructure | [`docs/architecture.md`](docs/architecture.md) |
| The long phase plan (Phases 0–9 in full) and the Phase 0–1c delivery history | [`docs/archive/phases.md`](docs/archive/phases.md) |
| Order of work and open specs | [`docs/BACKLOG.md`](docs/BACKLOG.md) · milestones in [`docs/ROADMAP.md`](docs/ROADMAP.md) |

Older code comments and docs cite this file's pre-2026-10-14 section
numbers. The map: §9–10 (money, quarters) → section 4 here · §11 → 5 ·
§13 → 6 · §14 (data model) → `docs/architecture.md` · §15 → 3 ·
§16 and §20's provider rule → 7 · §17 → 8 · §18–19 → 9 · §20 (phases) →
10 + `docs/archive/phases.md` · §21 → 11 · §22 → 12 · §23 → 13.

---

# 1. Product summary

Repository: `anoukkim/ctrl-ai-platform` (the repository name stays as it
is).

The community is called **CTRL+AI**. That is the name members see — in
the sidebar, on the Chat welcome, and in the page title. The repository,
the database and the code keep their existing `ctrl-ai` / `ctrlai`
spellings; renaming them would break remotes and connection strings for a
change nobody can see.

CTRL+AI is a beginner-friendly AI creation community. Most members are
entry-level users who may not know how to code, use APIs or configure
development environments. The product must feel simple and guided.

**The core principle — members should not need to understand technical
architecture:**

`내가 원하는 것을 말한다 → CTRL+AI가 만들어 준다 → 공유한다`

For apps: `Chat/Idea → Builder → Claude-assisted project → GitHub →
Publish → CtrlAIApps`. For videos: `Chat/Idea → Video Generator → Claude
assists prompt → Higgsfield generates → library → YouTube → CtrlAITube`.

The opening screen is **Chat** — both a general Claude chat and the
natural-language router into every feature. The main product areas:
Chat · Builder (screen name **Project Builder**) · Video Generator ·
**CtrlAIApps** (route `/ctrlaistore`) · CtrlAITube · **Usage** · Profile
· Admin.

# 2. Settled decisions

No longer up for debate:

| Decision | Settled as |
| -------- | ---------- |
| Interface language | **Korean-first, with an English menu.** Everything a member reads or writes is Korean, except the navigation (group headings and item names), the Admin section names, and external service names (Claude, Higgsfield, GitHub, YouTube). |
| App store screen name | **CtrlAIApps.** The route stays `/ctrlaistore` so existing links do not break. |
| Usage screen name | **Usage** — not "Usage & Credits", "My Credits" or "Balance". Route `/usage`. |
| Participation period | **Quarter — three months** (2026 Q1, 2026 Q2, …). The earlier four-month "Season" concept is retired. |
| Roles | **`admin` and `member` only.** |
| Quarter support | **One 동아리 지원 wallet per member per quarter** (owner, 2026-10-08, `single-wallet`) — 80,000원 by default, set per quarter. Chat, video and every other paid feature spend from it; there is no Build/Video split. The club still buys credit per provider, forecast from usage by provider. See section 4. |
| Personal top-ups | **Not offered** (owner, 2026-10-14, `personal-topup-off`). Members see only the 동아리 지원 wallet; the tables, routes and admin screen are kept behind `PERSONAL_TOPUP_ENABLED=false` for `personal-topup-ui` later. See section 4. |
| Sign-in | **Google or username/password — both, for everyone** (owner, 2026-10-14, `member-password-login`). See section 5. |
| Feedback | **No menu item** (`admin-and-nav-cleanup`, 2026-10-14). The 의견 보내기 button in the sidebar footer is the one way a member sends a note; `/issues` is gone (redirects to Chat). |
| Club name | **CTRL+AI**, shown wherever a member reads the name. Product names and routes are unchanged. |

# 3. Navigation

Entirely in **English** — group headings and item names alike; everything
outside the menu that a member reads is Korean.

```text
CTRL+AI

Create            Explore          Manage (admins only)   Account
  Chat              CtrlAIApps       Admin ▸ sections       Usage
  Project Builder   CtrlAITube                              Profile
  Video Generator
```

The groups run in that order, each with the same heading style; the
collapsed icon rail shows a divider between groups instead of headings.
**Manage** (owner decision 2026-10-14, replacing the earlier "no Manage
group") is shown to admins only and holds the **Admin** item; members
never see it or anything under it, and the admin's name in the account
area carries a small **관리자** badge. Admin pages keep the breadcrumb
"Admin › …". Admin is a single expanding item (its open/closed state is
remembered) whose sections are defined **once**, in
`frontend/app/admin/sections.ts`, which the sidebar, tabs, breadcrumbs,
dashboard cards and each section's own heading all read. Eleven sections
are visible (Dashboard, Members, Applications, Quarters, Budget, Video
Models, AI Models, Feedback, Deleted Items, Audit Log, System); a section
whose feature has not landed — Content (Phases 5/8), Top-ups
(`personal-topup-off`) — stays in the code with its route and a `hidden`
flag.

**AI Models** (`/admin/ai-models`; `/admin/claude-models` redirects)
groups the chat catalogue by provider, Anthropic (Claude) first. A
provider without an adapter shows **연결 준비 중**: its models can be
listed and priced but never opened or made the default — the backend
refuses (`chat_models.check_open`). **Deleted Items** restores
soft-deleted member work.

# 4. Money

- **One wallet.** A member has one 동아리 지원 balance per quarter;
  every paid feature spends from it through `usage.charge()` — the only
  place money comes off a budget, in one locked transaction with its
  `UsageEvent`. The 채팅/영상/기타 lines on Usage are information, never
  limits.
- **KRW is the financial source of truth.** Wallets are stored in won,
  never in tokens or generations: provider prices change, and an approved
  wallet must not move when they do. `provider_cost` (what the provider
  charged) and `charged_krw` (what moved a budget) are deliberately
  separate figures on every usage event.
- **Credits are not automatic.** Admin opens applications for a quarter →
  the member presses 이번 분기 참여 → admin approves → the wallet exists
  (copied from the quarter's `subsidy_limit_krw`, so later changes to the
  quarter never move an existing wallet). The default amount lives in
  configuration, copied per quarter at creation.
- **A charge is paid from one pot, never split.** Personal money — while
  `personal-topup-off` stands, there is none to spend: the member-facing
  개인 잔액 is gone, the routes refuse in Korean, and `charge()` ignores
  any old opt-in. When `personal-topup-ui` turns it back on: wallet
  first, personal only when the member opted in and it covers the whole
  charge; club support and personal money are never added together. The
  member-facing labels are **동아리 지원** and **개인 충전**.
- **Participation is per quarter** (`QuarterMembership`; a missing row
  means "not participating"), separate from `User.account_status`:
  - **active** — may create; everything works.
  - **inactive** — may sign in and read everything they own; paid
    creation refused by `require_active_member`. Their work never
    disappears.
  - **former** — cannot sign in; the account is kept so published work
    stays attributed (탈퇴 회원 label). True deletion/anonymisation is
    its own flow (`account-withdrawal`), never an overload of `former`.
- Do **not** delete work because someone sat out a quarter. Account,
  quarterly participation and published work are three separate things.

# 5. Accounts and sign-in

**Members sign in with Google or with username and password — both, for
everyone** (`member-password-login`, 2026-10-14). Sign-up is with Google
(first sign-in leads to a username/display-name setup screen) or with
username + email + password; **an invite code is required either way**
(`invite-only-signup`).

- Sign-in scopes are `openid email profile` only; YouTube's upload scope
  is asked for later by incremental authorization (Phase 7).
- **Accounts are linked by Google's stable `sub`, never by email.** An
  existing account is never entered because an email matches; members
  link Google from Profile while signed in.
- Profile › 로그인 방법: either method can be added or removed — removal
  only while the other remains, checked in the backend under a row lock.
  Changes re-ask the current password and are counted by the sign-in
  attempt limiter.
- The backend does the whole OAuth exchange (`state` + PKCE); the client
  secret lives only in the server `.env`; the browser gets the same
  HttpOnly session cookie as always and never a Google token. Google
  sign-in has a mock for development (`GOOGLE_LOGIN_PROVIDER=mock`).
- The admin: the account whose verified Google email equals `ADMIN_EMAIL`
  becomes admin **at creation**; the dev seed also honours `ADMIN_*`
  variables.
- Sessions are **rows** (`user_sessions`), so sign-out and deactivation
  bite on the next request. Passwords are Argon2id; `password_hash`
  appears in no response schema.

# 6. Roles

`admin` and `member` — nothing else. No moderator, no developer role, no
RBAC: any active member may create, and being a project's owner is what
makes someone its developer.

# 7. Providers and the provider rule

Use **Claude** for chat, Builder assistance, code generation and prompt
help; **Higgsfield** for video generation; **GitHub** (a GitHub App, per
member) for repositories; **Google/YouTube** (OAuth, per member) for
channel connection and uploads. Application provider calls go through the
backend — a member's own Claude subscription is unrelated to CTRL+AI's
API access, and members never hold provider keys.

**Every external provider sits behind a provider interface with a mock
implementation, chosen by an environment variable. The mock is the
default.**

| Provider | Variable | Values |
| -------- | -------- | ------ |
| Claude | `CLAUDE_PROVIDER` | `mock` (default) \| `anthropic` |
| Higgsfield | `VIDEO_PROVIDER` | `mock` (default) \| `higgsfield` |
| GitHub | `GITHUB_PROVIDER` | `mock` (default) \| `github` |
| Google/YouTube | `YOUTUBE_PROVIDER` | `mock` (default) \| `google` |
| Google sign-in | `GOOGLE_LOGIN_PROVIDER` | `mock` (development only) \| `google` |

(Feature switches such as `PERSONAL_TOPUP_ENABLED` follow the same
spirit: default to the safe value, enforce in the backend.)

Consequences, all deliberate:

- Every piece of work can be built, run and tested with **no API keys and
  no domain**. Tests run against mocks and never contact a paid API.
- A mock returns plausible, deterministic data so screens and the usage
  ledger can be exercised end to end — including failure paths.
- Switching to a real provider is a configuration change. If swapping the
  variable requires touching a screen or a route, the interface was drawn
  in the wrong place.
- OAuth development uses **localhost callback URLs**; production
  callbacks are registered at go-live.

The catalogues already follow this shape: `VideoModel` and `ChatModel`
rows live in the database with a `provider` field naming who serves them.

# 8. Security rules

Non-negotiable:

- never commit secrets
- never store plaintext passwords
- never expose Anthropic/Higgsfield master credentials in frontend
- never expose Google client secret
- never expose OAuth refresh tokens
- do not ask members to paste GitHub PATs
- authorization must be checked in backend
- inactive/former users must lose paid creation access
- provider usage must be attributable to a user and quarter
- arbitrary generated app code must NOT execute on the main backend
- app execution requires an isolated sandbox/runtime later
- production credentials belong in a secret manager
  - **Beta-only exception (decided by the owner, 2026-10-07):** on the
    single beta VM, production secrets may live in a `.env` file, provided
    it is readable only by the deploy user (`chmod 600`), never committed
    and never baked into a Docker image; the Anthropic key has a monthly
    spend limit set in the Anthropic Console; and every key is rotated
    when the secrets move to Secret Manager after the beta. See
    `docs/archive/done-specs.md` › prep-beta-launch › **Hosting decisions
    — 2026-10-13**.
- maintain audit logs for admin credit/membership changes (the audit log
  is append-only; nothing updates or deletes a row)

# 9. Target stack and environment

Frontend: Next.js, React, TypeScript. Backend: Python, FastAPI, Pydantic,
SQLAlchemy, Alembic. Database: PostgreSQL (local via Docker Compose;
managed later). Alembic owns the schema — every change is a migration;
`create_all` exists only in the tests' fixtures. The frontend proxies
`/api/*` to the backend (one origin, HttpOnly session cookie).

**Environment variables: [`.env.example`](.env.example) is the single
authoritative, commented list** — add every new variable there, with its
default and when it is needed. Rules:

- Never commit a real `.env`.
- Never put secrets in `NEXT_PUBLIC_*` — that prefix embeds the value in
  the browser bundle.
- An empty provider key is not an error while that provider is `mock`; a
  missing key must fail **at startup** only when the real implementation
  is selected.

# 10. Phases and the standing rules they left

Phases are **feature names** (the numbering is historical); the plan text
is archived in [`docs/archive/phases.md`](docs/archive/phases.md), and
what to build next is always [`docs/BACKLOG.md`](docs/BACKLOG.md) › Next.

| Phase | Feature | State |
| ----- | ------- | ----- |
| 0–1c | Shell, auth, quarters, ledger, audit | done |
| 2 | Chat (mock Claude by default) | done |
| 3 | Builder MVP (Claude writes project files) | groundwork done; `builder-static-runtime` absorbs it |
| 4 | GitHub integration (GitHub App, per member) | not started |
| 5 | CtrlAIApps (publish, listings, comments) | not started |
| 6 | Video Generator (real Higgsfield adapter) | mock done |
| 7 | YouTube (per-member OAuth upload) | not started |
| 8 | CtrlAITube (feed from pasted YouTube URLs; **does not depend on 7**) | not started |
| 9 | Go live beyond the beta (managed DB, Secret Manager, real callbacks) | beta subset done |

Standing rules that bind future work:

- **Build locally first; the mock is the default** (section 7). Nothing
  before go-live needs a key or a domain.
- **Phases 5 and 8: every listing query must filter the underlying
  project's `deleted_at`.** Deleting is soft; published listings must not
  resurface work a member removed.
- **Never execute member code on the main backend** — the later runtime
  is isolated containers with resource limits.
- **Do not start Phase 9 work or create any paid cloud resource without
  asking first.** Domains, managed databases, hosting plans and API keys
  all bill someone.
- Deployment is one piece at a time, each verified before the next; the
  beta runs on `ctrlai-server` per [`docs/deployment.md`](docs/deployment.md).

# 11. Claude working method

At the beginning of every task:

1. run `pwd`
2. run `git status`
3. read `README.md`
4. read `CLAUDE.md`
5. read `docs/BACKLOG.md` — it decides what to work on (section 12)
6. read `docs/ROADMAP.md` — which milestone the work belongs to
7. read the `docs/` file relevant to the task — `development.md` to run
   or test, `product.md` for screens and rules, `deployment.md` for
   hosting, `architecture.md` for guards, providers and the data model
8. inspect relevant project files
9. explain the next small milestone
10. implement incrementally
11. run tests/build
12. summarize: what changed, changed files, commands to run, what remains

The primary developer knows Python but is learning full-stack
architecture. Explain unfamiliar concepts briefly and clearly. Do not
overengineer. Do not claim something works unless verified.

Ask before:

- deleting significant files
- force-pushing
- rewriting Git history
- creating paid cloud resources
- major architecture changes

# 12. Git workflow

## One branch per item

Each backlog item is built on **its own branch**, named by type —
`feat-`, `fix-`, `docs-`, `chore-` or `refactor-` plus the item's
kebab-case name — created from an **up-to-date `main`**:

```bash
git checkout main
git pull
git checkout -b feat-token-guard
```

(History note: until 2026-10-14 the rule was `phase-<id>-<short-name>`;
merged branches keep whatever name they had.)

## While working

Commit in **small logical steps** — not one large commit at the end, with
conventional messages:

| Prefix | For |
| ------ | --- |
| `feat:` | a new capability |
| `fix:` | a bug fix |
| `docs:` | documentation only |
| `test:` | tests only |
| `chore:` | tooling, dependencies, configuration |
| `refactor:` | behaviour-preserving restructuring |

A commit should be reviewable on its own and leave the project working.

## Before every commit

Run `git status` and **confirm none of these are staged**:

- `.env`, `.env.local`, or any real environment file
- `.venv/`, `node_modules/`, `.next/`
- API keys, passwords, OAuth client secrets, refresh tokens, private key
  files, database credentials, generated secret files

**If a secret is ever staged, stop immediately and tell the developer.**
Do not quietly unstage it and carry on, and do not commit "just to fix it
next" — a secret that reaches a commit must be treated as compromised and
rotated, which is the developer's decision to make.

## When the item is done

1. Run **all tests** and the **build**.
2. Report what changed, what passes, and what remains.
3. **WAIT.**

**Do not merge into `main` until the developer explicitly says the item
is approved.** Finishing the work is not approval. A green test run is
not approval. Only the developer saying so is approval. (A written
owner instruction can pre-approve a named batch — the instruction says
so explicitly, and its scope is exactly what it names.)

## On approval

```bash
git checkout main
git merge --no-ff feat-token-guard   # a merge commit, so the item stays visible
git push origin main
git branch -d feat-token-guard
git status                           # confirm clean
```

Then confirm to the developer that `git status` is clean.

## Documentation commits while a branch is in progress

Backlog and documentation edits are often committed on `main` while real
work sits on a branch. Two rules follow:

- **Go back to the working branch afterwards.** Leaving the session on
  `main` is how the next change lands on the wrong branch.
- **End every report with the branch you are on.** One line, last thing.

## Never

- **never force-push** (`--force`, `--force-with-lease`)
- **never rewrite history** (`rebase`, `reset --hard`, `commit --amend`
  on anything already pushed)
- **never delete `main`**
- **never squash Alembic migrations**

Ask first before anything destructive — discarding changes, deleting
branches other than a merged item branch, resetting, or dropping a
database.

## The backlog decides what gets worked on

[`docs/BACKLOG.md`](docs/BACKLOG.md) is the single ordered queue of
upcoming work, so that work arrives in one place and in one order.

- **At the start of every session, read `docs/BACKLOG.md`.**
- **Work only on the item the developer names**, or the top of **Next**
  if they say *"next item"*.
- **A new UI request mentioned mid-item goes to "UI requests"** and is
  not built in the current branch unless the developer says *"do it now"*.
- **When an item is merged, move it to Done** — a row in
  [`docs/archive/done.md`](docs/archive/done.md), its full spec to
  [`docs/archive/done-specs.md`](docs/archive/done-specs.md), and out of
  **Next**. Keeping the backlog current is part of finishing an item.

# 13. Current status

**What to work on next is always the top of "Next" in
[`docs/BACKLOG.md`](docs/BACKLOG.md)** — or whichever item the developer
names. This file deliberately does not repeat it: two places claiming the
same answer means one of them is wrong.

Standing facts that do not change when the queue is reordered:

- Accounts, quarters, participation, wallets, the usage ledger and the
  append-only audit log work end to end on a real database. No mock data
  remains in the money path.
- Still mock: the Claude replies (`CLAUDE_PROVIDER=mock`), video assets
  (placeholder clips), Google sign-in in development, and the CtrlAIApps
  / CtrlAITube listings (Phases 5 and 8).
- The invite-only beta's code is deployed to `ctrlai-server` on mock
  providers ([`docs/deployment.md`](docs/deployment.md)); done items and
  dates are in [`docs/archive/done.md`](docs/archive/done.md).
