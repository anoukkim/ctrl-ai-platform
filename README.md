# CTRL+AI

A beginner-friendly AI creation community. Members describe what they want
in Korean, and CTRL+AI helps them build an app or make a short video, then
share it with the community.

Most members are not expected to code, use APIs or configure a development
environment, so the product hides that complexity. CTRL+AI owns provider
access — members never hold API keys — and records usage per member and
quarter.

`내가 원하는 것을 말한다 → CTRL+AI가 만들어 준다 → 공유한다`

# Current Status

**Phase 0 (product shell) is complete.** The repository contains a working local
slice of the product: a Next.js frontend with the full navigation and every
screen present, a FastAPI backend, and PostgreSQL via Docker Compose.

**Chat is the opening screen.** CTRL+AI is aimed at members who may not code, so
the entry point is a conversation, not a dashboard.

**The interface is Korean-first** with an English menu. See
[Language](#language).

[`CLAUDE.md`](CLAUDE.md) is the product definition and the phase plan.
[`docs/BACKLOG.md`](docs/BACKLOG.md) is the ordered queue of what happens
next. [`docs/architecture.md`](docs/architecture.md) covers the
longer-term architecture — target infrastructure, storage and security
principles.

| Area                  | State                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| Navigation & shell    | Built — sidebar with quarterly participation status; menu button on narrow screens |
| Chat (default page)   | Mock UI with quick actions and local Korean keyword routing                       |
| Project Builder       | Full-viewport workspace: files │ code │ Claude, preview and build output below    |
| Video Generator       | Full-viewport workspace with an iterative version loop (see below)                |
| CtrlAIApps            | Mock listings; detail page is a hero, one primary action and three tabs (소개 / 댓글 / 업데이트 기록) sharing CtrlAITube's comment section |
| CtrlAITube            | Mock feed; watch page is two columns — player sized by ratio, sticky comment panel; CTRL+AI comments kept separate from YouTube comments |
| Usage                 | **Live** — real budgets, real ledger, redesigned around one figure per card       |
| Profile               | Live signed-in member, quarter participation, application form and 회원 탈퇴        |
| Admin                 | **Live** — section hub, member/application/quarter figures, KRW budgets, audit log |
| Backend `/api/health` | Real and working                                                                  |
| PostgreSQL            | Real, via Docker Compose; Alembic owns the schema                                 |
| Authentication        | **Built** — register, login, logout; Argon2 hashes; HttpOnly session cookie       |
| Claude / Higgsfield   | Not started (Phases 2 and 6)                                                      |
| GitHub / YouTube      | Not started (Phases 4 and 7)                                                      |

No mock data remains anywhere money is involved. What is still mock: the
CtrlAIApps and CtrlAITube listings (Phases 5 and 8) and the Chat replies
(Phase 2).

Everything that is not built yet renders a **준비 중** badge, and its controls are
disabled, so the shell is never mistaken for working functionality.

## Routes

| Route                 | Screen          | Notes                                        |
| --------------------- | --------------- | -------------------------------------------- |
| `/login`              | 로그인          | Korean sign-in; logged-out visitors land here |
| `/signup`             | 회원가입        | Korean sign-up                                |
| `/`                   | Chat            | Default landing page (requires sign-in)      |
| `/builder`            | Project Builder | Workspace: files, code, Claude, preview      |
| `/video`              | Video Generator | Workspace: prompt, 9:16 player, Claude, versions |
| `/ctrlaistore`        | CtrlAIApps      | Community app listings                       |
| `/ctrlaistore/[slug]` | App detail      | Hero, 앱 실행, tabs; same comments as CtrlAITube |
| `/ctrlaitube`         | CtrlAITube      | Community video feed                         |
| `/ctrlaitube/[id]`    | Video detail    | CTRL+AI comments + separate YouTube section  |
| `/usage`              | Usage           | Club support and personal balance, in KRW    |
| `/profile`            | Profile         | Quarter participation, application, accounts, 회원 탈퇴 |
| `/issues`             | Report Issue    | Bug reports and ideas, via GitHub Issues     |
| `/admin`              | Admin           | Section hub: work waiting, quarter figures, cards |
| `/admin/members`      | Members         | Search, filter, sort; row opens the member   |
| `/admin/members/[id]` | Member detail   | Participation history, budgets, audit trail  |
| `/admin/applications` | Applications    | Approve or reject, with stat cards and tabs  |
| `/admin/quarters`     | Quarters        | Quarter list with figures; create a quarter  |
| `/admin/topups`       | Top-ups         | Confirm personal top-up deposits             |
| `/admin/video-models` | Video Models    | Which models members may pick                |
| `/admin/deleted`      | Deleted Items   | Restore a project or video a member deleted  |
| `/admin/audit`        | Audit Log       | Every admin change, read-only                |
| `/admin/system`       | System          | Server health and external service status    |
| `/admin/dev`          | Dev Tools       | Usage simulator; development only            |

`/admin/budget` and `/admin/content` exist in the code but are hidden from
the navigation until budget-by-provider and Phases 5/8 fill them — a menu
item that always leads to an empty screen is in the way. Turning one on is
deleting its `hidden: true` in `frontend/app/admin/sections.ts`.

The App Store route is still `/ctrlaistore` although the screen is now called
**CtrlAIApps**; the path was kept so existing links do not break.

## Name

The community is **CTRL+AI** — that is what members see in the sidebar, on
the Chat welcome and in the page title. The repository, the database and
the code keep their existing `ctrl-ai` / `ctrlai` spellings: renaming them
would break remotes and connection strings for a change nobody can see.

Product names (Chat, Project Builder, Video Generator, CtrlAIApps,
CtrlAITube, Usage, Profile, Report Issue, Admin) are unchanged, as are all
routes.

Backend endpoints: `GET /api/health`, `GET /api/users`, and `GET /docs` for the
generated API documentation.

## The two creation workspaces

Project Builder and Video Generator are sibling workspaces. Both use the full
viewport with a compact top bar, side tools, a persistent Claude panel, and a
preview — closer to a desktop application than a web page. They share their
frame in `frontend/app/components/workspace.module.css`.

**Project Builder** — selecting a file changes the editor contents. Nothing
generates or runs code: that is Phase 3, and member code will never execute on
the CTRL+AI backend.

**코드 다운로드 (ZIP)** works today, in the project's ▾ menu and in each
library card's ⋯ menu. The archive holds the project's files in their folder
structure plus a short Korean guide, and never a `.env`, a key, `node_modules`
or `.git`. Project files live in `builder_project_files`, which **Phase 3 is
what fills** — so a project made now downloads as a ZIP containing only the
guide, and the guide says so rather than explaining how to run code that is not
there. Downloading stays open to a member who is not participating this
quarter: their work is theirs.

**다운로드** works on any finished version, and keeps working for a member who
is not participating this quarter. Generated files are kept by CTRL+AI through
a storage interface (`backend/app/services/storage.py`) — a local folder in
development, cloud storage in Phase 9 — and never served from a provider URL,
which can expire or need the provider's own credentials.

Higgsfield is still not connected (Phase 6). While `VIDEO_PROVIDER=mock`, a
generated version gets a small **animated GIF placeholder**, built in pure
Python with no encoder and no ffmpeg. It is named `.gif` because that is what
it is: writing a file with an `.mp4` name that no player opens would make the
download look finished while being broken. Phase 6 swaps in Higgsfield's MP4,
and nothing downstream changes — the provider states its own content type and
extension.

**Video Generator** is deliberately not a one-shot form. It models the loop a
real creator works in:

```text
아이디어 → 생성 → 미리보기 → Claude와 상의 → 프롬프트 수정
        → 다시 생성 → 버전 비교 → 최종본 선택 → YouTube에 게시
```

For demonstration, the following actually work in the browser (mock state only,
reset on refresh): editing the Korean prompt, asking Claude for a revision and
applying it, generating a new version, switching between versions, replaying the
9:16 preview, and marking a version as final. No provider is contacted.

## Language

The interface is **Korean-first, with an English menu**.

**The navigation is English throughout** — the group headings (Create,
Explore, Account), the item names (Chat, Project Builder, Video Generator,
CtrlAIApps, CtrlAITube, Usage, Profile, Report Issue, Admin) and the Admin
section names (Dashboard, Members, Applications, Quarters, Top-ups, Video
Models, Audit Log, System, Dev Tools). A screen's own heading matches its
menu name, so the two never disagree.

External service names (Claude, Higgsfield, GitHub, YouTube) and technical
terms such as file names, code and repository names stay English as well.

**Everything else is Korean** — prompts, conversations, helper text,
explanations, buttons, comments, error messages. Members never need to write
English prompts. Where Korean body text points at a screen it uses that
screen's English name, the way "Usage 화면" already reads.

Three details matter for Korean text and are already handled:

- `word-break: keep-all`, so Korean words are not split across lines
- a Hangul-first font stack, so Korean never falls back to a substituted glyph
- IME composition is checked before Enter sends a message, so a half-formed
  syllable is never submitted

All user-facing Korean strings live either in `frontend/lib/mock-data.ts` or
directly in the page that shows them.

## Design

A single dark theme, inspired by developer tools rather than a generic
dashboard. Every colour is a token in `frontend/app/globals.css`; no component
hard-codes one. There is deliberately no light theme, so the prototype looks the
same for everyone reviewing it.

Shared classes (`.card`, `.btn`, `.badge`, `.field`, `.meter`, `.table`) also
live in `globals.css`. Anything used by one screen only lives in that screen's
CSS module.

---

# Deployment

**Nothing is deployed, and no cloud resource has been created.** Going live
is **Phase 9** — domain, HTTPS, hosting, managed PostgreSQL, Secret Manager
and switching providers from mock to real. Every phase before it is built
and tested locally with no keys and no domain.

What follows is only about an optional **frontend-only preview deploy** for
gathering feedback on the product concept. It is not Phase 9 and does not
replace it.

> **No longer true since Phase 1a.** The app now requires sign-in, and the
> browser reaches the backend through the Next.js `/api/*` rewrite. A
> frontend-only deploy shows the login screen and nothing else. Reviewing
> the product now means running both halves locally, or doing the full
> Phase 9 deployment.

## Frontend — Vercel

Every route still builds, and the production build passes.

| Setting                    | Value       | Why                                             |
| -------------------------- | ----------- | ----------------------------------------------- |
| Root Directory             | `frontend`  | This is a monorepo; do not build from the root  |
| Framework                  | Next.js     | Auto-detected                                   |
| `NEXT_PUBLIC_API_BASE_URL` | leave unset | Only the Admin status card calls the backend    |

## Backend — now required

Since Phase 1a the backend is no longer optional: sign-in, every project
list and every admin screen go through it.

Deploying the backend properly is Phase 9. In outline it needs:

- bind to the platform's port: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- set `BACKEND_ORIGIN` so the frontend's `/api/*` rewrite reaches it
- set `CORS_ALLOW_ORIGINS` to the deployed frontend's origin
- point `DATABASE_URL` at a managed PostgreSQL instance
- set `SESSION_COOKIE_SECURE=true`
- run `alembic upgrade head` as part of deployment

Alembic already owns the schema and `create_all` is gone, so that last point
is a deployment step rather than a code change.

## When the backend is unavailable

This is the normal case for a frontend-only deploy, and it is handled:

- every screen except `/admin` is unaffected
- the status card fails fast (8-second timeout) and shows **연결 안 됨**
- the card explains, in Korean, that the rest of the prototype works without it

---

# Local Development

## Prerequisites

| Tool           | Version used | Notes                                             |
| -------------- | ------------ | ------------------------------------------------- |
| Python         | 3.11+        | Backend                                           |
| Node.js        | 20+          | Frontend (Node 24 verified)                       |
| Docker Desktop | any current  | PostgreSQL only; must be running for the database |

## First-time setup

Run each block from the directory shown. Commands are written for PowerShell
on Windows.

**1. Create the environment file** (repository root):

```powershell
Copy-Item .env.example .env
```

`.env` is git-ignored. The defaults work as-is for local development.

**2. Install backend dependencies** (`backend/`):

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
```

A *virtual environment* (`.venv`) is a private copy of Python for this
project, so its packages never collide with other projects. Calling
`.\.venv\Scripts\python.exe` directly always uses it.

**3. Install frontend dependencies** (`frontend/`):

```powershell
cd frontend
npm install
```

**4. Start PostgreSQL and create the tables** (repository root, then `backend/`):

```powershell
docker compose up -d
docker compose ps          # wait until the db service reports "healthy"

cd backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.db.init_db
```

Alembic owns the schema, so the migration must run first; `init_db` only
seeds and will refuse to run before it. Seeding creates the development
user (`dev@ctrl.ai`, role `admin`), three quarters with 2026 Q4 accepting
applications, an empty personal wallet, and the video model catalogue. It
is safe to run more than once — existing rows are left alone, so a re-run
cannot undo an admin's changes.

## Signing in

Phase 1a added accounts, so the first thing the app asks for is a login.

The seed creates a development administrator:

| Field | Value |
| ----- | ----- |
| 아이디 | `dev` |
| 비밀번호 | `devpassword` |

That password is a local development convenience. `python -m app.db.init_db`
refuses to run unless `APP_ENV` is a development value, so it cannot create
this account anywhere real.

To seed your own administrator instead, set these in `.env` and re-run the
seed. They are read only by the seed script, the password is hashed with
Argon2 before it is stored, and `.env` is git-ignored:

```env
ADMIN_USERNAME=
ADMIN_EMAIL=
ADMIN_PASSWORD=
```

Leaving them blank creates no administrator — there is deliberately no
default password in the code.

Anyone else can register at `/signup`, which creates an ordinary member.

## Leaving CTRL+AI (회원 탈퇴)

A member withdraws from the bottom of **Profile**, after re-entering their
password; an admin can do the same from **Admin › Members › (member)**.
Both go through one service, `backend/app/services/withdrawal.py`, so the
rules are the same either way:

- the account becomes `former` at once, every session ends, and signing in
  is refused;
- remaining 동아리 지원 in any quarter that is not closed is **released**
  and written to the audit log (there is no club reserve to return it to
  yet — `budget-by-provider` adds one);
- a remaining 개인 충전 balance, or a top-up request nobody has reviewed,
  marks the withdrawal **환불 대기**; an admin records the refund with
  **환불 완료 기록**;
- published work stays up labelled 탈퇴 회원, or is unpublished if the
  member chose that;
- usage history is untouched, so quarter reports still add up.

For **30 days** an admin can **복구** the account, which puts back the
released budget, participation and anything unpublished. After that, a
job anonymises the username, email and display name:

```powershell
cd backend
.\.venv\Scripts\python.exe -m app.jobs.anonymise_withdrawn --dry-run   # report only
.\.venv\Scripts\python.exe -m app.jobs.anonymise_withdrawn
```

It is run from outside the server — by hand or from cron locally, by Cloud
Scheduler in Phase 9 — and is safe to run again. A withdrawal still
waiting for its refund is skipped and listed: an account is not finalised
while money is owed. The audit log is left as written; it is append-only.

### How sign-in works

```text
Browser  ->  Next.js :3000  --/api/* rewrite-->  FastAPI :8000
                 ^                                    |
                 +--------- HttpOnly cookie ----------+
```

The browser only ever talks to port 3000. Next.js forwards `/api/*` to
FastAPI, so frontend and backend are the **same origin** as far as the
browser is concerned. That is what lets the session cookie be `HttpOnly` —
no script on the page can read it, there is no token in `localStorage`, and
no cross-origin cookie configuration is needed. The same arrangement is
what gets deployed in Phase 9.

Sessions are rows in `user_sessions`, not self-contained tokens, so logging
out ends the session immediately rather than waiting for an expiry.

## Running the portal

Three processes. Use a separate terminal for each, because the two servers
keep running and print logs.

| # | Directory   | Command                                                        | URL                   |
| - | ----------- | -------------------------------------------------------------- | --------------------- |
| 1 | root        | `docker compose up -d`                                         | localhost:5432        |
| 2 | `backend/`  | `.\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000` | http://localhost:8000 |
| 3 | `frontend/` | `npm run dev`                                                  | http://localhost:3000 |

Then open **http://localhost:3000**, which lands on **Chat**.

Only one `next dev` may run at a time. If a previous one is still running,
Next.js says so and prints the command to stop it; two dev servers sharing the
same `.next` folder cause confusing build errors.

The live backend status card is on **Admin → System** (`/admin/system`):

| Card shows    | Meaning                             |
| ------------- | ----------------------------------- |
| 정상          | Backend and database both reachable  |
| 일부 장애      | Backend is up, PostgreSQL is not     |
| 연결 안 됨     | The backend itself is not reachable  |

## External services

Every provider sits behind an interface with a mock implementation, chosen
by a `*_PROVIDER` variable, and **mock is the default** — so the platform
runs with no keys (CLAUDE.md section 20).

**Admin → System** shows one card per provider: mock or real, whether a key
is configured, when it last worked, and why it last failed in Korean. The
**연결 확인** button runs a check only when pressed, using the cheapest
request available — in mock mode nothing leaves the process, and for Claude
the real check lists models, which validates the key without spending a
token. Where a real adapter does not exist yet, the check says so rather
than showing a green light that means nothing.

**No route returns a credential.** The screen asks only whether a key is
present. `backend/tests/test_admin_providers.py` searches every response
for the configured secret.

Useful extra URLs:

- http://localhost:8000/api/health - raw health JSON
- http://localhost:8000/docs - interactive API documentation, generated by FastAPI
- http://localhost:8000/api/users - the seeded development user

## Verifying the project

```powershell
# Backend tests (backend/) - no database required
.\.venv\Scripts\python.exe -m pytest

# Frontend tests, type check, lint, and production build (frontend/)
npm test
npx tsc --noEmit
npm run lint
npm run build
```

The backend tests run against a temporary in-memory SQLite database, so they
pass whether or not Docker is running. The frontend tests run in `jsdom` and
never call the backend, for the same reason: a test that needs a server
running proves less, not more.

## Stopping

```powershell
# Ctrl+C in the uvicorn and npm terminals, then from the root:
docker compose down        # stop the database, keep the data
docker compose down -v     # stop it and DELETE all local data
```

---

# How the Pieces Fit Together

Request flow, and the rule that will not change as features are added:

```text
Browser  ->  Next.js (frontend)  ->  FastAPI (backend)  ->  PostgreSQL
                                            \------------>  AI providers
```

The browser never talks to the database or to an AI provider directly. Every
request that costs money or touches data goes through the CTRL+AI backend,
because that is the only place where a permission check, a quarterly budget
limit, and a provider API key can live safely. Members never hold provider
keys; CTRL+AI owns provider access and records usage per member and quarter.

A few decisions worth knowing if you are new to this kind of stack:

- **Two servers, not one.** Next.js renders the user interface; FastAPI owns
  data and business logic. They are separate processes that talk over HTTP.
- **Different ports are different origins.** The frontend on port 3000 and
  the backend on port 8000 are, to a browser, two different websites. The
  browser therefore refuses to read the backend's responses unless the
  backend opts in. That opt-in is the CORS middleware in
  `backend/app/main.py`, which lists the allowed origins explicitly.
- **Server and Client Components.** Pages are rendered on the server by
  default and ship no JavaScript. Only the parts that need state or effects —
  the navigation, the chat composer, the backend status card — are marked
  `"use client"`.
- **Schemas are separate from models.** `app/models/` describes database
  tables; `app/schemas/` describes the JSON the API sends and receives.
  Keeping them apart means adding an internal column (a password hash, later)
  can never accidentally expose it in an API response.
- **Configuration comes from the environment.** No URL, port, or credential
  is hard-coded. `app/core/config.py` reads and validates the environment
  once at startup.
- **Providers are measured in their own units.** Claude bills in tokens and
  Higgsfield in video credits, so allocations are tracked separately rather
  than merged into one invented currency.

## Quarters, applications and money

**CTRL+AI operates by calendar quarter** — 2026 Q1, 2026 Q2, and so on.
A quarter is three months. (The earlier four-month "Season" concept is gone;
nothing in the product uses it.)

### Credits are not automatic

```text
Admin opens applications for a quarter
  -> member sees applications are open in Profile
  -> member applies, splitting their budget between Build and Video
  -> admin approves
  -> the approved allocation becomes usable
```

The Build and Video percentages must add up to exactly 100%. Each approved
member may receive at most **100,000 KRW per quarter** of club-funded
budget, combined across both:

| Split | Build | Video |
| ----- | ----- | ----- |
| 100 / 0 | 100,000원 | 0원 |
| 70 / 30 | 70,000원 | 30,000원 |
| 50 / 50 | 50,000원 | 50,000원 |
| 20 / 80 | 20,000원 | 80,000원 |
| 0 / 100 | 0원 | 100,000원 |

That figure is not a constant scattered through the code. The default lives
in `quarterly_subsidy_limit_krw` (backend settings); each quarter copies it
at creation and keeps its own, so an admin can change it for a future
quarter without altering one that already ran. The percentage-to-KRW rule
lives in `backend/app/services/budget.py`, so the API, the UI and the tests
cannot drift.

### KRW is the financial source of truth

Budgets are stored in won, never in tokens or generations. Provider prices
change, and an approved allocation must not move when they do. A
`pricing_snapshot` is captured at approval so a provider-specific quota can
still be displayed consistently afterwards.

`UsageEvent` keeps two separate figures: `provider_cost` (what the provider
charged, in their own units and currency) and `charged_krw` (what moved a
budget). Conflating them would misreport both.

### Community money and personal money are separate

A member who exhausts their community budget stops there by default.
Personal money is spent only if they have explicitly enabled it *and* have a
balance. Topping up never raises the community subsidy above the quarter's
limit, and the two are never added together in the interface.

Phase 1c uses a manual top-up workflow: the member requests an amount, an
admin confirms the deposit, and only then does the balance move. No payment
provider is involved.

### Participation status

A member who stops participating does not lose their published work:

| Status      | UI label   | Meaning                                                        |
| ----------- | ---------- | -------------------------------------------------------------- |
| `active`    | 활동 회원   | Participating this quarter; can use paid creation features      |
| `inactive`  | 비활동 회원 | Account exists, not enrolled this quarter; work is preserved    |
| `former`    | 탈퇴 회원   | Has left the community; published work keeps their attribution  |

"탈퇴 회원" is used rather than anything meaning "deleted", because
attribution on published apps and videos must continue to exist.

## Search

Contextual search, not one global search engine. Each list has the search
its own screen needs:

| Screen | Search by | Filters |
| ------ | --------- | ------- |
| Project Builder | project name, description | status |
| Video Generator | project name, prompt | status |
| CtrlAIApps | app name, description, creator | category, sort |
| CtrlAITube | title, description, creator | creator, sort |
| Admin — Members | name, username | role, account status, membership status, sort |
| Admin — Applications | member name, username | status tabs + stat cards |
| Admin — Top-ups | member name, username | top-up status |
| Admin — Audit Log | summary, admin, action, target | action |
| Admin — Video Models | model name, provider, model id | — |

Filtering currently happens in the browser, because the data is small and
each screen already holds its list. `SearchBar` only lifts the query out, so
moving to server-side search later changes the data call and not the screen.

## Environment files

| File                          | Read by                      | In git |
| ----------------------------- | ---------------------------- | ------ |
| `.env.example`                | Documentation                | yes    |
| `.env`                        | Backend and Docker Compose   | no     |
| `frontend/.env.local.example` | Documentation                | yes    |
| `frontend/.env.local`         | Frontend (optional override) | no     |

Next.js only reads `.env` files from its own directory, which is why the
frontend has a separate optional file. It is not needed locally: the frontend
defaults to `http://localhost:8000`.

Any variable prefixed `NEXT_PUBLIC_` is **embedded into the browser bundle**
and readable by anyone. A provider API key must never use that prefix.

## Repository layout

```text
ctrl-ai-platform/
├─ backend/
│  ├─ app/
│  │  ├─ api/
│  │  │  ├─ router.py         # collects all routes under /api
│  │  │  └─ routes/           # health.py, users.py
│  │  ├─ core/config.py       # environment-driven settings
│  │  ├─ db/                  # base.py, session.py, init_db.py
│  │  ├─ models/              # user, quarter, builder, video, wallet, usage
│  │  ├─ schemas/             # Pydantic request/response shapes
│  │  ├─ services/            # budget split, wallet, admin stats, providers
│  │  └─ main.py              # FastAPI app, CORS
│  ├─ alembic/                # migrations (owns the schema)
│  ├─ tests/                  # pytest suite
│  ├─ pyproject.toml          # pytest configuration
│  └─ requirements*.txt
├─ frontend/
│  ├─ app/
│  │  ├─ components/
│  │  │  ├─ AppShell.tsx           # sidebar, quarter status, workspace detection
│  │  │  ├─ SearchBar.tsx          # contextual search used by every list
│  │  │  ├─ ChatWorkspace.tsx      # Chat thread, composer, quick actions
│  │  │  ├─ Community.tsx          # creator line, reactions, comment threads
│  │  │  ├─ BackendStatus.tsx      # the one live network call
│  │  │  └─ workspace.module.css   # frame shared by the two workspaces
│  │  │  ├─ CommentSection.tsx     # reactions, tabs and comments — CtrlAIApps + CtrlAITube
│  │  ├─ builder/             # page.tsx + BuilderWorkspace.tsx
│  │  ├─ video/               # page.tsx + VideoWorkspace.tsx
│  │  ├─ ctrlaistore/         # CtrlAIApps: listings + [slug] detail
│  │  ├─ ctrlaitube/          # feed + [id] detail
│  │  ├─ usage/               # Usage
│  │  ├─ profile/             # Profile
│  │  ├─ admin/               # Admin: layout.tsx + one folder per section
│  │  │  ├─ sections.ts            # the section list — sidebar, tabs and cards read it
│  │  │  ├─ AdminQuarterProvider.tsx  # the quarter being viewed, kept in ?quarter=
│  │  │  └─ components/            # AdminTable, ConfirmDialog, RowMenu, badges
│  │  ├─ globals.css          # design tokens + shared classes
│  │  ├─ layout.tsx           # wraps every page in AppShell
│  │  └─ page.tsx             # Chat — the default landing page
│  ├─ __tests__/              # Vitest + Testing Library (jsdom, no backend)
│  └─ lib/
│     ├─ api.ts               # base URL and health client
│     ├─ http.ts              # shared request helper, timeout, error text
│     ├─ projects.ts          # Builder and Video project clients
│     ├─ quarters.ts          # quarters, applications, wallet
│     ├─ admin.ts             # Admin dashboard and member detail (read-only)
│     └─ mock-data.ts         # remaining mock content (Korean)
├─ docs/
│  ├─ BACKLOG.md              # ordered queue of upcoming work
│  └─ architecture.md         # target infrastructure, storage, security
├─ docker-compose.yml         # local PostgreSQL
├─ .env.example
├─ CLAUDE.md                  # product definition and phase plan (authoritative)
└─ README.md                  # what exists today, and how to run it
```

All mock data lives in `frontend/lib/mock-data.ts`. When a feature becomes
real, its data moves to the backend and the matching export there is deleted.

## Troubleshooting

| Symptom                                 | Fix                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Status card shows **연결 안 됨**          | The backend is not running. Start uvicorn in `backend/`. Every other screen still works.      |
| Status card shows **일부 장애**           | PostgreSQL is not running. Run `docker compose up -d` from the root.                          |
| `docker compose up` cannot connect      | Docker Desktop is not started. Launch it and wait for it to finish starting.                  |
| `relation "users" does not exist`       | Run `.\.venv\Scripts\python.exe -m app.db.init_db` from `backend/`.                           |
| "Another next dev server is running"    | Stop the old one first; the message prints its PID and the command to stop it.                |
| Odd dev-server build errors             | Stop `next dev`, delete `frontend/.next`, and start it again.                                 |
| `Activate.ps1 cannot be loaded`         | PowerShell execution policy. Skip activation and call `.\.venv\Scripts\python.exe` directly.  |
| Port 3000 or 8000 already in use        | Stop the other process, or pass `--port` to uvicorn / `npm run dev -- -p 3001`.               |

---
# Roadmap

The phase plan lives in [`CLAUDE.md`](CLAUDE.md) section 20, which is
authoritative. This table is a summary.

Every phase through 8 is built and tested **locally, with no API keys and no
domain**. Each external provider sits behind an interface with a mock
implementation chosen by an environment variable (`CLAUDE_PROVIDER`,
`VIDEO_PROVIDER`, `GITHUB_PROVIDER`, `YOUTUBE_PROVIDER`), and the mock is the
default. Going live is deliberately last.

| Phase | Scope | State |
| ----- | ----- | ----- |
| **0** | Product shell — navigation, every screen, `/api/health`, PostgreSQL | ✅ Complete |
| **1a** | Username/password auth, Alembic replacing `create_all`, Next.js `/api/*` rewrite for same-origin HttpOnly cookies | ✅ Complete (branch `phase-1a-auth`) |
| **1b** | Quarter, QuarterApplication, active/inactive/former behaviour | ✅ Complete (branch `phase-1b-membership`) |
| **1c** | QuarterAllocation, PersonalBalance/TopUp, UsageEvent, Usage on real data, admin member list, enrolment, allocation, audit log | ✅ Complete (branch `phase-1c-usage-audit`) |
| **2** | Chat — Claude adapter behind `CLAUDE_PROVIDER`, conversations, usage recording, budget checks | ← **Next** |
| **3** | Builder MVP — projects from a prompt, generated files, editor, history | Not started |
| **4** | GitHub integration — GitHub App, repository selection, push (localhost callback) | Not started |
| **5** | CtrlAIApps — publish a project, listings, reactions, threaded comments | Not started |
| **6** | Video Generator — Higgsfield adapter behind `VIDEO_PROVIDER`, generation, budget deduction | Not started |
| **7** | YouTube integration — Google OAuth, channel connection, upload (localhost callback) | Not started |
| **8** | CtrlAITube — community feed, entries from a **pasted YouTube URL**, CTRL+AI comments kept separate from YouTube's | Not started |
| **9** | **Go Live** — domain, HTTPS, hosting, managed PostgreSQL, Secret Manager, production CORS and cookies, migrations in production, providers switched to real, OAuth callbacks updated | 💳 Paid cloud resources — **ask before creating any** |
| Later | Secure runtime for member apps — isolated containers, resource limits | Not started |

Phase 8 does not depend on Phase 7: a member can paste the URL of a video
they uploaded themselves, so the community feed can be filled before any
Google OAuth work exists.

For target infrastructure, storage responsibilities and security
principles, see [`docs/architecture.md`](docs/architecture.md).
