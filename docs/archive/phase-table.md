# The phase table (superseded)

The README's roadmap before 2026-10-07. Superseded by
[`ROADMAP.md`](../ROADMAP.md), which groups the same phases into
milestones; kept here unchanged for reference.

## Roadmap

The phase plan lives in [`CLAUDE.md`](../../CLAUDE.md) section 20, which is
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
principles, see [`docs/architecture.md`](../architecture.md).
