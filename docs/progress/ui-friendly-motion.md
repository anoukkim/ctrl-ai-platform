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

## Status

(filled in at step 6)
