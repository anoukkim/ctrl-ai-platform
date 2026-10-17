# fix-ui-polish-admin — checklist

Owner's queued item of 2026-10-14 (merge and deploy pre-approved under the
same loop). Branch `fix-ui-polish-admin`.

1. **Search inputs overlap their icon** — ✅ root cause: the global
   `.field { padding }` has the same specificity as the module's
   `.input` and loads later, so it reset `padding-left` and the
   placeholder sat under the magnifier. `SearchBar.module.css` now uses
   `.searchWrap .input`. One shared component, so every page is fixed at
   once: Admin › AI Models, Video Models, Members, Applications, Audit
   Log, Deleted Items, Feedback; CtrlAIApps, CtrlAITube; the Builder and
   Video libraries (screenshots).
2. **Admin › System repeats itself** — ✅ one section per concern:
   **환율** (editable; links to AI Models for the default model and the
   per-model prices), **채팅 한도** (editable: 1회 한도, 긴 대화 경고,
   하루 한도, 동시 호출, 페이지 읽기 회수/토큰), and one compact read-only
   **서버 설정 (.env)** list (답장 최대 출력, 대화 기록 한도, 회원당
   보내기, 프롬프트 캐시, 생각). No value appears twice. **기본 모델
   removed** from System (it belongs to AI Models). The stale
   "동아리 지원(Build)" note is gone; whole-frontend sweep for
   pre-single-wallet wording found one more (Chat composer hint) — fixed.
   외부 서비스 cards kept unchanged.
3. **Sidebar › Account** — ✅ Usage and Profile are ordinary vertical items
   (icon + label, same size, spacing and active state as Chat); the
   three-across compact layout and its styles and token are removed; the
   collapsed rail shows them like every other icon.
4. **Sidebar width** — ✅ 248px → **230px** (`--sidebar-width`). At 228px
   the tagline was cut by 6px (measured), so: 230px, the brand block's side
   padding 8→6px and the tagline 11.5px — it now fits with ~8px to spare.
   Every item and Admin sub-item stays on one line (automated check);
   collapsed rail (68px) and the phone menu unchanged.
5. **Manage group** (owner decision 2026-10-14) — ✅ order Create, Explore,
   Manage, Account; "Manage" heading for admins only, same heading style
   and spacing, holding the expanding Admin item (open/closed still
   remembered); a divider between groups in the collapsed rail (so one
   before the Admin icon); members never see Manage or Admin; a small
   **관리자** badge beside the admin's name in the account area; Admin
   pages keep "Admin › …". CLAUDE.md §3, docs/product.md and the sidebar
   tests updated (new tests: group order, member sees no Manage/Admin/badge,
   Usage/Profile are ordinary items).
6. **의견 보내기 dialog overflow** — ✅ root cause: every dialog rendered
   inline next to the button that opened it, so it inherited its parent's
   text rules; the beta banner sets `white-space: nowrap` and
   `font-size: 0.8rem`, so the dialog's text did not wrap and pushed the
   textarea and 보내기 past the padding. New `DialogShell` renders every
   dialog into `document.body` (portal) with one inner padding (22/24px,
   18/16px on phones), a `minmax(0, 1fr)` column, shrinkable children,
   wrapping actions and a viewport-height cap; text rules are reset on the
   panel. Feedback (both entry points — same component) and ConfirmDialog
   (invite codes, quarter creation, withdrawal, default model, chat
   limits, tools, deletes …) use it; the first-visit guide gets the same
   padding and column rules.
7. **Sweep — extra fixes** (copied into the run log):
   - The same `.field` specificity race affected other module classes
     combined with `.field` — SearchBar's filter `.select`, AI Models'
     `.visibilitySelect` and `.priceInput`: made order-independent with
     `:global(.field)` compounds.
   - Admin › Dashboard: a dead `dev` card entry ("사용량 시뮬레이터")
     removed (Dev Tools is gone); cards with no figure (AI Models,
     Feedback, Deleted Items) no longer render an empty status line.
   - AppShell's comments still described "no Manage group", nine Admin
     sections and top-up badges — updated.
   - **Admin › Quarters scrolled sideways at 1280px and Budget at 390px**:
     the page's `.sections` grid used an `auto` track, which sizes to the
     widest child's min-content (the quarter table, the stat cards) —
     now `minmax(0, 1fr)`, so tables scroll inside their own box.
   - **Account area was too cramped for the 관리자 badge**: with avatar,
     name and four icon buttons on one line the name ellipsised to nothing
     and the badge read "관리". The account area is now two rows — avatar,
     name, 관리자 badge, handle; then 개인정보 · 약관 (from
     privacy-and-terms) on the left and the four icon buttons on the right
     — with a divider above. Collapsed rail: avatar, then the buttons in a
     column; the legal links stay hidden there (privacy's test still passes).
   - **Admin › AI Models hid its 설정 column past the table edge at
     1280px**: the three prices sat on one non-wrapping line, and the long
     `deepseek/deepseek-v4.1-flash` id could not break. Cache-read price
     moved to its own line; a host/model id may break after the slash. Both
     tables now fit at 1280 and 1920 (measured).
   - **Admin › Quarters hid 사용률 and the row actions (신청 열기) past the
     table edge at 1280px** (143px): each date range now shows on two
     lines; the table fits.
   - **Invite-code form and + 모델 추가 form sat flush against their
     card's edge**: the slim in-table editor padding (`.modelEditor`) beat
     `.card`; the standalone card variant now gets the card padding.
   - **Leftover personal-money wording** while top-ups are off: Budget's
     note about 개인 잔액 now appears only when top-ups are on; Member
     detail's 개인 잔액 section shows only when top-ups are on or that
     member actually has personal money or top-up history (money to settle
     is never hidden).

   **Review round 1** (independent reviewer; all fixed):
   - **Member detail "HTTP 500" in one screenshot** (dark, 1280). Not
     reproduced: the route is a pure read (no writes, nothing racy), and
     three cold-start rounds plus the final pass — every member's detail
     page in both themes at both widths (16 loads), with every 5xx
     response logged with its URL — returned none; the backend log has no
     500. The original run's backend log was truncated, so where that one
     500 came from is unknown; most likely the preview itself: that pass
     ran right after `git merge main` brought privacy-and-terms into the
     worktree, while the dev server was rebuilding and the backend had
     just restarted. The screenshot pass now treats any 5xx and any
     "불러오지 못했습니다" on a page as a failure, so a recurrence cannot
     pass unnoticed. Screenshots re-captured.
   - **Member detail: a long email ran into the next column**
     (`both_member@example.com2026.10.14 08:28`). Fact cells may shrink
     (`min-width: 0`) and long values break inside their own column
     (`overflow-wrap: anywhere`); the pass now checks every fact value.
   - **Admin › System: the 채팅 한도 heading sat over an empty body while
     loading or after a load error** — it now shows the same skeleton /
     error as 환율.
   - **Budget: the 지원금 / 개인 column still showed while top-ups are
     off** — shown only while top-ups are on or someone actually spent
     personal money (verified with a real provider row).
   - **Order independence**: `.rateField`, `.createInput`, `.starterIdea`
     and `.promptArea` (all always used with `.field`) are now
     `:global(.field)` compounds like the others.
   - The "공개 범위 칸의 고르는 칸" comment moved back above
     `.visibilitySelect`; product.md's Video Generator row says the one
     동아리 지원 wallet instead of "charged to Video".
   - **Admin sidebar at 1280×860 with Admin open** (about 300px taller
     than the sidebar): the current admin section now scrolls into view
     inside the sidebar on load (only the sidebar's own scroll box moves,
     never the page), and sub-items are 2px tighter. On /admin/system and
     /admin/audit the active item is visible (automated check on all 11
     admin pages). **Accepted:** the Account group (Usage, Profile) stays
     one scroll below while Admin is expanded; collapsing Admin
     (remembered) brings it back.
   - **New test** `__tests__/dialog-shell.test.tsx`: the dialog renders
     into `document.body` (not inside a `white-space: nowrap` opener), a
     backdrop click and Escape close it, and the banner's and the
     sidebar's 의견 보내기 open the same dialog.
   - Found while re-checking: the **승인 대기 badge stretched across the
     whole 신청 column** in member detail's 분기 이력 (a grid item
     stretches by default) — `.stackCell` now keeps badges their own
     width (also Applications and the withdrawal 환불 cell); and **Budget's
     사용량 cell ran one long line**, pushing the provider table 11px past
     its box at 1280px once there was real usage — one item per line now.

## Status — loop results

- Merged `main` (privacy-and-terms, `0cdcee8`) mid-run; its sidebar
  footer links are inside the reworked account area and its tests pass.
- Frontend: **364 vitest / 36 files** (after review round 1), tsc 0,
  eslint 0. Backend: full suite green with the PostgreSQL tests actually
  running (dedicated `ctrlai_ui_test`; `-rs` shows no skips) — round 1
  touched no backend code. `npm run build` not run in the worktree
  (Turbopack refuses here) — run it on main at merge.
- Browser: preview on 8270/3270 in **beta mode** (as on ctrlai.my — the
  banner is one of the two 의견 보내기 entry points), Playwright driving
  Chrome, both themes at 1280 and 390px. An automated geometry pass checks
  every Admin page (incl. member detail), the member pages, /privacy and
  /terms for sideways scroll, every search input for text under its icon,
  the sidebar for wrapped/cut items, tagline and badge, and every dialog
  (feedback from the sidebar and from the banner, quarter creation, invite
  code, default model, chat limits, withdrawal) for content outside its
  padding and portal placement — **0 findings** on the final run; members
  never see Manage, Admin or the badge (checked). Since review round 1 the
  pass also fails on any 5xx response, any load-error text, any table
  wider than its box at 1280px, any fact value spilling out of its cell,
  and an active sidebar item hidden below the fold; member detail is
  checked for every member; it was run with real usage data present.
- Screenshots: 104 jpgs (5.1 MB) in `docs/progress/screens/fix-ui-polish-admin/`
  — `admin-<page>-<theme>-<width>`, `sidebar-{admin,member}-{expanded,collapsed,menu}-…`,
  `dialog-<name>-<theme>-<width>`, `public-{privacy,terms}-…`,
  `page-{apps,tube,builder,video}-dark-…`.
