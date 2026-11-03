# First meeting — 2026-11-03 (1차 모임)

Material for the first all-member presentation of CTRL+AI, and what
preparing it turned up. Written 2026-11-03.

## What the presentation shows

A ~5-minute walk-through built from **real screens** (ctrlai.my as member
anoukkim, plus a local copy for the parts a signed-in member cannot
replay), shown as a moving page in a Chrome-window frame with GIF clips.
The clips follow one member's path:

1. **Sign up and get in** — invite link → sign-up form (초대 코드, 아이디,
   이름, 이메일, 비밀번호) → first-time guide (처음 안내).
2. **Join the quarter** — Chat is locked until then ("Profile에서 참여
   신청하기") → Profile › 「이번 분기 참여」 → 승인 대기 → an admin approves
   in Admin › Members → the 80,000원 동아리 지원 wallet appears.
3. **Chat** — model and 생각 깊이, 생각 과정 보기, 웹 사용, 코드 실행; a
   "웹페이지 만들기" answer opens a preview in the side panel; refine it
   by chatting; 「Builder로 보내기」 opens the final version in Builder.
4. **Builder** — 만들 계획 → file-by-file build → 점검 → 고치기 → 게시 to
   CtrlAIApps → 내보내기 (ZIP / 내 Claude로 이어서 만들기). Demo app:
   주말 여행지 탐색기 (map tiles, weather, Wikipedia through the 기능 상자).
5. **Someone else's app** — using an app's AI charges **my** wallet
   ("앱 AI · N원 · 내 동아리 지원금에서"); the 데모 switch costs 0원.
6. **Usage, light mode, feedback** — Usage shows every charge; the account
   menu (click your name, bottom-left) holds Profile · Usage ·
   밝은 화면으로 / 어두운 화면으로 · 처음 안내 다시 보기 · 의견 보내기 ·
   로그아웃.

The page, images, GIFs and the Korean script live in the presenter's
scratchpad (not committed — ~40 full-width screenshots); the published
page is the Artifact "CTRL+AI demo". Demo projects created on ctrlai.my
while recording are to be deleted afterwards.

## Recorded on the local copy (test data, not production)

Signup, 처음 안내, 참여 신청, 승인 대기, the admin's 승인 dialog and invite
codes, the approved 80,000원 wallet, the account menu, and light-mode
Profile and Chat. Caveats when showing them: the local screens carry a
"테스트 모드 – 실제 AI 결과가 아닙니다" strip, and the local 신청 기간
(09.15–09.30) is not the real one — do not quote those dates.

## Found while recording (not yet investigated)

On ctrlai.my, as a member:

1. **Chat preview maps do not load.** In a Chat "웹페이지 만들기" preview,
   OSM tiles answer 403 and CARTO asks for an API key; the same app's map
   works once it is in Builder (the `/_ctrlai/tiles` proxy). The Chat
   preview frame may need the same outside-service allowances as the app
   runtime.
2. **A Builder-made app's AI button was hidden** while the 실제 AI switch
   was on; after a 고치기 round (302원) the button showed but the AI call
   hung. The showcase app 여행 일정 메이커 was used for the demo instead.
3. **App-AI charge not visible in Usage.** The toast said 앱 AI · 10원, but
   the wallet stayed at 71,548원 and Usage showed no row — either the
   charge was not written or the screen did not refresh.
4. **Usage dates disagree.** 최근 사용 내역 shows 11.02 for events that
   날짜별 counts under 11.03 — looks like UTC vs KST in one of the two.

On the local copy:

5. **Redirect after sign-in.** After the admin signed out and member 민지
   signed in, she landed on the admin's last page (Admin › Members)
   instead of Chat. The post-login redirect keeps the previous path
   without checking the new user's role; the member then sees the
   members-only redirect, so it is a wrong-page flash, not an access
   issue — but worth a fix.

Each of these is a candidate backlog item; none is scheduled yet.
