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

## Status — loop results

- Merged `main` (privacy-and-terms, `0cdcee8`) mid-run; its sidebar
  footer links are inside the reworked account area and its tests pass.
- Frontend: **360 vitest / 35 files**, tsc 0, eslint 0. Backend: full
  suite green with the PostgreSQL tests actually running (dedicated
  `ctrlai_ui_test`; `-rs` shows no skips). `npm run build` not run in the
  worktree (Turbopack refuses here) — run it on main at merge.
- Browser: preview on 8270/3270 in **beta mode** (as on ctrlai.my — the
  banner is one of the two 의견 보내기 entry points), Playwright driving
  Chrome, both themes at 1280 and 390px. An automated geometry pass checks
  every Admin page (incl. member detail), the member pages, /privacy and
  /terms for sideways scroll, every search input for text under its icon,
  the sidebar for wrapped/cut items, tagline and badge, and every dialog
  (feedback from the sidebar and from the banner, quarter creation, invite
  code, default model, chat limits, withdrawal) for content outside its
  padding and portal placement — **0 findings** on the final run; members
  never see Manage, Admin or the badge (checked).
- Screenshots: 104 jpgs (5.1 MB) in `docs/progress/screens/fix-ui-polish-admin/`
  — `admin-<page>-<theme>-<width>`, `sidebar-{admin,member}-{expanded,collapsed,menu}-…`,
  `dialog-<name>-<theme>-<width>`, `public-{privacy,terms}-…`,
  `page-{apps,tube,builder,video}-dark-…`.
