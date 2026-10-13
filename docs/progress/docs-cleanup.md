# docs-cleanup — checklist

PART C of the owner's overnight batch (2026-10-14). **No behaviour
change. Built, pushed, then WAITS for the owner — not merged.**

1. Stale statements fixed: README (done-list, before-invites list),
   ROADMAP (M1 count), CLAUDE.md §23, architecture.md ("nothing is
   built", "Chat has no backend route", top-up refusal wording,
   provider list), product.md leftovers, the verify skill (login exists,
   single wallet, current probes), frontend/README.md.
2. CLAUDE.md slimmed to ≤1,000 lines: principle, settled decisions,
   navigation, money, auth, roles, provider rule (incl.
   GOOGLE_LOGIN_PROVIDER and PERSONAL_TOPUP_ENABLED), security, env
   vars (§19 == .env.example), working method, git workflow
   (feat-/fix-/docs-/chore-/refactor- branch names), status pointer.
   Product-area detail → docs/product.md; data model → architecture.md;
   Phase 0–1c history and the long phase plan → docs/archive/phases.md.
3. BACKLOG: "Now" cut to the current batch; superseded/historical blocks
   → archive.
4. frontend/public: create-next-app SVGs and favicon replaced by a
   CTRL+AI mark.
5. docs/progress/<item>.md and screens/ → docs/archive/progress-2026-10-13/
   (RUN-2026-10-13.md and CHECKLIST-*/MORNING-* stay); links fixed.
6. Repo description line written below and reported.

## GitHub repo description (one line, for the owner to paste)

> 코딩 없이 말로 앱과 영상을 만드는 동아리 플랫폼 CTRL+AI — Korean-first AI creation community (Next.js · FastAPI · PostgreSQL · Claude)

## Status

(filled at the end)
