# Development

Everything about running CTRL+AI on a laptop: setup, sign-in, how the
pieces fit together, environment files, providers, tests, troubleshooting
and the operator notes. Moved here from the repository README and
`docs/BACKLOG.md` on 2026-10-07; the text is unchanged.

The short version is in the [README](../README.md#quick-start).

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

### Resetting the local test data

To throw the local database away and start again from a fresh seed:

```powershell
cd backend
.\.venv\Scripts\python.exe -m app.db.reset_dev        # asks you to type "reset"
.\.venv\Scripts\python.exe -m app.db.reset_dev --yes  # no question
```

It drops every table, runs the migrations from the start, empties the
local storage folder (`backend/var/storage`) and runs `init_db` again. It
**refuses** unless `APP_ENV` is development **and** `DATABASE_URL` points
at this machine (`localhost` / `127.0.0.1`) — both checks, because either
alone can be wrong. A deployed database is never reset; it is restored
from a backup (`docs/deployment.md`, step 8).

## Signing in

Phase 1a added accounts, so the first thing the app asks for is a login.

**Google or username and password** (member-password-login, 2026-10-14).
The login screen has both. With `GOOGLE_LOGIN_PROVIDER=mock` (the default)
**Google로 계속하기** opens a stand-in "Google" page on the backend where
you type an email, an account id (`sub`) and whether the email is verified
— development only. An unknown `sub` goes to the setup screen (username,
name, invite code `DEV-WELCOME`); a known one signs straight in. The
username/password form below it is where the seeded `dev` account signs
in.

The seed also makes one member for each way in (password
`memberpassword` where there is one) and a single-use code nobody has
used, `DEV-TRY-ONCE`:

| 아이디 | 로그인 방법 | 목업 Google `sub` |
| ------ | ----------- | ----------------- |
| `pw_member` | 비밀번호만 | — |
| `google_member` | Google만 | `mock-sub-google-member` |
| `both_member` | 둘 다 | `mock-sub-both-member` |

The seed creates a development administrator:

| Field | Value |
| ----- | ----- |
| 아이디 | `dev` |
| 비밀번호 | `devpassword` |

That password is a local development convenience. `python -m app.db.init_db`
refuses to run unless `APP_ENV` is a development value, so it cannot create
this account anywhere real.

To seed your own administrator as well, set these in `.env` and re-run
the seed. The password is hashed with Argon2 before it is stored, and
`.env` is git-ignored:

```env
ADMIN_USERNAME=
ADMIN_EMAIL=
ADMIN_PASSWORD=
```

Leaving `ADMIN_USERNAME` blank creates no extra administrator — there is
deliberately no default password in the code.

**On the server it is different.** The production database starts empty
(prep-beta-launch, Launch data rules): after the migrations,
`python -m app.db.bootstrap` creates only the administrator from these
three variables, plus the video model catalogue — no `dev` account, no
quarters, no sample data. Outside development the server refuses to start
while `ADMIN_PASSWORD` is a known default (`devpassword`, `admin`,
`password`, the `.env.example` placeholder) or shorter than 12 characters,
and refuses the development database password. The full guide is
[`deployment.md`](deployment.md).

Signing up at `/signup` needs an **invite code** in every environment
(invite-only-signup). The development seed adds `DEV-WELCOME` (100
sign-ups) so it can be tried locally; on a server, an admin makes codes in
Admin › Members › 초대 코드 and sends the `/signup?code=…` link.

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
present. `backend/tests/test_admin_providers.py` and
`backend/tests/test_chat.py` search every response for the configured
secret.

### Claude in Chat

The mock streams canned Korean replies and charges the member's wallet as if
it were the conversation's chosen model (chat-model-choice: Sonnet 5.5 by
default, Haiku 4.5 if the member picks it), so the ledger and the budget
behave as they will for real. The model comes from the catalogue in
Admin › Claude Models; `ANTHROPIC_MODEL` is only the fallback when that
catalogue is empty. To see an error path without a key,
put a marker in a message:

| Message contains | Shows |
| ---------------- | ----- |
| `[mock-error:auth]` | invalid key |
| `[mock-error:credit]` | out of provider credit |
| `[mock-error:rate_limited]` | Claude's rate limit |
| `[mock-error:timeout]` | timeout |
| `[mock-error:unavailable]` | network / overloaded |
| `[mock-refusal]` | Claude declining |

A failed call is never charged. The real adapter's tests talk to a fake
transport inside the test process — no test contacts Anthropic. **The test
suite blanks every provider credential and forces every provider to
`mock`** (`tests/conftest.py`), because Settings also read `.env`: once a
real key is there, a test that switches Claude to `anthropic` without a
fake transport would otherwise call the paid API — which happened twice on
2026-10-13 before this guard existed (two short prompt-helper calls).

The mock also simulates **prompt caching** (`MockPromptCache`): the first
reply in a conversation writes the cache, later replies read it, entries
expire after the TTL and are per model, and prompts under a model's minimum
(512 tokens; Haiku 4.5: 4,096) are not cached — so the ledger's three input
prices are exercised without a key.

The chat settings are `CHAT_*`, not `CLAUDE_*`, on purpose: **Claude Code
sets `CLAUDE_EFFORT` in its own terminals**, and a backend started from one
would have picked it up as its own setting.

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

**A few tests need real PostgreSQL** — the wallet's row lock and the last
use of an invite code, which SQLite cannot show. They run on a **separate
test database** (test-database-isolation), never on `DATABASE_URL`:

- `TEST_DATABASE_URL`, default
  `postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai_test` — the
  same Docker Compose server, a different database, created on first use;
- emptied and **migrated with `alembic upgrade head`** at the start of a
  run, emptied again at the end;
- the run **refuses to start** if `TEST_DATABASE_URL` names the same
  database as `DATABASE_URL`, however it is spelled, and **fails** if
  anything changed `DATABASE_URL`'s tables or `alembic_version`;
- with Docker down those tests skip and everything else still runs.

Before anything is dropped, the fixture also checks what the server
reports: the test database's name must end in `_test`, the URL may not
carry `dbname`, `host` or `service` in its query, `current_database()`
must be that name, and the server must not report the same database as
`DATABASE_URL`'s. The after-run check compares tables and
`alembic_version` only — a stray *row* written into the development
database would not be caught by it, so tests must use the fixtures.

## Stopping

```powershell
# Ctrl+C in the uvicorn and npm terminals, then from the root:
docker compose down        # stop the database, keep the data
docker compose down -v     # stop it and DELETE all local data
```

## Running the production stack locally

`docker-compose.prod.yml` is what the server runs (Caddy, Next.js,
FastAPI, PostgreSQL). To prove a change still starts as a whole before it
is deployed, build and run it on this machine — the recipe, with a
separate env file and project name so it never touches the development
database, is the appendix of [`deployment.md`](deployment.md). Last run
on 2026-10-13: all four services healthy, about 280 MB of memory in total.

## How the Pieces Fit Together

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
│  │  ├─ db/                  # base.py, session.py, init_db.py (dev seed),
│  │  │                       # bootstrap.py (server: admin only), reset_dev.py
│  │  ├─ models/              # user, quarter, builder, video, wallet, usage
│  │  ├─ schemas/             # Pydantic request/response shapes
│  │  ├─ services/            # usage (the one wallet), quarter budget, admin stats, providers
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

## Operator notes

Things that look like product bugs and are not. Written down because
each one cost an investigation.

- **Restart a `next dev` that has been up for days, and delete `.next`
  if it goes slow.** Turbopack keeps a persistent dev cache under
  `.next/dev/cache/turbopack/`. It grows without bound and compacts
  continuously; after six days it was 662 MB inside an 884 MB `.next`,
  and the dev server burned **92% of a core while idle** at 1.36 GB RSS.
  Pages took 12 s and the API proxy 8 s, while the backend answered the
  same requests in 25–66 ms. Stopping the server, deleting `.next` and
  restarting took `/video` from 12,235 ms to 75 ms and idle CPU to 2%.
  Nothing in the repository caused it and nothing in the repository
  fixes it — it is maintenance:

  ```bash
  # stop next dev, then
  rm -rf frontend/.next && cd frontend && npm run dev
  ```

- **`alembic` can take about two minutes per command on Windows** while
  the app itself answers in 0.1 s. Unconfirmed suspicion: `localhost`
  resolves to IPv6 `::1` first, and Docker publishes PostgreSQL on
  `127.0.0.1` only, so each connection waits for the IPv6 attempt to
  fail. Try `127.0.0.1` instead of `localhost` in `DATABASE_URL` and time
  `alembic current`; if it fixes it, change `.env.example` too. Until
  then, give a slow `alembic upgrade head` a couple of minutes before
  stopping it.

- **`pytest` used to write to the database named by `DATABASE_URL`**
  (until 2026-10-13): the row-lock test called `create_all` on the
  development database, which created a branch's tables without its
  migrations. `test-database-isolation` moved those tests to their own
  database. If an old run left a stray table, drop it before migrating.
