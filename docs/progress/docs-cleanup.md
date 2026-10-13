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

## Status — loop results

- CLAUDE.md: **1,784 → 444 lines** (target ≤ 1,000). The preamble carries
  a moved-where table and the old→new section-number map, so older code
  comments citing "section 17/20" stay resolvable without touching ~20
  files (left for chore-dead-code).
- New files: `docs/archive/phases.md` (sections 20+23 verbatim, links
  fixed), `docs/archive/progress-2026-10-13/` (eight checklists +
  screenshots), `frontend/public/ctrlai-mark.svg`; `frontend/app/favicon.ico`
  regenerated as the BrandMark tile (16/32/48); the five create-next-app
  SVGs deleted (nothing referenced them).
- BACKLOG: Now is four paragraphs (the live batch, the deployment note,
  the money-wording guide, the open real-key check); the five inherited-
  decision blocks sit under their items in done-specs.md and the
  2026-10-01→13 queue-reorder history is a section at its end.
- Known leftover: RUN-2026-10-13.md mentions six moved progress paths
  (historical prose); left untouched because the main session owns that
  file — one `docs/progress/` → `docs/archive/progress-2026-10-13/`
  prefix pass applies when convenient.
- Checks: backend full suite green (PostgreSQL pair on
  `ctrlai_dc_test@55433` — note: the test-database guard requires a name
  ending in `_test`); frontend 327 vitest, tsc 0, eslint 0. `npm run
  build` not run here: Turbopack refuses the node_modules junction in a
  worktree — run it on main when this branch merges.
