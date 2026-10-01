# Ctrl AI — Backlog

The single ordered queue of upcoming work.

Read this at the start of every session. Work only on the item the
developer names, or the top of **Next** if they say *"next item"*. New UI
requests mentioned mid-phase go to **UI requests** and are not built in the
current branch unless the developer says *"do it now"*. When an item is
merged, move it to **Done**. See section 22 of [`CLAUDE.md`](../CLAUDE.md).

The phase plan itself lives in section 20 of `CLAUDE.md`; this file only
says what order things happen in.

---

## Now

**Phase 1c — usage ledger and audit log** · branch `phase-1c-usage-audit`

Branch created and brought up to date with `main` (which now contains 1a
and 1b). **No 1c work committed yet.** Scope: a usage router that records
`UsageEvent` through the budget service in the same transaction as the
deduction; the real admin member list, quarter enrolment and a KRW credit
panel; an `AuditLog` table written on every admin change plus a read-only
audit view; a development-only "simulate usage" action; removal of the
remaining mock exports; and the Usage page redesign.

---

## Next (in order)

1. **Phase 1c — usage ledger and audit log** · branch `phase-1c-usage-audit`
   See **Now**.

2. **UI batch 1** · branch `ui-brand-refresh`
   Full spec saved verbatim below. Its open question is now resolved:
   `main` contains 1a and 1b, so branching from an up-to-date `main` is
   what the spec asks for and gives the current UI.

3. **prep-beta-launch**
   Not yet specified.

4. **Phase 2 — Chat**
   Backend Claude adapter behind `CLAUDE_PROVIDER` (mock by default),
   conversations and messages, intent routing into Builder and Video,
   usage event recording, budget checks. See `CLAUDE.md` section 20.

### Merge order

`main` now contains Phase 1a and Phase 1b. Only one phase branch is still
stacked:

```text
main  <-  phase-1c-usage-audit
```

---

## UI requests (collected, not started)

New UI requests go here until they are folded into a UI batch.

*(none yet — UI batch 1 below holds everything collected so far)*

---

## UI batch 1 — full spec

Saved exactly as written by the developer.

> Follow the working method and Git Workflow in CLAUDE.md. Create branch ui-brand-refresh from up-to-date main. UI and docs only: no backend logic or data-model changes. Attached: a screenshot of the current sidebar.
>
> 1. Club name: the community is called CTRL+AI.
>    - Show "CTRL+AI" as the brand name in the sidebar header.
>    - Add a short welcome area at the top of the Chat landing page (e.g. "CTRL+AI에 오신 것을 환영합니다" plus one short line about what members can do).
>    - Replace the "Phase 1 — 개발 중" subtitle with a short Korean tagline.
>    - Keep product and feature names (Chat, Project Builder, Video Generator, CtrlAI Apps, CtrlAITube, Usage, Profile, Admin) and all routes unchanged.
>    - Update the page <title>, CLAUDE.md and README so the club name is consistent. Do not rename the repository.
>
> 2. Logo: replace the "AI" square logo with a plus (+) mark in the same rounded square, matching the CTRL+AI name. Make it a small SVG component and use it as the favicon too.
>
> 3. Navigation icons: replace the text-symbol icons (◇ ◆ ▶ ▣ ◉ ⚙ ◑ ○) with one consistent icon set using lucide-react.
>    - Same size and stroke width everywhere, vertically aligned with the labels.
>    - A clear but subtle active state.
>    - Suggested: Chat = message bubble, Project Builder = code or hammer, Video Generator = clapperboard, CtrlAI Apps = grid, CtrlAITube = play circle, Admin = shield or settings, Usage = gauge or wallet, Profile = user, 문제 신고 = bug or flag.
>
> 4. Colors: build a dark-theme palette inspired by the Anatomy design system values below, adapted for dark backgrounds. Update tokens in globals.css only; no hard-coded colours in components.
>    - Never use #003c71 (brand primary, reserved for the company logo) or the brand gradient. Never use any company logo.
>    - Background: near-black navy derived from #001433, with slightly lighter navy surface steps for sidebar and cards (add these in-between shades as needed).
>    - Text: #f2f2f2 main, #cccccc secondary, #999999 muted. #666666 is for borders only, never text.
>    - Links and active navigation: #9ac2fe. Primary buttons: #0153cc fill with white text. Never use #0153cc as text on dark backgrounds.
>    - Build accent: #bb33ff for bars and fills, #dd99ff for any accent text. Video accent: #00eeff.
>    - Error: #e64d54 for icons and borders, #f2a6aa for error text.
>    - Success and warning are not in the source palette: keep our own green and amber, tuned to fit.
>    - Accent gradient #3485fe → #bb33ff only on the + logo mark, nowhere else.
>    - Check every text/background pair meets WCAG AA (4.5:1 normal text, 3:1 large text and UI elements) and list the ratios in your report.
>
> 5. New page /issues, titled "문제 신고", in the sidebar under 내 정보:
>    - A short Korean explanation of how to report a bug or suggest an idea.
>    - A button that opens https://github.com/anoukkim/ctrl-ai-platform/issues/new/choose in a new tab.
>    - A note that a GitHub account is needed and that issues are public, so never include passwords, personal information or private data.
>    - Add .github/ISSUE_TEMPLATE/ with two Korean templates, 버그 신고 (what happened, what you expected, steps to reproduce, screenshot, browser) and 기능 제안 (idea, why it helps), plus a config.yml.
>    - Leave a clearly marked place on the page for a future in-app feedback form for members without GitHub.
>
> Rules:
> - Keep word-break: keep-all. Never apply monospace or letter-spacing to Korean text.
> - Check every page, not just the sidebar: Chat, Builder, Video, CtrlAI Apps, CtrlAITube, Usage cards and bars, badges, buttons, Profile, Admin tables, and the new /issues page.
> - Check full width and the narrow-screen menu.
>
> Run tsc, lint and build. Report what changed per screen, the contrast ratios, the changed files, and exact browser steps for me to check it. Do not merge.

### Resolved: which branch to start from

The spec says *"from up-to-date main"*, and as of 2026-10-01 that is now
true — `main` contains Phase 1a and Phase 1b, so it has the login pages,
the `내 정보` sidebar group and the `Phase 1 — 개발 중` subtitle the spec
refers to. Branch `ui-brand-refresh` from `main`.

---

## Done

Newest first.

| Merged | Item | Branch |
| ------ | ---- | ------ |
| 2026-10-01 | **Phase 1b — membership** — per-quarter `QuarterMembership`, `require_active_member` on paid creation endpoints, former members locked out with attribution preserved, live membership in the sidebar, Profile and Usage header, Korean monospace fix | `phase-1b-membership` |
| 2026-10-01 | **Phase 1a — auth** — username/password with Argon2id, HttpOnly same-origin session cookie via the Next.js `/api/*` rewrite, real `get_current_user` / `require_admin` on every route | `phase-1a-auth` |
| 2026-10-01 | **Phase 1 foundation** — quarters, applications, KRW budgets, allocations, personal wallet and top-ups, Builder/Video project groundwork with libraries and workspaces | `phase/1-foundation` |
| 2026-09-29 | **Phase 0 — product shell** — Next.js frontend with full navigation and every screen, FastAPI backend, PostgreSQL via Docker Compose, `/api/health`, Korean-first UI, dark theme | `phase-0-product-shell` |
