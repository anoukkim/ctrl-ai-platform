# CTRL+AI

A beginner-friendly AI creation community. Members describe what they want
in Korean, and CTRL+AI helps them build an app or make a short video, then
share it with the community. CTRL+AI owns provider access — members never
hold API keys — and records usage per member and quarter.

`내가 원하는 것을 말한다 → CTRL+AI가 만들어 준다 → 공유한다`

## Where we are

**M1 베타 오픈: 3/9** — an invite-only beta on `ctrlai.my` with real Claude
chat, everything else labelled test mode. Done: video-higgsfield-only,
Phase 2 Chat, chat-model-choice. Next: invite-only-signup, then the
three Chat+ items. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for every
milestone and [`docs/BACKLOG.md`](docs/BACKLOG.md) for the order.

Every external provider runs as a **mock by default**, so the whole
platform runs locally with no API keys.

## Quick start

Windows PowerShell. Details, and what to do when something goes wrong, are
in [`docs/development.md`](docs/development.md).

**Prerequisites:** Python 3.11+, Node.js 20+, Docker Desktop (running).

**First-time setup**, from the repository root:

```powershell
Copy-Item .env.example .env

cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
cd ..\frontend
npm.cmd install
cd ..

docker compose up -d
cd backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.db.init_db
```

**Every day — three processes**, each in its own terminal:

| # | Directory   | Command                                                                | URL                   |
| - | ----------- | ---------------------------------------------------------------------- | --------------------- |
| 1 | root        | `docker compose up -d`                                                 | localhost:5432        |
| 2 | `backend\`  | `.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000` | http://localhost:8000 |
| 3 | `frontend\` | `npm.cmd run dev`                                                      | http://localhost:3000 |

`npm.cmd` rather than `npm`: PowerShell's default execution policy blocks
the `npm.ps1` script, and `npm.cmd` is the same command without it.

Open **http://localhost:3000** and sign in with the development account
the seed created — 아이디 `dev`, 비밀번호 `devpassword` (development only;
the seed refuses to run anywhere else).

**Tests:**

```powershell
# in backend\
.\.venv\Scripts\python.exe -m pytest

# in frontend\
npm.cmd test; npx tsc --noEmit; npm.cmd run lint; npm.cmd run build
```

⚠ One backend test needs real PostgreSQL and writes to whatever
`DATABASE_URL` names — your development database — until
`test-database-isolation` lands. See
[`docs/development.md` › Operator notes](docs/development.md#operator-notes).

## Where to find things

| Document | What it holds |
| -------- | ------------- |
| [`CLAUDE.md`](CLAUDE.md) | The product definition, the rules every change follows, and the working method |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones M0–M4 and what is done in each |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | **The order of work**: Now, Next, open specs, UI requests |
| [`docs/product.md`](docs/product.md) | Screens and routes, the two workspaces, language and design, money, participation, search, leaving CTRL+AI |
| [`docs/development.md`](docs/development.md) | Full setup, sign-in, how the pieces fit, environment files, providers, testing, troubleshooting, operator notes, repository layout |
| [`docs/deployment.md`](docs/deployment.md) | Deployment notes; the beta's hosting decisions |
| [`docs/architecture.md`](docs/architecture.md) | Target infrastructure, storage and security principles |
| [`docs/research/chat-plus-research.md`](docs/research/chat-plus-research.md) | Prices and terms behind the Chat+ specs: Claude vision, PDF, Files API, server tools; image generation; Gemini, Grok, OpenRouter |
| [`docs/archive/done.md`](docs/archive/done.md) | Every merged item, newest first |
| [`docs/archive/done-specs.md`](docs/archive/done-specs.md) | Full specs of merged items |
| [`docs/archive/phase-table.md`](docs/archive/phase-table.md) | The old phase table, superseded by the roadmap |
| [`docs/ui-requests/`](docs/ui-requests/) | Screenshots referenced by UI requests |
| [`frontend/README.md`](frontend/README.md) | Frontend-only commands |
