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

Nothing is being built. Two branches are finished and waiting on review:

| Branch | State |
| ------ | ----- |
| `phase-1c-usage-audit` | **Complete, unmerged.** 6 commits. Transactional charging with a row lock, the usage ledger, the append-only audit log, the real admin member list with a KRW credit panel, a development-only simulate action, and the Usage page redesign. 128 tests passing. |
| `ui-brand-refresh` | **Complete, unmerged.** 11 commits. CTRL+AI name and + logo, lucide icons, the neutral dark palette, the `/issues` page, the rebuilt Chat screen, the Usage card redesign, and the Video length/ratio/sound controls. |

They touch the same files — `globals.css`, `usage/page.tsx`,
`usage/usage.module.css`, `admin/page.tsx` and `README.md` all conflict
between the two — so the merge order has to be decided rather than
stumbled into.

---

## Next (in order)

1. **UI batch 1** · branch `ui-brand-refresh`
   Built and awaiting review — see **Now**. Full spec saved verbatim below.

2. **budget-by-provider** · branch `feat-budget-by-provider`
   Spec saved verbatim below.

3. **project-video-management** · branch `feat-project-video-management`
   Spec saved verbatim below.

4. **prep-beta-launch**
   Not yet specified.

5. **Phase 2 — Chat**
   Backend Claude adapter behind `CLAUDE_PROVIDER` (mock by default),
   conversations and messages, intent routing into Builder and Video,
   usage event recording, budget checks. See `CLAUDE.md` section 20.

> **Two items were named in the requested order but skipped**, because
> they are not in this backlog and no spec has been given for them:
> **membership-access-fix** (would be 2nd) and **video-higgsfield-only**
> (would be 5th). Send a spec for either and it goes in at that position.
>
> **Phase 1c** was not in the requested order either, but it is finished
> work rather than a future item, so it is recorded under **Now** instead
> of being dropped.

### Merge order

`main` contains Phase 1a and Phase 1b. Two branches are waiting:

```text
main  <-  phase-1c-usage-audit     (6 commits, complete)
main  <-  ui-brand-refresh         (11 commits, complete)
```

They conflict with each other in five files. `phase-1c-usage-audit`
carries the real usage data, and `ui-brand-refresh` carries the styling of
the same screens, so merging 1c first and then resolving the UI branch
against it keeps the real data and loses only styling that can be
re-applied.

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

## budget-by-provider — full spec

Branch `feat-budget-by-provider`. Saved exactly as written by the developer.

> Context: the club applies to the company each quarter for funding split by provider (Claude vs Higgsfield). The app must mirror that exactly.
>
> 1. Two budgets per member per quarter, named by provider: "Claude" and "Higgsfield". Rename the current Build budget to Claude everywhere (data, API, UI, docs) with an Alembic migration that keeps existing data. Chat, Project Builder and the Video prompt helper all charge Claude; video generation, editing and extension charge Higgsfield.
> 2. Every UsageEvent records: provider, feature tag (chat / build / video_prompt / video_generate / video_edit / video_extend), the native unit and amount (Claude input and output tokens; Higgsfield credits), the KRW amount, and the rate used for conversion. Conversion rates live in an admin-editable settings table with history, so past events keep the rate they were charged at.
> 3. Club pool per quarter and provider: the admin enters the company-approved amount for Claude and for Higgsfield. Member allocations plus reserve can never exceed the pool (enforced in the backend).
> 4. Reserve: by default 20% of each provider pool is held back as club reserve; the admin can change this percentage per quarter. Members can request extra budget from Usage with a short reason; admin approves or rejects in Admin, paid from the reserve, written to the audit log.
> 5. Admin pool dashboard per provider: approved pool, allocated to members, actually used, reserve remaining, usage by feature tag.
> 6. Quarter report: Admin can download a CSV (and an on-screen summary) per quarter with usage by provider and feature, native units and KRW, number of active members, and utilisation rate, for the next funding application.
> 7. Member side: Usage shows the two provider budgets, with usage broken down by feature. A one-time notice at 80% used. Before any Higgsfield action, show the estimated cost in KRW next to the button.
> 8. Members cannot move budget between providers.
>
> Tests: allocations plus reserve cannot exceed the pool, the default reserve is 20%, reserve requests deduct from the reserve, usage events store native units and the rate, rate changes do not alter past events, the CSV totals match the database, and every feature charges the correct provider.

---

## project-video-management — full spec

Branch `feat-project-video-management`. Saved exactly as written by the developer.

> 1. Delete Builder projects and videos
>    - Delete button on each project and video, in the library list and in the workspace, with a Korean confirmation dialog that names the item.
>    - Only the owner can delete, and only while they are an active member; admins can delete any item (written to the audit log). Backend enforces this.
>    - Soft delete (deleted_at), so it disappears for the member but an admin can restore it. Add a restore action in Admin.
>    - Deleting also removes the item from CtrlAI Apps or CtrlAITube if it was published.
>    - Never delete UsageEvent records or budget history: usage already spent stays recorded.
>
> 2. Download videos
>    - Download button on each finished video, owner only. Allowed even when the owner is inactive or not enrolled in the current quarter.
>    - Files go through a storage interface: local folder in development, cloud storage later (Phase 9), so nothing changes when we go live.
>    - Until Phase 6 connects a real provider, the mock provider produces a small placeholder video so the download flow can be tested end to end.
>    - The file name is readable: the video title plus date, safe characters only.
>
> 3. Download code as a ZIP
>    - "코드 다운로드 (ZIP)" button in each Builder project, owner only. Allowed even when the owner is inactive or not enrolled in the current quarter.
>    - The ZIP contains all project files in their folder structure plus a short README explaining how to open or run it.
>    - Never include secrets, .env files or anything outside the project.
>    - Safe ZIP building: no ../ paths, a size limit, a clear Korean error if the project is too large.
>
> Tests: owner can delete/download, other members cannot, inactive owners can download but not delete, admin delete is audited and restorable, deleted items disappear from Apps and Tube, usage history survives deletion, ZIP contains no secrets or unsafe paths, downloads are rejected for deleted items.

### Also needed here: store the generation settings per version

Carried over from the earlier note on this item, since it belongs to the
same branch. `VideoVersion` records which model made a version but not the
**length, aspect ratio or sound** it was made with — `VideoModel.capabilities`
only says what a model *can* do, not what was chosen.

The controls already exist on `ui-brand-refresh`
(`frontend/app/video/[projectId]/VideoSettings.tsx`), with the settings of
versions made in the current session held in memory as a stopgap. Reload
and older versions lose them, because there is nowhere to read them from.

Needs `duration_seconds`, `aspect_ratio` and `sound` on `VideoVersion`
with an Alembic migration (existing rows get null — their settings are
genuinely unknown and must not be guessed), accepted on
`POST /api/video/projects/{id}/versions` and validated against the model's
`capabilities`, returned on `VideoVersionRead`, after which the in-memory
map in `VideoWorkspace.tsx` is deleted.

---

---

## Done

Newest first.

| Merged | Item | Branch |
| ------ | ---- | ------ |
| 2026-10-01 | **Phase 1b — membership** — per-quarter `QuarterMembership`, `require_active_member` on paid creation endpoints, former members locked out with attribution preserved, live membership in the sidebar, Profile and Usage header, Korean monospace fix | `phase-1b-membership` |
| 2026-10-01 | **Phase 1a — auth** — username/password with Argon2id, HttpOnly same-origin session cookie via the Next.js `/api/*` rewrite, real `get_current_user` / `require_admin` on every route | `phase-1a-auth` |
| 2026-10-01 | **Phase 1 foundation** — quarters, applications, KRW budgets, allocations, personal wallet and top-ups, Builder/Video project groundwork with libraries and workspaces | `phase/1-foundation` |
| 2026-09-29 | **Phase 0 — product shell** — Next.js frontend with full navigation and every screen, FastAPI backend, PostgreSQL via Docker Compose, `/api/health`, Korean-first UI, dark theme | `phase-0-product-shell` |
