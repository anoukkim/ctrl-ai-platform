# Done specs

Full specs of merged items, and the older archived specs, moved out of
[`../BACKLOG.md`](../BACKLOG.md) on 2026-10-07 so that file only holds
open work. Text unchanged; headings keep their original levels and
merge dates. The merge summaries are in [`done.md`](done.md).

## admin-restructure — full spec (merged 2026-10-01)

Branch `ui-admin-restructure`, merged. Saved exactly as written by the
developer, and kept for reference: it is the clearest statement of why
the Admin screens are shaped the way they are.

**Before:** [`docs/ui-requests/admin-before.png`](../ui-requests/admin-before.png)
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

## ui-tube-watch — full spec (merged 2026-10-02)

Branch `ui-tube-watch`, merged. Added 2026-10-01. Saved exactly as written
by the developer.

**No before-screenshot.** One never arrived with the request, and the
developer confirmed on 2026-10-02 that the item was to be built from the
written spec alone. The problem statement below describes the old screen
well enough to work from; there is nothing to link.

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

### Browser checks run — 2026-10-02

`tsc`, lint, 87 frontend tests and `next build` all pass, but none of them
can see a layout: **jsdom has no layout engine, so every box measures
zero.** The tests pin the *ingredients* (the ratio reaches the player, the
player sits inside the letterbox frame); whether anything is pushed
off-screen was checked in Chrome, as follows.

Measured on the running dev server, per ratio and width:

| Content width | Columns | Stage / panel | Panel | Sideways scroll |
| ------------- | ------- | ------------- | ----- | --------------- |
| 1707px window (content capped at 68rem by `.mainInner`) | two | eyeballed | sticky | none |
| 1280px viewport (content 977px) | two | 671 / 287 | sticky | none |
| 1024px viewport (content ~733px) | one, stacked | — | static | none |
| 430px viewport (content 387px) | one, stacked | — | static | none |

The two middle rows were measured with `getBoundingClientRect` in the page;
the widest row was looked at, not measured. Note that `.mainInner` caps the
content at 68rem, so past about 1760px nothing changes.

Per ratio, in the 7:3 layout: 16:9 fills the column with no letterbox;
9:16 and 1:1 are capped at 75vh and centred with letterbox bars, keeping
their true ratio (9:16 measured 378×673 inside a 671×674 frame = 0.5617,
i.e. 9/16). The title stayed above the fold in all three.

Interactions driven by hand: reaction chip toggles 86 → 87 and back with
the selected state showing; a four-reply thread collapsed to "답글 4개
보기" and expanded; the YouTube tab replaced the list with its own note and
button; a Korean comment typed through the IME grew the box to three lines
and posted on Enter with no character lost to composition, appearing as
"방금 전" with the count going 6 → 7. Console clean on every page — no
errors, no hydration warnings.

**Two defects were found this way and fixed**, neither of which any test
would have caught:

1. **The breakpoint fired at the wrong width.** It measured the viewport,
   so on a 1280px screen — one of the three widths this spec names — the
   990px of actual content satisfied a 1024px rule while the columns did
   not fit as described. Now a container query on the content box.
2. **A hydration mismatch waiting to happen.** These pages are prerendered
   by `generateStaticParams`, so "6일 전" is baked at build time and
   disagrees with the reader's clock later. The `<time>` element carries
   `suppressHydrationWarning`; differing is correct here, and the browser
   redraws from its own clock.

---

## ui-apps-detail — full spec

Branch `ui-apps-detail`. Added 2026-10-02 at the top of **Next**. Saved
exactly as written by the developer.

> Problem: the CtrlAIApps detail page (/ctrlaistore/[slug]) uses a large details table, comments that look like a list, an 앱 실행 button that looks active even when there is no launch address, a creator-status sentence viewers do not need, and buttons of equal weight.
>
> 1. Hero: thumbnail on the left; on the right the title, a one-line tagline, the creator (avatar initial, name, status badge, linking to their profile), and one compact meta line (분류 · 게시일 · 반응 수). Remove the "이번 분기에 참여 중이며…" sentence; the badge is enough.
>
> 2. Actions: 앱 실행 is the only primary button. If there is no launch address, it is disabled and reads "실행 준비 중" with the reason on hover. "GitHub에서 보기" is a small secondary button shown only when the creator made the repository public. Remove "개발자 보기" (the creator name already links to the profile).
>
> 3. Tabs below the hero: 소개 / 댓글 N / 업데이트 기록.
>    - 소개: the full description, a screenshot gallery (mock images for now), and a collapsible "자세히" with 저장소, 실행 주소 and last update date, replacing the big table.
>    - 댓글: reuse the exact comment and reaction components built in ui-tube-watch (avatars, relative time, 답글, likes, thread lines, collapsing threads, growing input, 최신순 / 인기순), so both community pages behave the same. Comments stay mock data with the small 준비 중 note.
>    - 업데이트 기록: a simple dated list (mock for now).
>
> 4. Below the tabs: "<creator>의 다른 앱" as small cards (mock).
>
> 5. Narrow screens: hero stacks (thumbnail, then text and actions), tabs stay.
>
> 6. Use the existing design tokens and lucide icons; check at 100% zoom on full width, about 1280px, and narrow screens.
>
> Checks: tsc, lint and build; a test that 앱 실행 is disabled without a launch address; browser steps.

### Browser checks run — 2026-10-02

`tsc`, lint, 101 frontend tests (14 of them new) and `next build` all
pass, but **none of them can see a layout** — jsdom has no layout engine,
so every box measures zero. The tests pin the button states, the tabs and
the comment count; widths were checked in Chrome, as follows.

Measured on the running dev server. Widths below are the CSS viewport;
`.mainInner` caps the content at 68rem, so past about 1760px nothing
changes.

| Viewport | Content | Hero | Screenshot row | Sideways scroll |
| -------- | ------- | ---- | -------------- | --------------- |
| 1897px | 1088 | two columns, 352 + 720 | fits (946) | none |
| 1280px | 978 | two columns, 352 + 610 | fits (946) | none |
| 1024px | 721 | two columns, 352 + 353 | fits (690) | none |
| 430px | 387 | stacked: artwork, then text and actions | 355 of 691, scrolls in place | none |

Interactions driven by hand on `/ctrlaistore/habit-at-a-glance`: the
반응 chip toggled 24 → 25 with the selected state showing; the four-reply
thread collapsed to "답글 4개 보기" and expanded; a Korean comment typed
through the IME posted on Enter with no character lost to composition,
appearing as "방금 전" with the tab going 댓글 7 → 댓글 8; 업데이트 기록
listed its three dated lines. On `/ctrlaistore/meeting-notes` (no launch
address, private repository) the button read 실행 준비 중, disabled, with
the reason on hover, and no GitHub button appeared. Console clean on every
page — no errors, no hydration warnings.

**CtrlAITube was re-checked after the extraction**, since its comment
section is now shared code: two columns 748 / 321, the panel still sticky
at `100vh - 2.8rem`, the comment list still the only thing that scrolls,
the composer still pinned to the bottom, the 9:16 player still letterboxed
at its true ratio.

**One defect was found this way and fixed**, which no test would have
caught: at 430px the description was clipped. A grid track will not shrink
below its widest item, and the screenshot row measures ~690px, so the
소개 panel took that width and the tab box cut it off; at 1024px the same
push showed as two pixels of page scroll. The track is now
`minmax(0, 1fr)`.

### Decisions taken while implementing these — 2026-10-02

- **The comment section moved to `app/components/CommentSection.tsx`
  before any of this screen was built.** ui-tube-watch had left a note
  saying the right moment to share it was when CtrlAIApps needed the same
  thing, and "reuse the exact components" cannot mean a copy. The watch
  page kept only its own parts: the panel frame, the CTRL+AI/YouTube tabs
  and the YouTube note. The list lives in a `useCommentThread` hook rather
  than inside the section, because the tab has to show a count that grows
  when a comment is posted.
- **The creator name is not a link yet.** The spec asks it to link to the
  creator's profile, but CTRL+AI has no member profile screen — `/profile`
  is the signed-in member's own. A link to a route that does not exist is
  worse than no link, so the name is plain text and becomes the link when
  a member profile exists. 개발자 보기 was removed as asked; it had been
  disabled since Phase 0 and was not worth keeping in the meantime.
- **GitHub에서 보기 stays disabled.** The spec settles where it appears
  (only for a public repository) and its weight (small, secondary), not
  whether it works; GitHub is Phase 4, so it carries a 준비 중 reason on
  hover, exactly like CtrlAITube's "YouTube에서 보기".
- **One mock app gained a launch address** (`example.com`, reserved for
  documentation, so it goes nowhere real). Every app had `launchUrl: null`,
  and with no app that has one, the enabled state of 앱 실행 cannot be seen
  by opening the screen or proven by a test.
- **Two mock apps were added** so two creators have more than one, which is
  what "<creator>의 다른 앱" needs; two creators still have none, so the
  empty case is visible too. 습관 한눈에 gained a four-reply thread, since
  threads only collapse past three.
- **The card count on the listing now includes replies.** It read
  `comments.length` while the detail tab and CtrlAITube count replies too,
  so the same conversation was counted two ways on two screens.

### Testing feedback round 2 — 2026-10-02

Saved as written by the developer, after looking at the screen.

> 1. "<creator>의 다른 앱": the cards are too large and draw more attention than the main content. Make them compact: a small thumbnail (about 64–80px square or a short 16:9 strip), the app name and one line of description, in a responsive grid of 3–4 per row on wide screens. Hide the section when there are no other apps.
> 2. Tab content spacing: add comfortable top padding between the tab bar and the content, and keep content aligned to the same left edge as the hero.
> 3. 소개 tab: the description as a readable paragraph block; "주요 기능" as small feature cards in a grid, each with a lucide icon, a short title and one muted line of explanation (add the explanation to the mock data); "스크린샷" as a horizontal gallery of 3–4 frames, clickable to open a larger view, with a muted caption under the gallery; "자세히" as a styled collapsible card with label/value rows (저장소 with an external-link icon, 실행 주소 or "아직 없습니다", 마지막 업데이트, 분류), tabular dates, a chevron that rotates when open.
> 4. 업데이트 기록 tab: a vertical timeline — a thin line with a dot per entry; each entry shows a version tag, the date, a short title and 1–3 bullet changes, the newest marked "최신". Fix the spacing so the date and text never touch. Add 2–3 mock entries.
> 5. Empty states: if an app has no features, screenshots or updates, show a short Korean empty state instead of a blank area.
>
> Keep the hero, 댓글 tab and design tokens as they are. Check at 100% zoom on full width, about 1280px, and narrow screens. Run tsc, lint and build.

**The screenshots attached to the feedback showed an unstyled page** — a
numbered list, a default `▶` details marker, no screenshot frames. None of
that was in the code: the served stylesheet already carried every rule,
and a fresh load of the same URL rendered correctly. It was a stale
stylesheet in the browser, so nothing was "fixed" for items that were
already working. **Reload before reporting a layout defect**, or the next
round spends itself chasing a cache.

#### What the data gained

- **`AppFeature`** (`icon`, `title`, `description`). The icon is a *name*,
  not a component, the same arrangement `CHAT_SHORTCUTS` uses — a data
  file that imports React components stops being data. `AppFeatureIcon` is
  a union and `FEATURE_ICON` is keyed by it, so adding a name to the data
  without adding the icon is a `tsc` error rather than a blank square.
- **`AppUpdate` lost `note` and gained `version`, `title` and `changes`.**
  One sentence per entry is what glued the date to the text; a timeline
  cannot lay out fields that do not exist separately.
- **Screenshot labels were renamed** (`결과 보기` → `결과 화면`). Feature
  titles and screen names had collided, so the same words appeared twice
  on one screen — and the test that looked one up by text found two.
- **단어 카드 has no features and no screenshots.** Every app was complete,
  so the empty state could be written but never seen. One app that is
  genuinely bare is how it gets looked at; the empty *updates* case stays
  unit-tested only, since every published app really does have a first
  entry.

#### Browser checks run — 2026-10-02 (round 2)

`tsc`, lint, 110 frontend tests (9 of them new) and `next build` pass.
Widths were measured in Chrome on the running dev server.

| Viewport | Hero | 주요 기능 | 다른 앱 | Page scrolls sideways |
| -------- | ---- | --------- | ------- | --------------------- |
| 1897px | two columns | 4 per row | 4 per row | none |
| 1280px | two columns, 352 + 610 | 3 per row | 4 per row | none (1269 of 1280) |
| 420px | stacked | 1 per row | 1 per row | none (409 of 420) |

At 420px only the screenshot row scrolls inside itself (925 of 351), which
is the intended behaviour and the reason the 소개 track is
`minmax(0, 1fr)`.

Driven by hand: a screenshot frame opened the larger view and Escape
closed it; 자세히 expanded with the chevron rotated and its four rows
right-aligned, the 저장소 row carrying the external-link icon; the
timeline's newest entry showed `v1.2`, the date and 최신 in separate
boxes 8px apart, with its two bullets below; `/ctrlaistore/word-cards`
showed both empty states with the section headings kept.

**The window could not be resized** — it was maximised, so Chrome ignored
the request, and page zoom was at 90%, which made the first screenshot
1897px of CSS rather than the 1280 it looked like. The widths above were
measured in a same-origin iframe sized exactly, which evaluates media
queries against its own viewport. Worth remembering: **measure
`innerWidth` before trusting a width**.

#### Decisions taken in round 2

- **The tab panel's inline padding is `0.75rem`, the same value as the tab
  labels'** (`comment-section.module.css`'s `.tab`). The two had been
  `0.95` and `0.75`, which put the first word of the body two pixels off
  the word "소개" above it — visible, but not obviously as a padding
  difference.
- **The screenshot frame is a `<button>`, not a `<div>` with `onClick`.**
  It opens something, so it has to be reachable by Tab and announced as a
  control.
- **The larger view is hand-drawn, not `<dialog>`.** `showModal()` does not
  exist in jsdom, so a `<dialog>` version could not be tested at all. It
  closes three ways — the button, the backdrop, Escape.
- **`.description` is capped at `76ch`.** `ch` is the width of "0" and a
  Korean glyph is about twice that, so 76ch is roughly thirty-eight Korean
  characters — a readable line. The first attempt at 62ch measured about
  thirty-one and wrapped too early.
- **The 다른 앱 grid is capped at four columns by media query.** `auto-fill`
  has no upper bound, and on a wide screen six small cards draw as much
  attention as two large ones did.
- **The old `.card` is untouched.** The listing screen still uses it; the
  detail page's row got its own `.otherCard`, and a test asserts the row
  does not contain a `.card` so the two cannot quietly converge again.

## project-video-management — full spec (merged 2026-10-07)

Branch `feat-project-video-management`, merged. Saved exactly as written
by the developer, and kept for reference.

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

## account-withdrawal — full spec (merged 2026-10-07)

Branch `feat-account-withdrawal`. Saved exactly as written by the developer.

> 1. Member self-withdrawal from Profile ("회원 탈퇴"):
>    - Requires re-entering the password plus a Korean confirmation dialog that lists exactly what will happen.
>    - Before confirming, the page reminds the member to download their videos and code ZIPs first, with links to their libraries.
>    - Choice for published work: keep it public labelled "탈퇴 회원" (default, per CLAUDE.md), or unpublish all of it.
> 2. Effects of withdrawal:
>    - account_status becomes former; the member is logged out and cannot log in.
>    - Their remaining 동아리 지원 allocation for the current quarter is released (written to the audit log). Returning it to a club reserve is budget-by-provider's work; there is no reserve yet.
>    - If they have remaining 개인 충전 balance, show a clear warning before confirming, and mark the withdrawal "환불 대기" so an admin must record the refund in Admin before the account is finalised. Never silently discard real money.
>    - UsageEvents and budget history stay, linked to an anonymised member, so quarter reports remain correct.
> 3. 30-day grace period: within 30 days an admin can restore the account (audited). After 30 days, a scheduled job anonymises personal data (username, email, display name, avatar) and the account cannot be restored. Published work keeps the "탈퇴 회원" label.
> 4. Admin: the member detail page shows withdrawn members with the withdrawal date, grace-period end, refund status, a 복구 action during the grace period, and a "환불 완료 기록" action. Admin-initiated withdrawal uses the same rules.
> 5. Tests: wrong password blocks withdrawal; a former member cannot log in; the remaining club allocation is released and the release is audited; a personal balance blocks finalisation until a refund is recorded; restore works within 30 days and not after; anonymisation removes personal fields but keeps usage totals; the unpublish choice removes items from CtrlAIApps and CtrlAITube.

**What this item leans on, which is why it sits at number 1.** Point 1's
"download your videos and code ZIPs first" links to the downloads built
in **project-video-management**, merged 2026-10-07, and
point 4's member detail page is the one built by **admin-restructure**,
already merged. Point 3's scheduled job is the first background job in
the project — there is no scheduler yet, so expect to choose one.

**Point 2 used to return the remaining club budget to "the club
reserve"**, and the reserve is created by **budget-by-provider**, now
deferred. Rewritten on 2026-10-02: withdrawal **releases** the member's
remaining allocation for the quarter and writes that to the audit log.
The money stops being spendable either way; what is missing without the
reserve is only where it goes next, and that is a line
`budget-by-provider` adds when the reserve exists.

---

## video-higgsfield-only — full spec (merged 2026-10-07)

Branch `feat-video-higgsfield-only`. Saved exactly as written by the developer.

> 1. All video generation, editing and extension go through Higgsfield only, behind VIDEO_PROVIDER (mock by default).
>    - Generate: text-to-video.
>    - Edit: "이 영상 수정하기" sends the selected version plus an instruction to the model's video-edit workflow and saves a new version. Length and framing come from the source, so hide those controls in edit mode.
>    - Extend: "이어서 만들기" uses the video-extend workflow with an explicit length.
>    - Show edit and extend only for models that support them (add supports_edit and supports_extend to the 영상 모델 catalogue); otherwise show a short Korean note.
>    - The mock provider supports all three.
> 2. The Claude panel in the Video workspace is collapsed by default, labeled "프롬프트 도움받기 (선택)", only rewrites prompt text, never generates video, and its usage is charged to the existing Build (Claude) budget (one short line says so).
> 3. Each version records how it was made (생성 / 수정 / 이어서), its source version, model, length and ratio, shown in the version strip.
> 4. Every Higgsfield call goes through the current budget service, charged to the existing Video budget, active members only. Each usage event records the provider, the feature tag, the model, the credits or seconds consumed, and the KRW amount.
> 5. Show the estimated cost in 원 next to generate, edit and extend, based on the model's per-second price in the catalogue.
>
> Tests: edit and extend create linked versions; unsupported models hide edit/extend; inactive members are refused; the Higgsfield budget is deducted; the Claude panel never triggers a Higgsfield call.

### Model-driven video settings

Added 2026-10-01, replacing the **Length slider** section of the same
date. Saved exactly as written by the developer.

> Model-driven video settings: everything in video creation follows the selected Higgsfield model.
>
> 1. Each model in the 영상 모델 catalogue stores its own options: allowed durations (a list of seconds), aspect ratios, resolutions, sound support, edit support, extend support, default values, and price per second for each resolution. Admin edits these in 영상 모델, with validation.
> 2. The Video workspace shows only the selected model's options as buttons (길이, 비율, 화질, 소리), with that model's defaults pre-selected. Options the model does not offer are not shown at all.
> 3. Changing the model re-applies its options: choices that still exist are kept, others switch to the new model's default, with a short Korean notice of what changed.
> 4. Edit and extend buttons appear only if the model supports them; in edit mode length and ratio come from the source video.
> 5. The summary line and the estimated cost in 원 (duration × the model's price for the chosen resolution) update live.
> 6. The backend rejects any request whose settings are not in the selected model's catalogue entry, and each version stores the exact settings used.
>
> Tests: only the model's options are offered; invalid combinations are rejected by the backend; switching models keeps or resets choices correctly; the cost estimate matches the catalogue price.

**What changed from Length slider.** That section asked for a 1–60 second
slider with `min_seconds` / `max_seconds` / `step` per model. This replaces
it with a **list of allowed durations** shown as buttons — a model offers
specific lengths, not a continuous range, so a slider would let a member
pick a value no model accepts. `resolutions` and a per-resolution price
are new, which makes the cost estimate depend on 화질 as well as length.

**Point 6's per-version settings already exist** —
`fix-video-workspace-hang` added `duration_seconds`, `aspect_ratio` and
`sound` to `VideoVersion` in migration `d7e1b4a9c052`, and
`project-video-management` merged on 2026-10-07 without needing to touch
them. This item uses the columns, adds the
catalogue fields in point 1, and will need a further column for the
chosen resolution.

**Point 1 overlaps `VideoModel.capabilities`**, the free-form JSON column
that already exists for exactly this purpose but whose shape is not
enforced. Point 1's "with validation" is what finally fixes that shape.

### Fixes before merge — 2026-10-07

Added after the developer's click-through, to be built on this branch
because it already reworks the workspace and the version strip. Saved
exactly as written by the developer.

> 1. Status badge
>    - Placement: on library cards the "Draft" badge floats between the name and ⋯. Put it right after the name (name truncates with an ellipsis), ⋯ alone on the right. Mark ui-library-cards item 1 done.
>    - Meaning: a project with a chosen final version still shows "Draft", on the card and in the workspace header (my probe project has v8 as 최종본). Decide the rule in the backend, apply it to existing projects too, use the same label in both places, and tell me which rule you chose.
>
> 2. Download any version
>    - Any version with a stored file can be downloaded at any time, final or not, through the existing route and its rules (owner only, works when not participating, refused for deleted projects).
>    - Workspace: a "다운로드" button in the preview header for the version shown, and a 다운로드 entry on each version in the version strip.
>    - Versions without a stored file (made before asset storage existed, like v1–v7 on probe): disabled, tooltip "파일이 없는 이전 버전입니다". Don't generate files after the fact.
>    - Library card ⋯ menu: "최종본 다운로드" when a final with a file exists, otherwise disabled with the tooltip "최종본을 먼저 고르세요". Mark ui-library-cards item 7 done.
>    - File name: <project>_v<n>.<ext>, e.g. probe_v8.gif.
>
> Tests for both, then the full suites, lint, tsc, next build, push, and tell me what to re-check. Don't merge.

**Built.** The status rule chosen: **a chosen final version makes a Draft
or Generating project Ready; clearing the final turns Ready back into
Draft; Published and Archived are never changed by it.** It runs on every
`PATCH` of a project (after any `status` sent in the same request), and
migration `4b8e2d6f1a90` applies it to existing rows. Card and workspace
header both read `VIDEO_STATUS_LABEL[project.status]`, so they cannot
disagree. Downloads are named `<project>_v<n>.<ext>`; the plain
`filename=` fallback for old clients is `video_v<n>.<ext>`.

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

## Phase 2 — Chat — full spec (merged 2026-10-07)

Branch `phase-2-chat`. Added 2026-10-01, replacing the one-line entry that
pointed at `CLAUDE.md` section 20. Saved exactly as written by the
developer.

**At position 4 since the 2026-10-02 reorder.** It has moved twice, and
the note below replaces what the earlier moves implied.

**Charge chat to the existing Build (Claude) budget through the current
budget service. Still record every field `budget-by-provider` and
`usage-analytics` will need (provider, feature tag "chat", exact model,
input and output tokens, USD cost from an admin-editable per-model token
price, the USD→KRW rate used, and KRW), so no backfill is needed
later.**

What follows from that:

- **Point 6 introduces the `UsageEvent` fields.** `budget-by-provider` is
  deferred, so there is no earlier migration to write into; this item
  adds the columns it records and the deferred item extends that shape.
- **The Claude/Higgsfield budget rename has not happened yet.** Chat
  charges the **Build** budget — the pot shown as 동아리 지원 — through
  the budget service that exists today. The rename is
  `budget-by-provider` point 1, and it is this item's recorded fields
  that make it a rename rather than a reconstruction.
- **Point 1's `ANTHROPIC_MODEL`** is already in `.env.example` and
  `Settings`; this item is what finally reads it.

> Goal: real Claude chat for members, ready for an invite-only beta.
>
> 1. Provider: a Claude adapter behind CLAUDE_PROVIDER (mock by default, "anthropic" for real). The model comes from ANTHROPIC_MODEL in the environment, never hard-coded. Max output tokens per reply and max conversation context are settings.
> 2. Conversations: Conversation and Message tables with an Alembic migration. A conversation list in Chat (새 대화, rename, delete), the current conversation's history sent to Claude within the context limit (oldest messages trimmed first).
> 3. Streaming replies in the existing chat UI, with a stop button. The Korean IME check before Enter stays.
> 4. System prompt: Claude answers in Korean, explains simply for beginners, and suggests CTRL+AI features when relevant. When a message is about building an app or making a video, the reply shows simple action buttons ("Project Builder에서 시작", "Video Generator 열기") that open those screens with the idea pre-filled. No complex agent routing.
> 5. Access and budget: require_active_member on every chat endpoint. Before each call, check the member's remaining Build (Claude) budget; if it is insufficient, refuse with a Korean message and no provider call.
> 6. Usage recording from the start, so later items need no backfill: each reply writes a UsageEvent with provider, feature tag "chat", exact model, input tokens, output tokens, cost in USD from an admin-editable per-model token price setting, the USD→KRW rate used, and the KRW amount, deducted through the existing budget service in the same transaction.
> 7. Errors: clear Korean messages for invalid key, out of provider credit, rate limits, timeouts and network failures. A failed call is never charged to the member.
> 8. Safety: the API key lives only in the backend environment and never reaches the browser or logs. A per-member rate limit (requests per minute) protects the budget.
> 9. Admin › 시스템 shows Claude as "실제 연결" when configured, and the 연결 확인 check works with the real key.
> 10. Real-provider check at the end: with my key in .env and CLAUDE_PROVIDER=anthropic, send one short real message, confirm the reply streams, the usage event and deduction are correct, and the error paths show Korean messages.
>
> Tests (all with the mock provider): conversations CRUD and ownership; inactive members get 403; insufficient budget is refused without a provider call; usage events store model, tokens, USD, rate and KRW; failed calls are not charged; the key never appears in any response.

**Merged 2026-10-07.** The decisions taken are in `BACKLOG.md` › **Now**.
**Point 10 was not run before the merge** and is carried there as an open
check before `prep-beta-launch`.

**Point 10 is the first time this project spends real money.** It needs a
key in `.env` and `CLAUDE_PROVIDER=anthropic`, so it is a step to take
with the developer present — CLAUDE.md section 21 rule 5. Points 1–9 and
every test above run on the mock provider with no key.

## ui-polish — final UI pass (merged 2026-10-07)

Raised 2026-10-07 and built on `ui-polish`, which also holds the earlier
design-handoff pass (light/dark themes, variant B shape, the restyle of
every route). Merged 2026-10-07. Saved exactly as written by the developer:

> Final UI pass on the current UI branch (same branch is fine). I've attached screenshots of the Claude Design mockup; match its look. If you need the design source, tell me and I'll export it from Claude Design.
>
> 1. Typography
>    - Match the mockup's typeface. Tell me which font it is before adding it. If it's Pretendard (not on Google Fonts), self-host it from the npm package or a local woff2. That's a new dependency, so ask me first.
>    - Keep Korean rules: Hangul-first font stack, word-break: keep-all, IME check before Enter.
>    - Use the mockup's type scale: page title, the small coloured eyebrow ("● Create"), card names, body and meta. Meta lines (dates) stay in the UI font unless the mockup clearly uses monospace.
>
> 2. Sidebar
>    - Wider, like the mockup, so "함께 만들고 함께 나누는 AI 창작 커뮤니티" fits on one line, with larger nav items and more spacing.
>    - Collapsible: a toggle button collapses it to an icon-only rail (tooltips with the item names) and expands it again. Remember the choice per browser in localStorage (wrapped in try/catch, default expanded). The narrow-screen menu button keeps working.
>    - The Admin item shows the count of items waiting (pending applications/top-ups) as a small badge, like the mockup's "2".
>
> 3. Page layout
>    - The mockup's page header: eyebrow, title, subtitle, primary button on the right, divider.
>    - A wider content area, and the mockup's card style: a thumbnail area on top (video: the version thumbnail; builder: a striped placeholder labelled 미리보기 썸네일 until Phase 3), larger padding and names, badge right after the name, ⋯ on the right.
>    - Apply it consistently to Chat, Project Builder, Video Generator, CtrlAIApps, CtrlAITube, Usage, Profile and Admin, not just the two libraries.
>
> 4. Status simplification (include in this branch)
>    - Remove ARCHIVED from BuilderProjectStatus and VideoProjectStatus with an Alembic migration (map existing archived rows to draft; the downgrade re-adds the value). Keep draft, building/generating, ready and published in the DB.
>    - Library filters become exactly 전체 / Draft / 게시됨 ("Draft" = draft + ready + building/generating; "게시됨" = published), backed by the list endpoint.
>    - Badges show only "Draft" or "게시됨"; while generating, a small "생성 중…" indicator instead. Video's final version stays as the "최종본 선택됨" meta line.
>
> 5. Design tokens: every new colour, size and spacing goes into globals.css as a token; no hard-coded values in components. Dark theme stays the default. If the mockup's light theme is easy to support through the same tokens, propose it but don't build it yet.
>
> 6. Record the decisions in BACKLOG (ui-library-cards items they complete, plus the status decision), saved verbatim.
>
> Tests: the existing card-overlay and sidebar tests still pass; add tests for the collapsed sidebar (state persists, nav still reachable, tooltips present), the three filters, and badges only ever showing Draft or 게시됨.
> Check it in a browser at 1280px and 1920px wide and on a narrow screen, and send me screenshots of Chat, Builder, Video and Admin.
>
> Mock providers only, don't touch my dev DB, don't merge. Tell me the alembic step to try it.

**Decisions taken with the owner (2026-10-07):**

- **Mockup source:** no screenshots came through; the owner chose the
  Claude Design HTML export already in the repo's working tree
  (`design_handoff_ui_polish/CTRL+AI Full Site.html`). Sizes were measured
  from it in the browser.
- **Font: Pretendard Variable 1.3.9**, the mockup's font, added as the npm
  dependency `pretendard` (SIL Open Font License) and loaded from its
  **dynamic-subset** CSS in `app/layout.tsx` — self-hosted, and a page
  downloads only the Hangul ranges it shows.
- **Light theme: kept as built** on this branch (the owner's choice), with
  dark still the default. New tokens follow the same scheme.
- **Meta dates stay monospace** on the library and community cards,
  because the mockup clearly sets them in `ui-monospace`.
- **Thumbnail on top for both libraries**, as the request says, although
  the mockup draws the video card's picture as a 72×128 tile at the left.

**Status decision (owner, 2026-10-07):** `archived` is gone from both
`BuilderProjectStatus` and `VideoProjectStatus` — migration
`7c1d5e93a4b2` turns archived rows into draft and rebuilds the CHECK
constraints; the downgrade restores the value. The database keeps draft,
building/generating, ready and published. Members see only **Draft**
(draft, building/generating, ready) and **게시됨** (published), with a
"생성 중…" note while building or generating; a chosen final version is
the "최종본 선택됨" meta line. The libraries' filters are exactly
전체 / Draft / 게시됨 and come from the list endpoint
(`?status=all|draft|published`).
