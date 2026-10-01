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

Nothing is being built. `main` holds Phase 1, UI batch 1,
membership-access-fix, admin-restructure and ui-naming. No branch is
open.

Next up is **fix-video-workspace-hang** on `fix-video-workspace-hang`,
branched from an up-to-date `main`; the spec is saved verbatim below.

The **Next** order was rewritten on 2026-10-01: the video workspace bug
moved from "Not in the Next order" to position 1, and two new items
joined the queue — **ui-tube-watch** at 2 and **usage-analytics** at 4.

---

## Next (in order)

1. **fix-video-workspace-hang** · branch `fix-video-workspace-hang`
   A real, reproduced bug. Moved into the order at position 1 on
   2026-10-01. Spec saved verbatim below.

2. **ui-tube-watch** · branch `ui-tube-watch`
   The CtrlAITube watch page: two columns, player sizing by video ratio,
   and a real comment section. Spec saved verbatim below.

3. **budget-by-provider** · branch `feat-budget-by-provider`
   Spec saved verbatim below, including the **Application flow** section
   added on 2026-10-01.

4. **usage-analytics** · branch `feat-usage-analytics`
   Admin and member usage charts. **Depends on budget-by-provider** — it
   reads the `UsageEvent` fields that item adds (provider, feature tag,
   native units, KRW). Spec saved verbatim below.

5. **project-video-management** · branch `feat-project-video-management`
   Spec saved verbatim below, including **Rename projects and videos**
   and the per-version generation settings.

6. **account-withdrawal** · branch `feat-account-withdrawal`
   Member self-withdrawal, the refund hold and the 30-day grace period.
   Spec saved verbatim below.

7. **video-higgsfield-only** · branch `feat-video-higgsfield-only`
   Spec saved verbatim below, including the **Length slider** section.

8. **prep-beta-launch**
   Only the **Launch data rules** are specified so far; the rest of the
   item is still to be written. Spec below.

9. **Phase 2 — Chat**
   Backend Claude adapter behind `CLAUDE_PROVIDER` (mock by default),
   conversations and messages, intent routing into Builder and Video,
   usage event recording, budget checks. See `CLAUDE.md` section 20.

### Merge order

Nothing is waiting. Branch the next item from an up-to-date `main`.

Three things to carry into **budget-by-provider**, now at position 3:

- **The Budget section already exists**, defined in
  `frontend/app/admin/sections.ts` with `hidden: true` and the route
  `/admin/budget`. Deleting that one line turns it on everywhere —
  sidebar, tabs, breadcrumbs, the dashboard card and the page heading.
  Its label is already English.
- **A section is named once.** All eleven names live in that same file,
  and screens read them through `sectionLabel(key)` rather than writing
  their own heading. A new section needs an entry there, not a string in
  a component. `__tests__/admin-sections.test.ts` asserts the visible
  list and that every name is English, so adding one touches that test.
- **The budget rename lands on 동아리 지원, not 공동체 지원.** Item 1 of
  the spec renames the Build budget to Claude; the pot it comes out of
  is called 동아리 지원 on screen, and `FUNDING_LABEL` in
  `frontend/lib/quarters.ts` is where that word is written. The
  `FundingSource` *values* are still `community_build` /
  `community_video` — ui-naming deliberately left the data alone, so a
  provider rename there is a real migration, not a label change.

---

## UI requests (collected, not started)

New UI requests go here until they are folded into a UI batch.

*(none loose — the two UI requests since UI batch 1,
**admin-restructure** and **ui-naming**, were each large enough to get
their own item and branch in **Next** rather than wait for a batch.)*

---

## admin-restructure — full spec (merged 2026-10-01)

Branch `ui-admin-restructure`, merged. Saved exactly as written by the
developer, and kept for reference: it is the clearest statement of why
the Admin screens are shaped the way they are.

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

### Change requests after testing — 2026-10-01

Saved exactly as written by the developer, after testing the first build
of this branch. All seven are implemented and merged.

> 1. Split 분기 · 신청 into two Admin sections. Approving applications is the main job, but the quarter table sits on top and makes the page feel complicated, and the top-right "보고 있는 분기" selector already picks the quarter.
>    - 신청 승인 (/admin/applications), the main one: applications for the selected quarter only.
>    - 분기 설정 (/admin/quarters): the quarter list, opening and closing applications, and a new "새 분기 만들기" form (name, period, application period, per-member limit) with validation and a Korean confirmation. Remove the developer note about POST /api/admin/quarters.
>    - Update the Admin tabs, the sidebar sub-menu, breadcrumbs and dashboard links. The dashboard's "대기 중인 신청" card opens 신청 승인 filtered to pending.
>
> 2. 신청 승인 layout:
>    - Top: a one-line summary of the selected quarter (name · status · application deadline with D-day · per-member limit), linking to 분기 설정 for changes.
>    - Below it, a row of small stat cards for the selected quarter: 전체 신청 N명 · 승인 대기 N명 · 승인 N명 · 거절 N명 · 신청 금액 합계 N원. Clicking a card filters the list to that status.
>    - Status tabs with counts: 승인 대기 N / 승인됨 N / 거절됨 N, defaulting to 승인 대기. Keep the search box.
>    - Pending rows show 승인 and 거절 buttons directly in the row (거절 asks for a reason), each with the existing Korean confirmation. Processed rows are muted and show who processed them and when.
>    - When nothing is pending: a Korean empty state ("처리할 신청이 없습니다") with a link to the 승인됨 tab.
>    - Whole-row click still opens the member detail; the buttons do not trigger the row click.
>
> 3. 분기 설정: show per-quarter numbers in the quarter list, so quarters can be compared at a glance:
>    - New columns: 신청자 (total applications), 승인 대기, 참여 회원 (approved, active in that quarter), 실제 사용자 (members with at least one usage event in that quarter), and 사용률 (실제 사용자 ÷ 참여 회원, as %).
>    - Use tabular numbers; show "–" for quarters that have not started yet where a number does not apply.
>    - The dashboard's current-quarter card shows the same 참여 회원 and 실제 사용자 numbers.
>
> 4. 회원: a row of small stat cards above the member list:
>    - 전체 회원 N명 (all accounts except former), 활동 회원 N명 (active in the selected quarter), 비활동 N명, 미신청 N명 (no application for the selected quarter), 탈퇴 N명, 관리자 N명.
>    - Clicking a card applies the matching filter to the list; the active filter is highlighted, with a way to clear it.
>    - The numbers follow the "보고 있는 분기" selector where they depend on the quarter.
>    - The dashboard's member card uses the same numbers.
>
> 5. All counts in items 2–4 come from grouped database queries in admin-only endpoints, not from loading every record in the browser.
>
> 6. Hide the 예산 and 콘텐츠 tabs and sidebar items until their features exist, instead of showing them with 준비 중. Keep their routes and placeholders in the code so later items (budget-by-provider, Phase 5/8) can switch them on.
>
> 7. 시스템 section: add an "외부 서비스" panel below the server status, one card per provider (Claude, Higgsfield, and placeholders for GitHub and YouTube):
>    - Mode: "mock (테스트)" or "실제 연결", from the *_PROVIDER setting.
>    - API key: "설정됨" or "없음". Never display, log or return the key itself.
>    - Last successful call and last error (with a plain Korean explanation, e.g. invalid key, out of credit, service down), recorded by the provider layer.
>    - A "연결 확인" button that runs a check only when pressed, using the cheapest available request (preferably one that does not consume tokens or credits). In mock mode it reports that mock mode is active.
>    - Remaining provider-side balance only if that provider's API offers it; otherwise omit it.
>    - The dashboard shows a warning card when any real provider's last check or last call failed, linking to 시스템.
>
> 8. Keep everything else in the branch as it is.

**Decisions taken while implementing these**, worth knowing before review:

- **참여 회원** counts `QuarterMembership.status == active`, not approved
  applications. An admin can enrol someone directly, and that person is
  just as much a participant.
- **실제 사용자** counts distinct members, not usage events.
- **사용률** is `null` — shown as "–" — when nobody is participating.
  0/0 is not 0%, and "0%" would read as "everyone failed to use it".
- **The provider connection check is never automatic.** A background poll
  against a paid API spends money to produce a green dot nobody asked
  for. Only Claude has a real zero-cost check (`GET /v1/models`); the
  others report honestly that their adapter arrives in Phases 4, 6 and 7.
- **No provider balance is shown**, because none of the four APIs in use
  reports one. A made-up 0 would read as "out of credit".

---

**Note added 2026-10-01, superseded.** Point 6 above says "all labels in
Korean". **ui-naming** then moved the Admin section names to English, so
point 6 now reads as history: it describes the state this branch was
built to, not the state of the code. The rule that survives from it is
the rest of the sentence — one badge style, one table component, the
existing design tokens — and that body text stays Korean.

---

## ui-naming — full spec (merged 2026-10-01)

Branch `ui-naming`, merged. Saved exactly as written by the developer.

> 1. Sidebar and navigation labels in English, everything else stays Korean:
>    - Section headings: 만들기 → Create, 둘러보기 → Explore, 내 정보 → Account, 관리 → Manage.
>    - Items: Chat, Project Builder, Video Generator, CtrlAIApps, CtrlAITube, Usage, Profile, Report Issue (was 문제 신고), Admin.
>    - Admin sub-navigation labels in English too (Dashboard, Members, Quarters, Top-ups, Video Models, Audit Log, Content, System, Dev Tools).
> 2. "CtrlAI Apps" becomes "CtrlAIApps" (no space) everywhere: navigation, page titles, headings, Chat shortcut cards, empty states, README and CLAUDE.md. The route /ctrlaistore stays unchanged.
> 3. Rename "공동체 지원" to "동아리 지원" everywhere it appears (Usage, sidebar quarter card, Admin, explanations, docs). Personal funds stay "개인 충전".
> 4. Page body text, explanations, buttons and messages remain Korean. Product names stay as they are.
> 5. Search the whole frontend and docs for every old label and report what was changed, so nothing is left half-renamed.
>
> Tests and checks: tsc, lint and build; a quick text search proves no old labels remain.

### Decisions taken while implementing these — 2026-10-01

Worth knowing before review.

- **There is no Manage group to rename.** admin-restructure had already
  replaced the 관리 heading with the collapsible **Admin** item, which
  sits with Create and Explore. Its label was English already.
- **Admin page headings follow their menu name**, and now read it from
  `sections.ts` rather than spelling it again. The spec changes the
  sub-*navigation*; leaving the `<h1>`s alone would have put a tab
  reading "Audit Log" directly above a heading reading 감사 로그 — the
  same screen under two names, which is the half-rename item 5 guards
  against. An unknown key throws instead of rendering a blank title.
- **/issues follows the same rule**: the item is Report Issue, so the
  page title and heading are too.
- **Korean prose that points at a screen uses that screen's English
  name** ("Quarters에서 바꾸기", "Audit Log 전체 보기"), the house style
  already used for "Usage 화면". Korean prose about the *things* on a
  screen keeps the Korean noun — 충전 신청 for the requests themselves,
  기록 for audit rows. Those are nouns, not menu items.
- **`FundingSource` values are unchanged** (`community_build`,
  `community_video`). They are data, not labels; renaming them would
  mean a migration and an API change for a word nobody sees.
- **The verbatim specs in this file keep the old spellings.** They
  record what was asked for, and editing a quotation to match the result
  it produced makes the record useless.
- **English docs prose follows the Korean**: "community-funded" reads
  "club-funded", since the member-facing label is now 동아리 지원.
- **시즌 → 분기 was added on request.** Found while verifying in the
  browser: the CtrlAIApps subtitle still said 이번 시즌, the Season
  concept retired in Phase 0. One member-visible string plus seven
  comments. Raised as a separate UI request, then folded into this
  branch when the developer said to do it now.

---

## fix-video-workspace-hang — full spec

Branch `fix-video-workspace-hang`. Moved into the **Next** order at
position 1 on 2026-10-01, having previously sat under "Not in the Next
order" waiting for a place in the queue. Saved exactly as written by the
developer.

> `/video/[projectId]` never leaves "영상 프로젝트를 불러오는 중…". The
> three API calls it makes all return 200 and the console is clean, so
> the component is not reaching its ready state. Reproduced on `main`
> (so it predates membership-access-fix) and for an active member as
> well as an inactive one, so it has nothing to do with participation.
> The Video **library** at `/video` is fine; only the workspace is
> affected. Found while verifying membership-access-fix and left alone
> as out of scope for that branch.

---

## ui-tube-watch — full spec

Branch `ui-tube-watch`. Added 2026-10-01. Saved exactly as written by the
developer.

**Before:** `docs/ui-requests/tube-watch-before.png` — **not in the
repository yet.** The screenshot did not arrive with the request; save it
at that path and turn this line into a link, the way `admin-restructure`
links `admin-before.png`.

> Problem: on the CtrlAITube watch page (/ctrlaitube/[id]) at 100% zoom, the video fills the full width, so the title, reactions and comments are pushed off-screen. The details are a large table, and comments look like a list instead of a comment section.
>
> 1. Layout on wide screens: two columns at about 7:3, the same for every video ratio.
>    - Left (70%): video player, title, a compact meta line under the title (creator name with status badge · 게시일 · 길이 · 생성 도구), then the prompt. Move the remaining details (YouTube 영상 ID, 회원 상태 explanation) into a collapsible "자세히" section instead of the big table.
>    - Right (30%): a panel with reactions at the top and comments below. The panel is full height and sticky; the comments scroll inside it while the video stays in view.
>    - Narrow screens: stack in this order: video, title and meta, reactions, comments, details.
> 2. Player sizing by ratio, so the title is always visible without scrolling on a normal laptop screen:
>    - The player area is the full width of the left column, with a maximum height of about 75% of the viewport height.
>    - 16:9 fills the column width. 9:16 and 1:1 are limited by that maximum height and centered, with a dark letterbox background on both sides (like YouTube Shorts on desktop).
>    - The player never scrolls sideways and keeps the video's true ratio.
> 3. Reactions: compact chips with an icon and count, a clear selected state when I have reacted, toggle on click.
> 4. Comments look like a real comment section:
>    - Each comment: round avatar with the initial, name, status badge, relative time ("2일 전", exact date on hover), text, and actions "답글" and a like count.
>    - Replies are indented under their comment with a thin thread line; long threads collapse to "답글 N개 보기".
>    - The input sits at the bottom of the panel with my avatar, grows as I type, Enter posts, Shift+Enter makes a new line, and 등록 is disabled while empty.
>    - Sort toggle: 최신순 / 인기순.
>    - Tabs at the top of the panel: "CTRL+AI 댓글 N" and "YouTube 댓글 N". The YouTube tab keeps the current explanation and the "YouTube에서 보기" button, so the two kinds of comments never mix.
> 5. Comments are still mock data; keep the "댓글 기능은 아직 준비 중입니다" note small and muted. The real comment backend comes with Phase 8.
> 6. Add mock videos in all three ratios (16:9, 9:16, 1:1) so each layout can be checked.
> 7. Use the existing design tokens and lucide icons; check at 100% zoom on full width, about 1280px, and narrow screens.
>
> Checks: tsc, lint and build; browser steps for each ratio and screen size.

---

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

### Application flow

Added 2026-10-01. Saved exactly as written by the developer.

> Goal: member applications feed the club's funding application to the company.
>
> 1. Application form: presets 균형 50/50, Claude 중심 70/30, 영상 중심 30/70, or a custom split, within the quarter's per-member limit. Show a rough plain-language meaning of each budget (e.g. approximate video seconds at the default model's price).
> 2. 신청 합계 view in Admin: total requested per provider, number of applicants, list of members who have not applied yet with the deadline countdown, and a CSV export for the company application. Show the suggested company request = member totals + reserve (default 20%, on top of member totals, not taken out of them).
> 3. After the company decides, the admin enters the approved pool per provider. If the pool covers all requests plus reserve, approvals give members exactly what they asked for. If it is smaller, show a proportional cut preview per member before applying, then hold the reserve at the configured percentage of the approved pool.
> 4. Approving: single approve, approve with adjustment (changed split or amount, required reason, written to the audit log), bulk approve with one confirmation, reject with a reason the member sees on Profile.
> 5. Active status and budget go together: a member becomes active for a quarter through an approved application, or through admin enrolment that also sets an allocation. If an admin sets a member active without any allocation, show a warning in Admin, and the member's sidebar says clearly that no budget is approved yet. (Currently testmember2 shows 활동 회원 with "승인된 지원금이 없습니다".)
> 6. Tests: totals match applications; the suggested request includes the reserve on top; the proportional cut never exceeds the pool; adjustments and bulk approvals are audited; rejected members see the reason; active-without-allocation shows the warning.

---

## usage-analytics — full spec

Branch `feat-usage-analytics`. Added 2026-10-01. Saved exactly as written
by the developer.

**Why it sits directly after budget-by-provider.** Every chart here reads
the `UsageEvent` fields that item adds — provider, feature tag, native
units and KRW. Point 1 below also says where the exact model goes: into
budget-by-provider if that item has not already recorded it, otherwise
into this one with its own migration.

> Depends on budget-by-provider (UsageEvent with provider, feature tag, native units and KRW).
>
> 1. Every UsageEvent also records the exact model used (e.g. the Claude model name, or the Higgsfield model ID from the 영상 모델 catalogue). Add this field in budget-by-provider if it is not already there, otherwise add it here with a migration.
> 2. Admin › 사용량 분석 (/admin/analytics), admin-only, added to the Admin tabs, sidebar sub-menu and dashboard cards:
>    - Time-series charts by day or week, within a quarter or a custom date range.
>    - Breakdown by provider and by model, with a toggle for the measure: KRW, native units (Claude tokens split into input/output; Higgsfield credits and video seconds), or request count.
>    - Filters: quarter, provider, model, feature tag (chat / build / video_prompt / video_generate / video_edit / video_extend), member.
>    - Summary cards: total KRW per provider, the most-used model per provider, average cost per request, and share of the pool used.
>    - Top members by usage, a data table matching the chart, and CSV download of exactly what is shown.
> 3. Member side: the Usage page gets a "내 사용량" chart of their own usage over the current quarter by provider and feature. Members never see other members' data.
> 4. Charts use one charting library consistent with the design tokens (dark theme, provider colours: Claude = build accent, Higgsfield = video accent), with Korean labels, tooltips with exact values, tabular numbers, and a Korean empty state.
> 5. Development data: extend the dev-only usage simulator to choose a provider, model and feature, and add a dev-only "샘플 사용 기록 생성" action that creates 30 days of realistic usage across members and models. Both are unavailable outside APP_ENV=development.
> 6. Performance: aggregate in the database (grouped queries), not in the browser.
>
> Tests: totals in the charts and the CSV match the database; filters change the results correctly; members cannot request other members' data; analytics routes are admin-only; sample-data tools return 404 outside development.

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

### Rename projects and videos

Added 2026-10-01. Saved exactly as written by the developer.

> - Rename from three places: the workspace title (click the title to edit it inline; Enter saves, Esc cancels), the ▾ menu next to the title ("이름 바꾸기"), and the library list's per-item menu.
> - Rules: trimmed, 1–60 characters, a clear Korean error for an empty name; duplicate names are allowed.
> - Owner only, and only while an active member (inactive members see the lock and reason, like other edits). Backend enforces this on the existing PATCH endpoint.
> - If the item is published, the new name shows in CtrlAIApps or CtrlAITube too.
> - The rename saves immediately, with a short "이름을 바꿨습니다" confirmation and no page reload.
> - Tests: the owner renames successfully; another member and an inactive owner get 403; empty or too-long names are rejected; published listings show the new name.

### Also needed here: store the generation settings per version

Carried over from the earlier note on this item, since it belongs to the
same branch. `VideoVersion` records which model made a version but not the
**length, aspect ratio or sound** it was made with — `VideoModel.capabilities`
only says what a model *can* do, not what was chosen.

The controls already exist (`frontend/app/video/[projectId]/VideoSettings.tsx`),
with the settings of versions made in the current session held in memory
as a stopgap. Reload and older versions lose them, because there is
nowhere to read them from.

Needs `duration_seconds`, `aspect_ratio` and `sound` on `VideoVersion`
with an Alembic migration (existing rows get null — their settings are
genuinely unknown and must not be guessed), accepted on
`POST /api/video/projects/{id}/versions` and validated against the model's
`capabilities`, returned on `VideoVersionRead`, after which the in-memory
map in `VideoWorkspace.tsx` is deleted.

---

## account-withdrawal — full spec

Branch `feat-account-withdrawal`. Saved exactly as written by the developer.

> 1. Member self-withdrawal from Profile ("회원 탈퇴"):
>    - Requires re-entering the password plus a Korean confirmation dialog that lists exactly what will happen.
>    - Before confirming, the page reminds the member to download their videos and code ZIPs first, with links to their libraries.
>    - Choice for published work: keep it public labelled "탈퇴 회원" (default, per CLAUDE.md), or unpublish all of it.
> 2. Effects of withdrawal:
>    - account_status becomes former; the member is logged out and cannot log in.
>    - Their remaining 동아리 지원 for the current quarter returns to the club reserve (written to the audit log).
>    - If they have remaining 개인 충전 balance, show a clear warning before confirming, and mark the withdrawal "환불 대기" so an admin must record the refund in Admin before the account is finalised. Never silently discard real money.
>    - UsageEvents and budget history stay, linked to an anonymised member, so quarter reports remain correct.
> 3. 30-day grace period: within 30 days an admin can restore the account (audited). After 30 days, a scheduled job anonymises personal data (username, email, display name, avatar) and the account cannot be restored. Published work keeps the "탈퇴 회원" label.
> 4. Admin: the member detail page shows withdrawn members with the withdrawal date, grace-period end, refund status, a 복구 action during the grace period, and a "환불 완료 기록" action. Admin-initiated withdrawal uses the same rules.
> 5. Tests: wrong password blocks withdrawal; a former member cannot log in; the remaining club budget returns to the reserve; a personal balance blocks finalisation until a refund is recorded; restore works within 30 days and not after; anonymisation removes personal fields but keeps usage totals; the unpublish choice removes items from CtrlAIApps and CtrlAITube.

**What this item leans on, which is why it sits at number 5.** Point 2
returns the remaining club budget to "the club reserve", and the reserve
is created by **budget-by-provider** (point 4 of that item). Point 1's
"download your videos and code ZIPs first" links to the downloads built
in **project-video-management**, and point 4's member detail page is the
one built by **admin-restructure**. Point 3's scheduled job is the first
background job in the project — there is no scheduler yet, so expect to
choose one.

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

### Length slider

Added 2026-10-01. Saved exactly as written by the developer.

> - Replace the 5초 / 10초 / 15초 buttons with a slider from 1 to 60 seconds plus a number input next to it, kept in sync, in 1-second steps.
> - Each model in the 영상 모델 catalogue gets min_seconds, max_seconds and step. Only the selected model's range is selectable; the rest of the slider is visibly greyed out, with a short Korean reason.
> - Typing a value outside the model's range snaps to the nearest allowed value with a short Korean notice. If the member wants longer than the model's maximum, suggest "이어서 만들기" to reach that length.
> - The estimated cost in 원 and the summary line above the generate button update live as the length changes.
> - The chosen length is saved on each version.
> - Tests: values outside the model range are rejected by the backend; the slider and input stay in sync; the cost estimate matches length × the model's per-second price.

**Note.** "The chosen length is saved on each version" is the same column
**project-video-management** adds (`duration_seconds` on `VideoVersion`),
and that item comes first in the order. It owns the migration; this item
uses the column and adds `min_seconds` / `max_seconds` / `step` to the
model catalogue.

---

## prep-beta-launch — full spec

No branch named yet. Only the launch data rules below are specified; the
rest of this item — who the beta members are, what they are asked to try,
and what counts as ready — is still to be written.

### Launch data rules

Added 2026-10-01. Saved exactly as written by the developer.

> - The production database starts empty: run migrations, then create only the admin account from ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD in the environment. No test members, sample projects, videos, usage or audit entries.
> - The development seed (dev, testmember, test accounts, sample data) must refuse to run unless APP_ENV=development, with a test proving it.
> - The app refuses to start in production if the admin password is a known default (devpassword, admin, password, or the .env.example placeholder).
> - Never copy the local database to production; the deployment guide says so explicitly.
> - Add a development-only "reset local test data" script that wipes and reseeds the local database, documented in the README.

---

## Archived specs

Merged, but kept because each is the standing description of something a
later screen can be checked against.

### UI batch 1 — full spec

**Merged 2026-10-01.** The standing description of the palette and the
brand. Saved exactly as written by the developer.

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

### membership-access-fix — full spec

**Merged 2026-10-01.** Branch `fix-membership-access`. The standing
description of the access rule. Saved exactly as written by the developer.

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

---

## Done

Newest first.

| Merged | Item | Branch |
| ------ | ---- | ------ |
| 2026-10-01 | **ui-naming** — the navigation moved to English: group headings (Create, Explore, Account), Report Issue in place of 문제 신고, and the nine Admin section names, which the sidebar, tabs, breadcrumbs, dashboard cards and each section's own `<h1>` now all read from `sections.ts` through `sectionLabel()` instead of each screen spelling its own. CtrlAI Apps became CtrlAIApps everywhere, route `/ctrlaistore` unchanged; 공동체 지원 became 동아리 지원 everywhere including the usage ledger's funding-source badges, with 개인 충전 untouched and the `FundingSource` data values deliberately left alone. Korean prose that points at a screen now uses that screen's English name; Korean prose about the things on a screen keeps the Korean noun. 시즌 → 분기 folded in on request | `ui-naming` |
| 2026-10-01 | **admin-restructure** — Admin split into sections on their own routes under a shared layout (breadcrumbs, tabs, the selected quarter carried in `?quarter=`); a dashboard of clickable cards; a sidebar Admin group that expands in place; 신청 승인 separated from 분기 설정, with inline 승인/거절, a reason on rejection, and a 새 분기 만들기 form; stat cards that filter on 회원 and 신청 승인, and per-quarter figures on 분기 설정, all from grouped queries in one stats service; a Korean confirmation stating the effect before every change; an 외부 서비스 panel with an on-request connection check that never exposes a credential; 예산 and 콘텐츠 hidden until their features exist. Brought the frontend its first test runner (Vitest). Migration `c3a81f5d7e24` adds `provider_status` | `ui-admin-restructure` |
| 2026-10-01 | **membership-access-fix** — `require_active_member` on every create, edit and delete route rather than only the two create routes; the shared `NotParticipatingBanner` and locked controls on Chat, Project Builder and Video Generator; the access table for all 42 routes in `docs/architecture.md`, held to it by a test that fails on any new or re-guarded route | `fix-membership-access` |
| 2026-10-01 | **UI batch 1 — brand refresh** — the CTRL+AI name and + logo mark, lucide navigation icons, the neutral dark palette as tokens with no colour left in a component, the rebuilt Chat screen, the `/issues` page with Korean GitHub issue templates, and the Video length/ratio/sound controls | `ui-brand-refresh` |
| 2026-10-01 | **Phase 1c — usage ledger and audit log** — charging and the `UsageEvent` row in one transaction behind a `SELECT ... FOR UPDATE` lock, the real admin member list with quarter enrolment and a KRW credit panel, the append-only `AuditLog` with a read-only admin view, a development-only simulate-usage action, the Usage page redesign | `phase-1c-usage-audit` |
| 2026-10-01 | **Phase 1b — membership** — per-quarter `QuarterMembership`, `require_active_member` on paid creation endpoints, former members locked out with attribution preserved, live membership in the sidebar, Profile and Usage header, Korean monospace fix | `phase-1b-membership` |
| 2026-10-01 | **Phase 1a — auth** — username/password with Argon2id, HttpOnly same-origin session cookie via the Next.js `/api/*` rewrite, real `get_current_user` / `require_admin` on every route | `phase-1a-auth` |
| 2026-10-01 | **Phase 1 foundation** — quarters, applications, KRW budgets, allocations, personal wallet and top-ups, Builder/Video project groundwork with libraries and workspaces | `phase/1-foundation` |
| 2026-09-29 | **Phase 0 — product shell** — Next.js frontend with full navigation and every screen, FastAPI backend, PostgreSQL via Docker Compose, `/api/health`, Korean-first UI, dark theme | `phase-0-product-shell` |
