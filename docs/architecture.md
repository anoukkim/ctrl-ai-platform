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
