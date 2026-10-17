# Admin consolidation — decision log and plan (2026-10-17)

Status: **proposal, nothing built.** Not yet in `docs/BACKLOG.md`.
Mock-up: [`admin-consolidation.html`](admin-consolidation.html) — static, fake figures,
built from the real design tokens. Open it in a browser.

## Why

Admin has 13 sections shown three times (sidebar submenu, tab bar, the
Dashboard's 관리 구역 card grid), and several pages repeat each other:

| Repeat | Where |
| ------ | ----- |
| Same member counts | Dashboard tiles, Members tiles, Applications tiles, Quarters row |
| Counts as tiles *and* pills | Applications (승인 대기 / 승인됨 / 거절됨 / 전체) |
| 지급 / 사용 / 남음 twice | Budget tiles and the "지급 vs 사용" accordion header |
| Cache report twice | Budget › 캐시 and AI Models › 캐시 절약 |
| Providers listed twice | System › 연결 상태 and 외부 서비스 |
| Quarter banner on every page | Applications, Budget (the only switcher is the Quarters row) |
| Pages with almost nothing | Content (two empty cards), Applications (usually 0 pending) |
| Settings in the wrong place | 채팅 한도 lives in System, not next to the models |

## Decisions (owner, 2026-10-17)

1. **13 sections → 6:** Dashboard · Members · Quarters · Models · Community · System.
2. **One navigation, not three.** The Dashboard card grid goes; Dashboard becomes
   "처리할 일" (items with a count of 0 are hidden), keeping the Anthropic monthly
   budget alert (token-guard) there.
3. **Members** absorbs Applications (a 승인 대기 chip + tab badge) and the invite codes.
4. **Quarters** absorbs Budget; sub-tabs **분기 · 예산 | 사용 분석**; one quarter switcher
   in the header. Drop the "지급 vs 사용" accordion; merge the two cache reports.
5. **Models** = Chat · Video · 한도 · 보정 (채팅 한도 and 비용 보정 move here; a
   "이번 분기 사용" column on each model).
6. **Community** = 앱 · 신고 · 의견 · 삭제됨 in one inbox (Apps, Content, Feedback,
   Deleted Items). Empty sections hide.
7. **System** = 상태 · 감사 기록; each provider shown once; 유지보수 (썸네일 다시
   만들기) lives here.
8. **Wording: 미참여, not 미신청.** The Members tile and filter say 미신청 while the
   row badge says 미참여 for the same person. One word: **미참여**
   (`StatusBadge.tsx`'s existing label; it also covers a rejected application).
9. **The orange tile means "needs action", not "selected".** It was
   `accent: not_applied > 0`. 미참여 is information, not a task, so it loses the
   orange; orange stays for 승인 대기, 열린 신고, 새 의견 and the tab count badge.

## New things (not just moves)

- **Members list: 사용률 열** (bar + %; amber at ≥ 80%; sortable). No migration —
  `UsageEvent` already has everything.
- **Member detail › 사용 내역:** 사용 / 사용률 / 남음 / 호출 수 / 소진 예상; 기능별
  (채팅·빌더·앱 AI·영상); 모델별 table with tokens; 최근 호출.
- **Quarters › 사용 분석** (this replaces the *Admin › 사용량 분석* of the old
  `usage-analytics` spec, `BACKLOG.md`): 제공자별 (원가 USD, 청구 원, 남은 크레딧, 소진
  예상 — "what to buy next"), 기능별, 모델별 + 캐시 절약, 앱 TOP 5, 회원 TOP 5, 일별
  추이 + 분기 말 예상. Shows 원가 and 청구 side by side (they are recorded separately).
- **Dashboard:** one line, "이번 주 가장 많이 쓴 곳".
- **Small adds found missing:** 비밀번호 재설정 버튼 (today only the
  `set_password` CLI), 백업 상태 한 줄 in System, 공지 보내기 (the bell exists, no
  admin broadcast — optional, decide separately).
- **Stays hidden:** Top-ups (`personal-topup-off`).

## Plan — one branch per item (CLAUDE.md §12)

| # | Branch | What | Risk |
| - | ------ | ---- | ---- |
| 1 | `refactor-admin-sections` | `sections.ts` → 6 sections; tabs, sidebar, breadcrumbs, dashboard read it. Old routes (`/admin/applications`, `/budget`, …) redirect to the new place so bookmarks survive. Update `__tests__/admin-sections.test.ts`. | low |
| 2 | `feat-admin-dashboard-todo` | 처리할 일 (hide zeros, keep budget alert), remove the card grid and repeated counts; 미참여 wording and the orange rule. | low |
| 3 | `refactor-admin-merge-people-money` | Applications into Members (+ 사용률 열); Budget into Quarters with sub-tabs; single quarter switcher. | medium — the `?quarter=` query |
| 4 | `refactor-admin-models-community-system` | Models tabs (+ 한도 · 보정 moved from System), Community inbox, System + 감사 기록. | medium |
| 5 | `feat-admin-member-usage` | Member detail 사용 내역 + its API. | new API |
| 6 | `feat-admin-usage-analysis` | Quarters › 사용 분석 + aggregate API; supersedes `usage-analytics`. | new API |
| 7 | `feat-admin-small-adds` | 비밀번호 재설정, 백업 상태, (공지 보내기). Each can be approved on its own. | 공지 = new feature |
| 8 | `docs-admin-sections` | `docs/product.md` route table and CLAUDE.md §3 ("Thirteen sections"). | low |

Order: 1 first (the frame + redirects), 2–4 independent of each other, 5–6 after 3,
7 last, 8 with each merge or at the end.

## Open questions

- 공지 보내기 now or later?
- Keep the old `/admin/*` addresses as redirects? (Recommended: yes.)
- Merge `usage-analytics` into item 6, or keep both specs? (Recommended: merge.)
