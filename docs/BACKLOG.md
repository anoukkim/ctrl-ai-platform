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

Nothing is being built. `main` holds Phase 1, UI batch 1 and
membership-access-fix. No branch is open.

Next up is **admin-restructure** on `ui-admin-restructure`, branched
from an up-to-date `main`; the spec is saved verbatim below.

---

## Next (in order)

1. **admin-restructure** · branch `ui-admin-restructure`
   Spec saved verbatim below.

2. **budget-by-provider** · branch `feat-budget-by-provider`
   Spec saved verbatim below.

3. **project-video-management** · branch `feat-project-video-management`
   Spec saved verbatim below.

4. **video-higgsfield-only** · branch `feat-video-higgsfield-only`
   Spec saved verbatim below.

5. **prep-beta-launch**
   Not yet specified.

6. **Phase 2 — Chat**
   Backend Claude adapter behind `CLAUDE_PROVIDER` (mock by default),
   conversations and messages, intent routing into Builder and Video,
   usage event recording, budget checks. See `CLAUDE.md` section 20.

7. **fix-video-workspace-hang** · branch `fix-video-workspace-hang`
   `/video/[projectId]` never leaves "영상 프로젝트를 불러오는 중…". The
   three API calls it makes all return 200 and the console is clean, so
   the component is not reaching its ready state. Reproduced on `main`
   (so it predates membership-access-fix) and for an active member as
   well as an inactive one, so it has nothing to do with participation.
   The Video **library** at `/video` is fine; only the workspace is
   affected. Found while verifying membership-access-fix and left alone
   as out of scope for that branch.


### Merge order

Nothing is waiting. Branch the next item from an up-to-date `main`.

One thing to carry into **admin-restructure**: it moves every Admin
route, so `EXPECTED_GUARDS` in `backend/tests/test_membership_access.py`
and the access table in `docs/architecture.md` both have to move with
it. That test will fail on the first new route, which is the intended
reminder rather than a problem.

---

## UI requests (collected, not started)

New UI requests go here until they are folded into a UI batch.

*(none loose — UI batch 1 is merged, and the one UI request since then,
**admin-restructure**, was large enough to get its own item and branch in
**Next** rather than wait for a batch.)*

---

## UI batch 1 — full spec

**Merged 2026-10-01.** Kept for reference: it is the standing description
of the palette and the brand, so a later screen can be checked against it.
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

## membership-access-fix — full spec

Branch `fix-membership-access`. Saved exactly as written by the developer.

> Bug: members who are not active in the current quarter can still use Chat and the Builder/Video work chats, because only real paid endpoints were gated.
>
> Rule: a member who is not ACTIVE in the current quarter (inactive, or no membership record for the current quarter) cannot use any AI feature, mock or real. Former members cannot log in.
>
> Inactive / not enrolled members:
> - ALLOWED: log in; browse CtrlAI Apps and CtrlAITube; view their own projects, videos and conversations read-only; download their own work; Usage, Profile, 문제 신고.
> - BLOCKED: Chat send; Builder chat and generation; Video 다듬기, generate and 다시 생성; creating, editing and publishing.
> - Admins follow the same AI rule unless they are active members; admin pages stay available to admins.
>
> Backend: apply require_active_member to every AI, create, edit and publish endpoint, including mock-backed ones. Missing membership = not active. Blocked requests return 403 with a Korean message. Add a table of every endpoint and its access rule to the report and docs/architecture.md.
>
> Frontend: a calm banner on Chat, Project Builder and Video Generator: "이번 분기에 참여하지 않아 AI 기능을 사용할 수 없습니다. 내 작업물 보기와 다운로드는 가능합니다." with a link to Profile; disabled composers and action buttons with a lock icon and the reason on hover. The backend must still refuse.
>
> Tests: inactive and not-enrolled members get 403 on every AI/create/edit/publish endpoint; active members succeed; inactive members can browse and read their own work; former members cannot log in; admin pages work for admins.

## admin-restructure — full spec

Branch `ui-admin-restructure`. Saved exactly as written by the developer.

**Before:** [`docs/ui-requests/admin-before.png`](ui-requests/admin-before.png)
— the current single-page Admin screen this item replaces: ten sections
stacked on one route, from 회원 관리 down to 시스템.

> Problem: Admin is one very long page with ten unrelated sections, mixed English/Korean labels, and small inline action buttons that are easy to misclick.
>
> 1. Admin layout: a secondary Admin navigation (tabs at the top, or a sub-menu on wide screens) with these sections, each on its own route:
>    - 대시보드 /admin
>    - 회원 /admin/members, with member detail /admin/members/[id]
>    - 분기 · 신청 /admin/quarters
>    - 충전 신청 /admin/topups
>    - 영상 모델 /admin/video-models
>    - 감사 로그 /admin/audit
>    - 콘텐츠 /admin/content
>    - 시스템 /admin/system
>    - 개발 도구 /admin/dev (only when APP_ENV=development; holds the usage simulator)
>    Leave a clearly marked place for a future 예산 section (budget-by-provider).
> 2. 대시보드: cards for things needing action (pending quarter applications, pending top-up requests) that link to the right section; current quarter with its application period and status; member counts by status (활동 / 비활동 / 탈퇴); the last 10 audit entries.
> 3. 회원 list: search, filters (role, account status, membership status), sorting and pagination. Replace the small inline buttons with one "관리" menu per row, plus a link to the detail page.
> 4. 회원 detail: account info, role, membership per quarter (history), allocations and usage for the selected quarter, and that member's audit entries. All actions live here: change membership status, enrol in a quarter, change role, set allocations.
> 5. Safety: every status, role or allocation change opens a Korean confirmation dialog that states the effect (e.g. "탈퇴 처리하면 로그인할 수 없습니다"). After an action, show a short success or error message.
> 6. Consistency: all labels in Korean, keeping product and model names (Enabled → 사용 가능, Visible → 회원에게 공개, Hidden → 숨김, Video Models → 영상 모델); one badge style for statuses; one shared table component with sticky header, consistent alignment, tabular-nums amounts and a Korean empty state; existing design tokens; full width and narrow screens.
> 7. Backend: no changes to business rules. Small read-only, admin-only, tested endpoints are allowed if the dashboard needs counts.
>
> Tests: every Admin route is admin-only; dev tools are unavailable outside development; dashboard counts match the database; the confirmation dialog appears before status changes.

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

## video-higgsfield-only — full spec

Branch `feat-video-higgsfield-only`. Saved exactly as written by the developer.

> 1. All video generation, editing and extension go through Higgsfield only, behind VIDEO_PROVIDER (mock by default).
>    - Generate: text-to-video.
>    - Edit: "이 영상 수정하기" sends the selected version plus an instruction to the model's video-edit workflow and saves a new version. Length and framing come from the source, so hide those controls in edit mode.
>    - Extend: "이어서 만들기" uses the video-extend workflow with an explicit length.
>    - Show edit and extend only for models that support them (add supports_edit and supports_extend to the 영상 모델 catalogue); otherwise show a short Korean note.
>    - The mock provider supports all three.
> 2. The Claude panel in the Video workspace is collapsed by default, labeled "프롬프트 도움받기 (선택)", only rewrites prompt text, never generates video, and its usage is charged to the Claude budget (one short line says so).
> 3. Each version records how it was made (생성 / 수정 / 이어서), its source version, model, length and ratio, shown in the version strip.
> 4. Every Higgsfield call goes through the budget service, charged to the Higgsfield budget, active members only.
> 5. Show the estimated cost in 원 next to generate, edit and extend, based on the model's per-second price in the catalogue.
>
> Tests: edit and extend create linked versions; unsupported models hide edit/extend; inactive members are refused; the Higgsfield budget is deducted; the Claude panel never triggers a Higgsfield call.

## Done

Newest first.

| Merged | Item | Branch |
| ------ | ---- | ------ |
| 2026-10-01 | **membership-access-fix** — `require_active_member` on every create, edit and delete route rather than only the two create routes; the shared `NotParticipatingBanner` and locked controls on Chat, Project Builder and Video Generator; the access table for all 42 routes in `docs/architecture.md`, held to it by a test that fails on any new or re-guarded route | `fix-membership-access` |
| 2026-10-01 | **UI batch 1 — brand refresh** — the CTRL+AI name and + logo mark, lucide navigation icons, the neutral dark palette as tokens with no colour left in a component, the rebuilt Chat screen, the `/issues` page with Korean GitHub issue templates, and the Video length/ratio/sound controls | `ui-brand-refresh` |
| 2026-10-01 | **Phase 1c — usage ledger and audit log** — charging and the `UsageEvent` row in one transaction behind a `SELECT ... FOR UPDATE` lock, the real admin member list with quarter enrolment and a KRW credit panel, the append-only `AuditLog` with a read-only admin view, a development-only simulate-usage action, the Usage page redesign | `phase-1c-usage-audit` |
| 2026-10-01 | **Phase 1b — membership** — per-quarter `QuarterMembership`, `require_active_member` on paid creation endpoints, former members locked out with attribution preserved, live membership in the sidebar, Profile and Usage header, Korean monospace fix | `phase-1b-membership` |
| 2026-10-01 | **Phase 1a — auth** — username/password with Argon2id, HttpOnly same-origin session cookie via the Next.js `/api/*` rewrite, real `get_current_user` / `require_admin` on every route | `phase-1a-auth` |
| 2026-10-01 | **Phase 1 foundation** — quarters, applications, KRW budgets, allocations, personal wallet and top-ups, Builder/Video project groundwork with libraries and workspaces | `phase/1-foundation` |
| 2026-09-29 | **Phase 0 — product shell** — Next.js frontend with full navigation and every screen, FastAPI backend, PostgreSQL via Docker Compose, `/api/health`, Korean-first UI, dark theme | `phase-0-product-shell` |
