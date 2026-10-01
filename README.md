# ctrl-ai-platform
Community AI platform for shared LLM access, video generation, coding agents, app deployment, and member-built AI services on shared cloud infrastructure.

# Ctrl AI

Ctrl AI is a community AI platform designed to provide shared access to AI models, development tools, media generation, and deployable applications through a single online portal.

The platform combines cloud-hosted AI infrastructure with external AI APIs so members can create, build, run, store, and share AI-powered projects from one environment.

# Current Status

**Phase 0 (product shell) is complete.** The repository contains a working local
slice of the product: a Next.js frontend with the full navigation and every
screen present, a FastAPI backend, and PostgreSQL via Docker Compose.

**Chat is the opening screen.** Ctrl AI is aimed at members who may not code, so
the entry point is a conversation, not a dashboard.

**The interface is Korean-first** with English product names. See
[Language](#language).

> **Note on this document.** `CLAUDE.md` is the current product definition. The
> older vision sections further down this README predate it and use earlier
> working names (Ctrl Code, Ctrl Apps). Where the two disagree, `CLAUDE.md` wins.

| Area                  | State                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| Navigation & shell    | Built — sidebar with quarterly participation status; menu button on narrow screens |
| Chat (default page)   | Mock UI with quick actions and local Korean keyword routing                       |
| Project Builder       | Full-viewport workspace: files │ code │ Claude, preview and build output below    |
| Video Generator       | Full-viewport workspace with an iterative version loop (see below)                |
| CtrlAI Apps           | Mock listings plus detail pages with reactions and threaded comments              |
| CtrlAITube            | Mock feed plus detail pages; Ctrl AI comments kept separate from YouTube comments |
| Usage                 | Mock per-provider balances, each in its own unit                                  |
| Profile               | Live quarter participation and application form; connected-account placeholders   |
| Admin                 | Live quarters, application review, video model catalogue; backend status card     |
| Backend `/api/health` | Real and working                                                                  |
| PostgreSQL            | Real, via Docker Compose                                                          |
| Authentication        | Not started (Phase 1)                                                             |
| Claude / Higgsfield   | Not started (Phases 2 and 6)                                                      |
| GitHub / YouTube      | Not started (Phases 4 and 7)                                                      |

Everything that is not built yet renders a **준비 중** badge, and its controls are
disabled, so the shell is never mistaken for working functionality.

## Routes

| Route                 | Screen          | Notes                                        |
| --------------------- | --------------- | -------------------------------------------- |
| `/`                   | Chat            | Default landing page                         |
| `/builder`            | Project Builder | Workspace: files, code, Claude, preview      |
| `/video`              | Video Generator | Workspace: prompt, 9:16 player, Claude, versions |
| `/ctrlaistore`        | CtrlAI Apps     | Community app listings                       |
| `/ctrlaistore/[slug]` | App detail      | Reactions and threaded comments              |
| `/ctrlaitube`         | CtrlAITube      | Community video feed                         |
| `/ctrlaitube/[id]`    | Video detail    | Ctrl AI comments + separate YouTube section  |
| `/usage`              | Usage           | Community support and personal balance, in KRW |
| `/profile`            | Profile         | Quarter participation, application, accounts |
| `/admin`              | Admin           | Members, quarters, applications, video models |

The App Store route is still `/ctrlaistore` although the screen is now called
**CtrlAI Apps**; the path was kept so existing links do not break.

Backend endpoints: `GET /api/health`, `GET /api/users`, and `GET /docs` for the
generated API documentation.

## The two creation workspaces

Project Builder and Video Generator are sibling workspaces. Both use the full
viewport with a compact top bar, side tools, a persistent Claude panel, and a
preview — closer to a desktop application than a web page. They share their
frame in `frontend/app/components/workspace.module.css`.

**Project Builder** — selecting a file changes the editor contents. Nothing
generates or runs code: that is Phase 3, and member code will never execute on
the Ctrl AI backend.

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

The interface is **Korean-first**. Product and feature names stay in English
(Ctrl AI, Chat, Project Builder, Video Generator, CtrlAI Apps, CtrlAITube,
Usage, Profile, Admin), as do external service names (Claude, Higgsfield,
GitHub, YouTube) and technical terms such as file names, code and repository
names. Everything a member reads or writes — prompts, conversations, helper
text, comments, error messages — is Korean. Members never need to write English
prompts.

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

Nothing is deployed yet, and no cloud resource has been created.

## Frontend — Vercel

The frontend deploys **with no code changes**. Every route is static or
prerendered, and the production build passes.

| Setting                    | Value       | Why                                             |
| -------------------------- | ----------- | ----------------------------------------------- |
| Root Directory             | `frontend`  | This is a monorepo; do not build from the root  |
| Framework                  | Next.js     | Auto-detected                                   |
| `NEXT_PUBLIC_API_BASE_URL` | leave unset | Only the Admin status card calls the backend    |

## Backend — not needed for UI review

Only the status card on `/admin` calls the backend. Every other screen is static
and renders identically without it, so a frontend-only deploy is enough for
gathering feedback on the product concept.

If the backend is deployed later (Render or similar), it needs these changes —
none of which exist yet:

- bind to the platform's port: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- set `CORS_ALLOW_ORIGINS` to the deployed frontend's domain
- point `DATABASE_URL` at a managed PostgreSQL instance
- replace `create_all` with Alembic migrations (Phase 1)

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

The live backend status card is at the bottom of **Admin** (`/admin`). It is the
only thing in the prototype that makes a network call:

| Card shows    | Meaning                             |
| ------------- | ----------------------------------- |
| 정상          | Backend and database both reachable  |
| 일부 장애      | Backend is up, PostgreSQL is not     |
| 연결 안 됨     | The backend itself is not reachable  |

Useful extra URLs:

- http://localhost:8000/api/health - raw health JSON
- http://localhost:8000/docs - interactive API documentation, generated by FastAPI
- http://localhost:8000/api/users - the seeded development user

## Verifying the project

```powershell
# Backend tests (backend/) - no database required
.\.venv\Scripts\python.exe -m pytest

# Frontend type check, lint, and production build (frontend/)
npx tsc --noEmit
npm run lint
npm run build
```

The backend tests run against a temporary in-memory SQLite database, so they
pass whether or not Docker is running.

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
request that costs money or touches data goes through the Ctrl AI backend,
because that is the only place where a permission check, a quarterly budget
limit, and a provider API key can live safely. Members never hold provider
keys; Ctrl AI owns provider access and records usage per member and quarter.

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

**Ctrl AI operates by calendar quarter** — 2026 Q1, 2026 Q2, and so on.
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
member may receive at most **100,000 KRW per quarter** of community-funded
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

Phase 1 uses a manual top-up workflow: the member requests an amount, an
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
| CtrlAI Apps | app name, description, creator | category, sort |
| CtrlAITube | title, description, creator | creator, sort |
| Admin — members | name, username | membership status |
| Admin — applications | member name, username | application status |
| Admin — video models | model name, provider, model id | — |

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
│  │  ├─ services/            # budget split, wallet helpers
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
│  │  ├─ builder/             # page.tsx + BuilderWorkspace.tsx
│  │  ├─ video/               # page.tsx + VideoWorkspace.tsx
│  │  ├─ ctrlaistore/         # CtrlAI Apps: listings + [slug] detail
│  │  ├─ ctrlaitube/          # feed + [id] detail
│  │  ├─ usage/               # Usage
│  │  ├─ profile/             # Profile
│  │  ├─ admin/               # Admin
│  │  ├─ globals.css          # design tokens + shared classes
│  │  ├─ layout.tsx           # wraps every page in AppShell
│  │  └─ page.tsx             # Chat — the default landing page
│  └─ lib/
│     ├─ api.ts               # base URL and health client
│     ├─ http.ts              # shared request helper, timeout, error text
│     ├─ projects.ts          # Builder and Video project clients
│     ├─ quarters.ts          # quarters, applications, wallet
│     └─ mock-data.ts         # remaining mock content (Korean)
├─ docker-compose.yml         # local PostgreSQL
├─ .env.example
├─ CLAUDE.md                  # product definition (authoritative)
└─ README.md
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

## Vision

Ctrl AI is intended to become a shared AI workspace where members can:

* Use hosted large language models
* Access external AI services such as Claude
* Generate and share AI-created videos and media
* Build software with AI-assisted coding tools
* Store and collaborate on source code
* Deploy applications created by members
* Share applications through an internal App Store
* Use shared GPU and cloud infrastructure
* Track individual AI usage and allocated credits

The long-term goal is to provide a unified environment for:

**Create → Build → Run → Store → Share → Deploy**

---

## Platform Overview

```text
                         CTRL AI
                            │
                     Ctrl AI Core
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
    Ctrl Chat           Ctrl Video           Ctrl Code
       │                    │                    │
 Claude / Ollama      Video Models        Coding Agents
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                        Ctrl Apps
                            │
                     Build & Deploy
                            │
                    Shared Community
```

All services share the same authentication, database, permissions, usage tracking, and cloud infrastructure.

---

# Core Modules

## Ctrl Chat

Shared AI chat environment.

Planned providers include:

* Claude API
* Ollama
* Qwen
* Llama
* Gemma
* Other hosted or API-based LLMs

Example flow:

```text
User
  ↓
Ctrl Chat
  ↓
AI Gateway
  ├─ Claude API
  └─ Ollama
       ↓
Hosted GPU Models
```

Users can select different models while Ctrl AI manages authentication, usage tracking, and access.

---

## Ctrl Video

AI video generation and community media sharing.

Users will be able to:

* Generate videos from prompts
* Select available video models
* Store generated videos
* Keep generations private
* Share videos with teams
* Publish videos to the Ctrl AI community
* View generation metadata
* Track generation cost

Architecture:

```text
User
  ↓
Ctrl Video
  ↓
Generation Request
  ↓
Job Queue
  ↓
GPU Worker / External Video API
  ↓
Generated Video
  ↓
Cloud Storage
  ↓
Video Hub
```

Video files are stored in object storage rather than directly inside the database.

---

## Ctrl Code

AI-assisted coding and development environment.

Planned functionality:

* AI code generation
* Code editing
* Repository access
* File creation
* Code explanation
* Testing
* Git commits
* Shared team repositories
* Application deployment

Architecture:

```text
Ctrl Code
   │
   ├─ Claude
   ├─ Coding LLM
   └─ Code Agent
         ↓
      Workspace
         ↓
        Git
         ↓
    Repository
```

Code execution will eventually run inside isolated containers or sandbox environments.

---

## Ctrl Apps

Internal application marketplace for projects created by members.

Members will be able to publish applications developed through Ctrl Code.

Example:

```text
Repository
    ↓
Docker Build
    ↓
Container Image
    ↓
Deployment
    ↓
Ctrl Apps
```

Applications can then appear in the portal:

```text
CTRL APPS

Meeting Summarizer
by Yuri
[ Launch ]

Document Translator
by AI Team
[ Launch ]

Research Assistant
by Ctrl AI
[ Launch ]
```

Applications may support different visibility levels:

* Private
* Team
* Members
* Public

---

# Ctrl AI Core

The Core service provides functionality shared by every module.

```text
Ctrl AI Core

Authentication
User Management
Role Management
Database
Usage Tracking
Credit Management
Permissions
Storage
API Gateway
Audit Logging
Secrets Management
```

The goal is to build the Core once and allow future AI services to reuse it.

---

# User Roles

Initial roles:

```text
admin
developer
member
```

### Admin

Can manage:

* Members
* Roles
* AI providers
* Usage
* Credits
* Infrastructure
* Applications
* Deployments
* System settings

### Developer

Can:

* Build applications
* Manage repositories
* Use coding agents
* Deploy applications
* Share projects

### Member

Can:

* Use AI services
* Generate content
* Use published applications
* Share allowed content

---

# Sharing Model

Content is private by default.

Each resource can define its visibility.

```text
private
team
members
public
```

Examples of resources using this model:

* Videos
* Applications
* Code repositories
* Files
* AI-generated content

This allows Ctrl AI to function as both a private workspace and a community platform.

---

# Usage & Credit System

Members may receive a monthly AI usage allocation.

Example:

```text
Monthly Credit

Allocated     ₩50,000
Used          ₩12,300
Remaining     ₩37,700
```

External AI services can be deducted from the member's allocated balance.

Examples:

```text
Claude API
Higgsfield API
Future AI APIs
```

Locally hosted models such as Ollama are primarily accounted for through shared infrastructure costs rather than provider API charges.

Example usage record:

```text
User: Yuri
Provider: Anthropic
Model: Claude
Input Tokens: 2,400
Output Tokens: 700
Provider Cost: $0.02
Internal Cost: ₩28
```

---

# Infrastructure

Initial infrastructure will be hosted primarily on Google Cloud.

Proposed architecture:

```text
Google Cloud
│
├─ Compute Engine
│   ├─ Ctrl AI Web
│   ├─ Backend API
│   └─ Docker Runtime
│
├─ GPU Compute Engine
│   ├─ Ollama
│   ├─ LLM Models
│   ├─ Coding Models
│   └─ Future Video Workers
│
├─ Cloud SQL
│   └─ PostgreSQL
│
├─ Cloud Storage
│   ├─ Videos
│   ├─ Images
│   └─ User Files
│
└─ Secret Manager
    ├─ Claude API Key
    ├─ Database Credentials
    └─ Other Provider Secrets
```

---

# Database

PostgreSQL will be used as the primary relational database.

Initial tables may include:

```text
users
teams
team_members

wallets
ai_usage

conversations
messages

videos

repositories

apps
deployments

user_servers

audit_logs
```

Large files are not stored directly in PostgreSQL.

Storage responsibilities:

| Data             | Storage            |
| ---------------- | ------------------ |
| User information | PostgreSQL         |
| AI usage         | PostgreSQL         |
| App metadata     | PostgreSQL         |
| Video files      | Cloud Storage      |
| Images           | Cloud Storage      |
| Source code      | Git                |
| Docker images    | Container Registry |
| API secrets      | Secret Manager     |

---

# Security Principles

Ctrl AI should follow the following principles from the beginning:

* Never expose master AI provider API keys to users
* Never commit credentials to Git
* Store production secrets in Secret Manager
* Keep PostgreSQL inaccessible from the public internet
* Keep Ollama internal API ports private
* Require HTTPS for public access
* Use role-based access control
* Run user applications inside isolated containers
* Record administrative and deployment activity
* Apply usage limits before calling paid APIs

External traffic should generally follow:

```text
Internet
   ↓
HTTPS
   ↓
Ctrl AI
   ↓
Backend
   ↓
Internal Services
```

Rather than exposing internal services directly.

---

# Initial Repository Structure

```text
ctrl-ai-platform/
│
├─ frontend/
│   └─ Web portal
│
├─ backend/
│   └─ Core API
│
├─ infra/
│   ├─ nginx/
│   └─ cloud/
│
├─ docker/
│   └─ Container configuration
│
├─ docs/
│   ├─ architecture.md
│   ├─ database.md
│   └─ deployment.md
│
├─ scripts/
│
├─ docker-compose.yml
├─ .env.example
├─ .gitignore
└─ README.md
```

---

# Initial Technology Stack

### Frontend

* Next.js
* React
* TypeScript

### Backend

* Python
* FastAPI

### Database

* PostgreSQL
* Google Cloud SQL

### AI

* Claude API
* Ollama
* Open-source LLMs

### Infrastructure

* Google Cloud
* Compute Engine
* GPU Compute Engine
* Cloud Storage
* Secret Manager

### Deployment

* Docker
* Docker Compose
* Nginx

### Source Control

* Git
* GitHub initially
* Gitea/GitLab may be evaluated later

---

# Development Roadmap

## Phase 1 — Infrastructure

* Obtain Google Cloud project access
* Verify server specification
* Configure domain
* Configure HTTPS
* Install Docker
* Create Git repository
* Deploy initial frontend/backend

## Phase 2 — Ctrl AI Core

* PostgreSQL
* User authentication
* User roles
* Admin interface
* Usage tracking
* Credit system
* Secret management

## Phase 3 — Ctrl Chat

* Claude API integration
* Conversation storage
* Usage metering
* Model selector
* Ollama integration
* Local LLM hosting

## Phase 4 — Ctrl Video

* Video generation API
* Generation queue
* GPU workers
* Cloud Storage
* Video gallery
* Sharing controls

## Phase 5 — Ctrl Code

* Git integration
* Coding models
* AI coding agent
* Workspace
* Container sandbox
* Team repositories

## Phase 6 — Ctrl Apps

* Application registration
* Docker build pipeline
* Application deployment
* App catalog
* Launch interface
* Version management

## Phase 7 — Platform Operations

* Monitoring
* Logging
* Backups
* Infrastructure dashboards
* Cost monitoring
* GPU scaling
* Security hardening

---

# First Milestone

The first production milestone is intentionally small.

```text
Domain
  ↓
Ctrl AI Login
  ↓
Ctrl Chat
  ↓
Claude API
  ↓
Conversation Stored
  ↓
Usage Recorded
```

The first version should provide:

* Working domain
* HTTPS
* User login
* Claude chat
* PostgreSQL storage
* Member usage tracking
* Admin access

Once this core works reliably, additional modules can reuse the same infrastructure.

---

# Long-Term Goal

Ctrl AI is not intended to be only a shared chatbot.

It is intended to become a community AI development platform where members can:

**Use AI → Create → Develop → Deploy → Share**

through a single shared ecosystem.
