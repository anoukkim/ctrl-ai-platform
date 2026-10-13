# ui-friendly-motion — checklist

Branch `feat-ui-friendly-motion`. Spec: `docs/BACKLOG.md` › ui-friendly-motion
(saved verbatim there).

## Requirements

1. Add the `motion` library (no other new dependency, no Tailwind).
2. Card hover lift.
3. Button press feedback.
4. Page and panel transitions.
5. Sidebar collapse animation.
6. Skeleton loaders instead of "불러오는 중".
7. Toast notifications for saves, deletes and downloads.
8. A typing indicator while Chat streams.
9. An animated wallet number when the balance changes.
10. Gentle success states.
11. `prefers-reduced-motion`: no motion at all.
12. Animations short (150–300 ms) and never blocking input.
13. Friendlier copy: developer terms members see → plain Korean (Draft → 작성 중,
    Build/Video budget wording → the single wallet, provider/model jargon →
    simple descriptions).
14. Keep the English menu names unless a change clearly helps — **propose,
    don't decide** (below).
15. Empty states with a short explanation and one clear action on every list.
16. A first-visit guide: 3–4 steps, dismissible, remembered per browser,
    showing Chat, Builder, Video and the wallet.
17. Keep design tokens in `globals.css`, Pretendard, dark default, the
    existing accessibility rules.
18. Check at 1280 px, 1920 px and phone width; screenshots of Chat, Builder,
    Video, Usage and Admin for the owner.

## Tests named by the spec

19. Reduced motion disables animations.
20. The guide shows once and can be reopened.
21. Empty states render.
22. Existing tests still pass.

## Menu names — proposals only (not changed)

- Keep **Chat**, **Project Builder**, **Video Generator**, **Usage**,
  **Profile**, **Admin**: short, already in the docs and screens.
- Consider **CtrlAIApps → Apps** and **CtrlAITube → Videos** in the menu
  only (the page titles can keep the brand names): a beginner reads what the
  page holds, not a brand. Owner's decision.
- Consider **Report Issue → Feedback** once anonymous-feedback-board makes
  that page a board of notes rather than a bug form. Owner's decision.

## Status (self-review against the diff)

1. ✅ `motion` 14.2 in `frontend/package.json`; nothing else added.
2. ✅ `library.module.css .card:hover`, `admin.module.css a.card:hover` (apps/tube cards already lifted).
3. ✅ `globals.css .btn:active`.
4. ✅ `app/template.tsx` + `PageTransition` (opacity only — a transform would
   pin fixed dialogs to the page); dialogs and toasts animate with motion.
5. ✅ `AppShell.module.css`: grid column transition 0.2 s and label fade.
6. ✅ `Skeleton` on every former "불러오는 중…" (27 files); the words stay for screen readers.
7. ✅ `ToastProvider` / `useToast`: rename, delete (both libraries and workspaces), downloads (menus and video versions).
8. ✅ `ChatWorkspace` typing dots before the first word; the caret after.
9. ✅ `AnimatedNumber` in the sidebar wallet; the meter bar eases too.
10. ✅ `success-pop` checkmark on `ResultMessage` (ok) and the feedback thanks.
11. ✅ `MotionRoot` (`reducedMotion="user"`) + the global CSS rule.
12. ✅ 120–400 ms (the wallet count 400 ms); nothing sets `pointer-events: none` on content.
13. ✅ 작성 중 for Draft; Usage's provider column reads "Claude · 대화와 글" / "Higgsfield · 영상".
14. ✅ proposals above; no menu changed.
15. ✅ `EmptyState`: Chat conversations, Usage, Profile's two lists; the two
    libraries already had an explanation and one action.
16. ✅ `FirstVisitGuide` (4 steps, `ctrlai.guide-done`, reopened by the sidebar's ?).
17. ✅ tokens only; Pretendard; dark default; focus and labels kept.
18. ✅ `docs/progress/screens/ui-friendly-motion/` — Chat, Builder, Video,
    Usage, Admin at 1280, 1920 and 390 px, the guide (light), three empty states.
19–22. ✅ `__tests__/ui-friendly-motion.test.tsx` (reduced-motion CSS rule and
    the wallet number; guide once + reopen + four steps; empty states;
    skeleton; toast; 작성 중); existing suites updated for 작성 중.

Found by the browser check and fixed here:
- **A new member's first Usage visit answered 500**: the sidebar and Usage
  created the personal wallet at the same moment and the second insert hit
  the unique user id. `wallet.get_or_create_balance` now inserts inside a
  savepoint and reads the winner's row (`test_two_first_requests_for_a_new_wallet_do_not_fail`).
- The sidebar name wrapped onto three lines with the extra footer button;
  it is now one line with an ellipsis.

## Review round 1 — 16 findings (4 medium, 12 low)

Fixed:
- Reduced motion now stops **all** motion animations, fades included
  (`MotionGlobalConfig.skipAnimations` in `MotionRoot`), not only position.
- The guide traps Tab inside itself and gives focus back to the ? button.
- The page fade is skipped on the first load, so the server's HTML never
  waits blank for JavaScript.
- Sidebar labels now fade in when the rail opens.
- Announcements: toasts announce once (the region), the typing dots have a
  hidden text line, the skeleton inside Chat's log is quiet.
- Hover lift only where a mouse exists (`@media (hover: hover)`); toasts no
  longer catch clicks on phones; `.btn` keeps its colour transition; the
  wallet number counts from what is on screen.
- Member-facing developer words removed: the libraries' error text (it
  printed a `uvicorn` command), "개인 접근 토큰", "모델" in the picker
  (→ 답장 방식), a stale "Draft" comment.
- Empty states with one action added: Chat's list (새 대화 시작), Profile's
  apps. The guide's wallet step says where the card is on a phone, and
  opening the guide from the phone menu closes the menu.
- Tests added: motion animations skipped under reduced motion; a toast goes
  away; the Usage screen's empty state.

Left as is, on purpose:
- Loaders loop (skeleton 1.4 s, typing dots 1 s): they show waiting, not a
  transition; the 150–300 ms rule is for transitions. Both stop under
  reduced motion.
- Admin tables keep their one-line empty text (staff screens, and each
  already says what fills it); `CommentSection` is still the mock of
  Phases 5 and 8.
- Admin saves keep `ResultMessage` (now with a checkmark); toasts are for
  member actions.
- The wallet savepoint fix is proved on SQLite with a simulated race; a
  PostgreSQL concurrency test like the row-lock one is a follow-up.

## Review round 2 — clean; three low findings, fixed

- `MotionRoot` follows the reduced-motion setting live (a media query
  listener), not only at load.
- On a phone the guide returns focus to the menu button.
- The reduced-motion test resets global state in `afterEach`.
