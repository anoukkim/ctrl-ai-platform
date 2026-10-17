# CTRL+AI

A beginner-friendly AI creation community. Members describe what they want
in Korean, and CTRL+AI helps them build an app or make a short video, then
share it with the community. CTRL+AI owns provider access — members never
hold API keys — and records usage per member and quarter.

`내가 원하는 것을 말한다 → CTRL+AI가 만들어 준다 → 공유한다`

## Where we are

**M1 — beta launch, in progress.** The goal is an invite-only beta on
`ctrlai.my` with real Claude chat and everything else labelled test mode.

- **Done:** everything in
  [`docs/archive/done.md`](docs/archive/done.md) — most recently (as of
  2026-10-17) the Builder's static runtime and the CtrlAIApps 게시 flow
  (app-ai-access: the maker picks 데모만 or 전체 기능), the member apps
  platform ("기능 상자"), notifications, chat-pins, motion-modern,
  owner-polish-3 (automatic USD→KRW rate, thumbnails), the app tab icon,
  the Korean font catalogue and the collapsible Chat list, on top of the
  beta stack (Chat with real budget rules, one 동아리 지원 wallet per
  quarter, invite-only sign-up, Google and password sign-in, Admin
  sections, backups and monitoring).
- **Deployed (as of 2026-10-17):** `ctrlai-server` runs the stack on
  `ctrlai.my` / `apps.ctrlai.my`, last updated overnight with the
  thumbnail-font fix, the font catalogue, the app tab icon and the Chat
  list collapse (each with a pre-deploy backup). Providers are still on
  mock except as the owner switches them on.
- **In flight (2026-10-17 morning):** `thumbnail-render-worker`
  (server-side thumbnails) was pushed to `main` (`96bdbe1`) once the
  GitHub login got the `workflow` scope; the `images` build is running,
  and the coordinating session then deploys it, adds the three `.env`
  lines on the server, checks the isolation and regenerates thumbnails.
  Do not push to `main` while that build runs. `builder-snapshots`
  (versions as saved snapshots, 작업-step undo/redo) is built on its own
  branch and waits for review, tests and deploy.
- **Before members are invited:** privacy-and-terms (the owner reviews
  the text), the one real Claude message with the owner's key, and invite
  codes created on the server — until then **do not share the address**.
- **Next:** the top of **Next** in [`docs/BACKLOG.md`](docs/BACKLOG.md),
  which is the only place the order is written. Milestones are in
  [`docs/ROADMAP.md`](docs/ROADMAP.md). The latest hand-over notes are
  [`docs/progress/MORNING-2026-10-17.md`](docs/progress/MORNING-2026-10-17.md).

Every external provider runs as a **mock by default**, so the whole
platform runs locally with no API keys.

## Production (beta)

| | |
| - | - |
| Site | `https://ctrlai.my` (www redirects to it); member apps on `https://apps.ctrlai.my/<slug>/` |
| Server | Google Cloud Compute Engine `ctrlai-server` — e2-medium (2 vCPU, 4 GB), Seoul `asia-northeast3-c`, Debian 13, 30 GB disk, static IP `34.47.78.228` |
| Stack | `docker-compose.prod.yml`: `caddy` (80/443, automatic HTTPS), `web` (Next.js), `api` (FastAPI), `db` (PostgreSQL 16, no published port) |
| Images | Built and pushed to ghcr.io by GitHub Actions on every push to `main`; the server only pulls |
| Secrets | `.env` on the server only, `chmod 600`, never committed (beta-only exception, `CLAUDE.md` section 8) |
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

Open **http://localhost:3000**. The login screen has **Google로 계속하기**
— locally a mock Google page where you type any email (development only) —
and, below it, username and password. The seeded development account signs
in there — 아이디 `dev`, 비밀번호 `devpassword` (development only; the seed
refuses to run anywhere else). `docs/development.md` lists the other seeded
members.

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
| [`CLAUDE.md`](CLAUDE.md) | The settled decisions, the standing rules every change follows, and the working method |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones M0–M4 and what is done in each |
| [`docs/archive/phases.md`](docs/archive/phases.md) | The long phase plan (Phases 0–9) and the Phase 0–1c delivery history |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | **The order of work**: Now, Next, open specs, UI requests |
| [`docs/product.md`](docs/product.md) | Screens and routes, the two workspaces, language and design, money, participation, search, leaving CTRL+AI |
| [`docs/development.md`](docs/development.md) | Full setup, sign-in, how the pieces fit, environment files, providers, testing, troubleshooting, operator notes, repository layout |
| [`docs/deployment.md`](docs/deployment.md) | 배포 안내서 (Korean): setting up `ctrlai-server`, HTTPS, real Claude, backups, updates, cron, billing dates |
| [`docs/api-distribution.md`](docs/api-distribution.md) | API 분배 (Korean): one club key, per-member wallets as limits, the guards against draining it, Console-side rules |
| [`docs/dns-for-domain-owner.md`](docs/dns-for-domain-owner.md) | The DNS records for `ctrlai.my` and how to check them (Korean) |
| [`docs/architecture.md`](docs/architecture.md) | Target infrastructure, storage and security principles |
| [`docs/research/chat-plus-research.md`](docs/research/chat-plus-research.md) | Prices and terms behind the Chat+ specs: Claude vision, PDF, Files API, server tools; image generation; Gemini, Grok, OpenRouter |
| [`docs/research/deepseek-research.md`](docs/research/deepseek-research.md) | DeepSeek for the chat catalogue: its own API (prices, data in China, terms), US hosts and OpenRouter routing, price comparison, recommendation |
| [`docs/archive/done.md`](docs/archive/done.md) | Every merged item, newest first |
| [`docs/archive/done-specs.md`](docs/archive/done-specs.md) | Full specs of merged items |
| [`docs/archive/phase-table.md`](docs/archive/phase-table.md) | The old phase table, superseded by the roadmap |
| [`docs/ui-requests/`](docs/ui-requests/) | Screenshots referenced by UI requests |
| [`frontend/README.md`](frontend/README.md) | Frontend-only commands |
