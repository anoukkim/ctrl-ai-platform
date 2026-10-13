# CTRL+AI

A beginner-friendly AI creation community. Members describe what they want
in Korean, and CTRL+AI helps them build an app or make a short video, then
share it with the community. CTRL+AI owns provider access — members never
hold API keys — and records usage per member and quarter.

`내가 원하는 것을 말한다 → CTRL+AI가 만들어 준다 → 공유한다`

## Where we are

**M1 — beta launch, in progress.** The goal is an invite-only beta on
`ctrlai.my` with real Claude chat and everything else labelled test mode.

- **Done:** video-higgsfield-only, Phase 2 Chat, chat-model-choice,
  ui-polish, single-wallet, prompt-caching, cost-calibration,
  chat-builder-starter and **prep-beta-launch** (merged 2026-10-13): the
  beta's code, Docker images built by GitHub Actions, and the Korean
  deployment guide.
- **Deployed (2026-10-13):** `ctrlai-server` runs `db`, `api` and `web`
  with every provider on mock. `caddy` (HTTPS) starts once the `ctrlai.my`
  A record is live at Gabia.
- **Before members are invited:** invite-only-signup,
  test-database-isolation, and one real Claude message with the owner's
  key. Until invite codes exist, **do not share the address** — anyone who
  has it can sign up.
- **Next:** the top of **Next** in [`docs/BACKLOG.md`](docs/BACKLOG.md),
  which is the only place the order is written. Milestones are in
  [`docs/ROADMAP.md`](docs/ROADMAP.md).

Every external provider runs as a **mock by default**, so the whole
platform runs locally with no API keys.

## Production (beta)

| | |
| - | - |
| Site | `https://ctrlai.my` (www redirects to it) — live once the A record resolves and `caddy` is started |
| Server | Google Cloud Compute Engine `ctrlai-server` — e2-medium (2 vCPU, 4 GB), Seoul `asia-northeast3-c`, Debian 13, 30 GB disk, static IP `34.47.78.228` |
| Stack | `docker-compose.prod.yml`: `caddy` (80/443, automatic HTTPS), `web` (Next.js), `api` (FastAPI), `db` (PostgreSQL 16, no published port) |
| Images | Built and pushed to ghcr.io by GitHub Actions on every push to `main`; the server only pulls |
| Secrets | `.env` on the server only, `chmod 600`, never committed (beta-only exception, `CLAUDE.md` section 17) |
| DNS | Gabia: `@` A `34.47.78.228`, `www` CNAME `ctrlai.my.` |
| Billing | Google Cloud free trial (₩407,626) — **upgrade the billing account by 2027-01-04**, or the server stops when the trial ends |

Setting up, updating, backing up and restoring the server are step by step,
in Korean, in [`docs/deployment.md`](docs/deployment.md). From a Windows PC,
use `gcloud.cmd` rather than `gcloud` (the same execution-policy reason as
`npm.cmd`):

```powershell
gcloud.cmd compute ssh ctrlai-server --zone=asia-northeast3-c
# then, on the server:
sudo -iu ctrlai_platform
```

**Never paste or screenshot the server's `.env`.** If a secret is shown
anywhere, treat it as compromised and rotate it.

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

Open **http://localhost:3000**. Sign-in is **Google로 계속하기** — locally
a mock Google page where you type any email (development only). The
seeded development account signs in at **http://localhost:3000/login/password**
— 아이디 `dev`, 비밀번호 `devpassword` (development only; the seed refuses
to run anywhere else).

**Reset the local test data** — wipes the local database and seeds it
again (development and a localhost database only; it refuses otherwise):

```powershell
# in backend\
.\.venv\Scripts\python.exe -m app.db.reset_dev
```

**Tests:**

```powershell
# in backend\
.\.venv\Scripts\python.exe -m pytest

# in frontend\
npm.cmd test; npx tsc --noEmit; npm.cmd run lint; npm.cmd run build
```

A few backend tests need real PostgreSQL. They use their **own** database,
`TEST_DATABASE_URL` (default `ctrlai_test` on the Docker Compose server,
created on first use), never your development database, and skip when no
PostgreSQL is running. See
[`docs/development.md` › Verifying the project](docs/development.md#verifying-the-project).

## Where to find things

| Document | What it holds |
| -------- | ------------- |
| [`CLAUDE.md`](CLAUDE.md) | The product definition, the rules every change follows, and the working method |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones M0–M4 and what is done in each |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | **The order of work**: Now, Next, open specs, UI requests |
| [`docs/product.md`](docs/product.md) | Screens and routes, the two workspaces, language and design, money, participation, search, leaving CTRL+AI |
| [`docs/development.md`](docs/development.md) | Full setup, sign-in, how the pieces fit, environment files, providers, testing, troubleshooting, operator notes, repository layout |
| [`docs/deployment.md`](docs/deployment.md) | 배포 안내서 (Korean): setting up `ctrlai-server`, HTTPS, real Claude, backups, updates, cron, billing dates |
| [`docs/dns-for-domain-owner.md`](docs/dns-for-domain-owner.md) | The DNS records for `ctrlai.my` and how to check them (Korean) |
| [`docs/architecture.md`](docs/architecture.md) | Target infrastructure, storage and security principles |
| [`docs/research/chat-plus-research.md`](docs/research/chat-plus-research.md) | Prices and terms behind the Chat+ specs: Claude vision, PDF, Files API, server tools; image generation; Gemini, Grok, OpenRouter |
| [`docs/archive/done.md`](docs/archive/done.md) | Every merged item, newest first |
| [`docs/archive/done-specs.md`](docs/archive/done-specs.md) | Full specs of merged items |
| [`docs/archive/phase-table.md`](docs/archive/phase-table.md) | The old phase table, superseded by the roadmap |
| [`docs/ui-requests/`](docs/ui-requests/) | Screenshots referenced by UI requests |
| [`frontend/README.md`](frontend/README.md) | Frontend-only commands |
