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
4. **Sidebar width** — ✅ 248px → 228px (`--sidebar-width`); items, the
   tagline and the Admin sub-items stay on one line (checked in the
   browser, see screenshots); collapsed rail (68px) and mobile unchanged.
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
   - (browser sweep findings are appended below after the screenshot pass)

## Status

(filled at the end of the loop)
