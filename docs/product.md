# CTRL+AI — the product

What the product is and the rules it follows: screens and routes, the two
workspaces, language and design, money and participation. Moved here from
the repository README on 2026-10-07; the text is unchanged.

For status and order see [`ROADMAP.md`](ROADMAP.md) and
[`BACKLOG.md`](BACKLOG.md); for running it see
[`development.md`](development.md).

## What CTRL+AI is

A beginner-friendly AI creation community. Members describe what they want
in Korean, and CTRL+AI helps them build an app or make a short video, then
share it with the community.

Most members are not expected to code, use APIs or configure a development
environment, so the product hides that complexity. CTRL+AI owns provider
access — members never hold API keys — and records usage per member and
quarter.

`내가 원하는 것을 말한다 → CTRL+AI가 만들어 준다 → 공유한다`

## Current Status

**Phase 0 (product shell) is complete.** The repository contains a working local
slice of the product: a Next.js frontend with the full navigation and every
screen present, a FastAPI backend, and PostgreSQL via Docker Compose.

**Chat is the opening screen.** CTRL+AI is aimed at members who may not code, so
the entry point is a conversation, not a dashboard.

**The interface is Korean-first** with an English menu. See
[Language](#language).

[`CLAUDE.md`](../CLAUDE.md) is the product definition and the phase plan.
[`docs/BACKLOG.md`](BACKLOG.md) is the ordered queue of what happens
next. [`docs/architecture.md`](architecture.md) covers the
longer-term architecture — target infrastructure, storage and security
principles.

| Area                  | State                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| Navigation & shell    | Built — sidebar (230px; Create · Explore · Manage (admins) · Account, collapsible to an icon rail) with quarterly participation status; menu button on narrow screens |
| Chat (default page)   | **Built** — conversations, streamed Markdown replies with 중지, live 약 N원 + ledger receipts, per-reply/daily cost caps, tool toggles (웹 검색·페이지 읽기·코드 실행, mock), 기능 둘러보기 examples, action buttons into Builder/Video; mock Claude by default, charged to the member's one wallet by the token |
| Project Builder       | Full-viewport workspace: files │ code │ Claude, preview and build output below    |
| Video Generator       | Generate / edit / extend through the **mock** Higgsfield provider, charged in KRW to the member's one 동아리 지원 wallet. **Locked for members by default** (owner-polish 6, 2026-10-16): the 관리자 opens it in Admin › System › 기능 열기 the quarter video starts; until then the menu item carries a lock and the whole screen is one centred lock with "다음 단계에서 열려요 — 지금은 준비 중이에요" (owner's shape, 2026-10-16); the 관리자 sees the same screen plus "Admin › System에서 열 수 있어요", and the API never locks the 관리자 out |
| CtrlAIApps            | Mock listings; detail page is a hero, one primary action and three tabs (소개 / 댓글 / 업데이트 기록) sharing CtrlAITube's comment section |
| CtrlAITube            | Real rows only: the club's intro video (공식 — the 9:16 cut, played in the page on every device, real reactions and comments since `promo-videos`; no sample cards since `fix-promo-video-placement`); watch page is two columns — a vertical player with the text beside it, sticky comment panel; CTRL+AI comments kept separate from YouTube comments |
| Usage                 | **Live** — one 동아리 지원 wallet with a 채팅/빌더/영상/기타 breakdown, 대화별 / 날짜별 totals split into 입력 / 캐시 쓰기 / 캐시 읽기 / 출력 / 도구, this quarter's 캐시로 아낀 금액, and the ledger; the 개인 잔액 block is hidden while top-ups are off (personal-topup-off) |
| Profile               | Live signed-in member, quarter participation, application form and 회원 탈퇴        |
| Admin                 | **Live** — section hub, member/application/quarter figures, wallets and spend by provider, audit log |
| Backend `/api/health` | Real and working                                                                  |
| PostgreSQL            | Real, via Docker Compose; Alembic owns the schema                                 |
| Authentication        | **Built** — Google or username/password for every member (both allowed, at least one kept); invite code to sign up; Argon2 hashes; HttpOnly session cookie |
| Claude                | Real adapter built behind `CLAUDE_PROVIDER` (mock by default); not yet run with a real key |
| Higgsfield            | Mock provider behind `VIDEO_PROVIDER`; real adapter not built                     |
| GitHub / YouTube      | Not started (Phases 4 and 7)                                                      |

No mock data remains anywhere money is involved. What is still mock: the
CtrlAIApps and CtrlAITube listings (Phases 5 and 8), and Claude's replies
until `CLAUDE_PROVIDER=anthropic` is set with a key.

Everything that is not built yet renders a **준비 중** badge, and its controls are
disabled, so the shell is never mistaken for working functionality.

## Routes

| Route                 | Screen          | Notes                                        |
| --------------------- | --------------- | -------------------------------------------- |
| `/login`              | 로그인          | Korean sign-in; logged-out visitors land here |
| `/signup`             | 회원가입        | Korean sign-up; consent to the two documents below is required (privacy-and-terms) |
| `/privacy`            | 개인정보 처리방침 | Korean privacy policy; logged out too          |
| `/terms`              | 이용약관        | Korean terms of use; logged out too            |
| `/`                   | Chat            | Default landing page (requires sign-in)      |
| `/builder`            | Project Builder | Workspace: files, code, Claude, preview      |
| `/video`              | Video Generator | Workspace: prompt, 9:16 player, Claude, versions |
| `/ctrlaistore`        | CtrlAIApps      | Community app listings                       |
| `/ctrlaistore/[slug]` | App detail      | Hero, 앱 실행, tabs; same comments as CtrlAITube |
| `/ctrlaitube`         | CtrlAITube      | Community video feed                         |
| `/ctrlaitube/[id]`    | Video detail    | CTRL+AI comments + separate YouTube section  |
| `/usage`              | Usage           | The one 동아리 지원 wallet, in KRW (개인 잔액 hidden while top-ups are off) |
| `/profile`            | Profile         | Quarter participation, application, accounts, 회원 탈퇴 |
| `/admin`              | Admin           | Section hub: work waiting, quarter figures, cards |
| `/admin/members`      | Members         | Search, filter, sort; row opens the member   |
| `/admin/members/[id]` | Member detail   | Participation history, wallet, audit trail   |
| `/admin/applications` | Applications    | Approve or reject, with stat cards and tabs  |
| `/admin/quarters`     | Quarters        | Quarter list with figures; create a quarter  |
| `/admin/topups`       | Top-ups         | Confirm personal top-up deposits — **hidden** while `PERSONAL_TOPUP_ENABLED` is false (`personal-topup-off`, 2026-10-14) |
| `/admin/budget`       | Budget          | Stat cards on top; the rest (month bar, 지급 vs 사용, 크레딧, 제공자별, 모델×깊이, 회원별, 캐시, 대조) as sections opened one at a time, each row summarising its figures (`ui-improvements` B) |
| `/admin/video-models` | Video Models    | Which models members may pick                |
| `/admin/ai-models`    | AI Models       | A summary strip, then one section per provider opened one at a time (all open while searching) and 비용 보정 last; prices, who may pick them, the default (`/admin/claude-models` redirects) |
| `/admin/deleted`      | Deleted Items   | Restore a project or video a member deleted, or remove it for good (reason, audited); whatever is still here at 분기 마감 and was deleted by that quarter's last day is purged |
| `/admin/audit`        | Audit Log       | Every admin change, read-only                |
| `/admin/system`       | System          | A health strip on top (서버 · DB · each provider, green/red/grey), then collapsed sections: 서버 상세, 기능 열기, 외부 서비스, 환율, 채팅 한도 (with the depth table), read-only 서버 설정 (.env), 빌더 점검 — the default model lives in AI Models |

`/admin/content` exists in the code but is hidden from the navigation until
Phases 5/8 fill it — a menu item that always leads to an empty screen is in
the way. Turning it on is deleting its `hidden: true` in
`frontend/app/admin/sections.ts`. (`/admin/budget` was turned on by
`single-wallet`.)

The App Store route is still `/ctrlaistore` although the screen is now called
**CtrlAIApps**; the path was kept so existing links do not break.

## Name

The community is **CTRL+AI** — that is what members see in the sidebar, on
the Chat welcome and in the page title. The repository, the database and
the code keep their existing `ctrl-ai` / `ctrlai` spellings: renaming them
would break remotes and connection strings for a change nobody can see.

Product names (Chat, Project Builder, Video Generator, CtrlAIApps,
CtrlAITube, Usage, Profile, Admin) are unchanged, as are all
routes.

Backend endpoints: `GET /api/health`, `GET /api/users`, and `GET /docs` for the
generated API documentation.

## The two creation workspaces

Project Builder and Video Generator are sibling workspaces. Both use the full
viewport with a compact top bar, side tools, a persistent Claude panel, and a
preview — closer to a desktop application than a web page. They share their
frame in `frontend/app/components/workspace.module.css`.

**Project Builder — 예시 앱** (chat-builder-starter). From Chat's
**Project Builder에서 예시 앱 만들기** button (or 예시 앱 만들기 in an empty
project) Claude writes a small static app — `index.html`, `style.css`,
`app.js` — as structured JSON; the backend checks every path and size
(HTML/CSS/JS/JSON/SVG/MD/TXT only, ≤ 10 files, 100 KB each, 300 KB in all,
no `..` or hidden files), charges the wallet (feature `build`, estimate and
worst case shown first) and stores the files in the same transaction. A
failed or cut-off generation is free. The preview runs `index.html` with
its CSS and JS inlined in an `<iframe srcdoc sandbox="allow-scripts">`
behind a CSP that blocks all network — never on the backend. Files are
read-only in the editor; Claude changes them (below).

**Project Builder — 만들기 / 고치기 in stages** (quality-tuning Q2,
2026-10-15). An empty project opens a short **start form** — 만들고 싶은 앱
(pre-filled from the Chat idea / project description), 누가 쓰나요, 꼭 필요한
기능 3가지, 원하는 분위기 — which can be skipped (질문 건너뛰기). **만들 계획
세우기** is one small charged call: Claude lists the files and what each is
for; the member sees **만들 계획** and presses **시작 · 약 N원 (호출마다 최대
M원)**. Each file is then written by its own call (progress: "index.html
작성 중… ✓ style.css ✓ …") and **saved the moment it is done**; a last
**점검** call fixes broken references / ids / obvious JS errors (≤ 3 files).
A call that fails or times out stops the run with a Korean reason; the
files already written stay, and **이어서 만들기** writes the rest (or 처음부터
다시). 고치기 uses the same stages (plan of the changed files only, started
at once). Every call is charged its real usage; a failed call is free; each
call has its own timeout (`BUILDER_TIMEOUT_SECONDS`, 300 s) and the stream
keeps the proxies open with keepalives. The model and 생각 깊이 are the
project's (the shared picker). The prompts ask for "as complete as the idea
needs: usually 300–1,200 lines across the files; every button works; no
placeholders". The one-shot 예시 앱 / `generate` routes remain in the API.
**빌더 점검:** the owner runs `python -m app.tools.builder_eval --ideas 5
--max-krw 3000` on the server (real provider, admin wallet, never past the
limit); the Markdown report shows in Admin › System › 빌더 점검.

**Project Builder — pictures** (builder-images, 2026-10-17; owner:
"빌더에는 사진 추가 못하나..? 이런 디자인 참고 등으로" and "앱에 넣는 사진(로고
등)"). Two kinds, both checked from their bytes and re-encoded without
metadata (phone photos carry GPS):
- **참고 사진** — up to 3 pictures attached to the next 만들기 / 고치기, by
  the **참고 사진** button under the request box, by pasting (Ctrl+V) or by
  dropping them on it; they show as small thumbnails with ✕. The next plan
  takes them for its run: the plan call and every file call **see** them
  (vision input) and follow their look; the self-check does not. They are
  never files of the app. Each picture (stored at a 1,024 px long edge,
  about 1,400 tokens) is in the request's estimate and in each call's
  charge; uploading is free; a failed call charges 0 as always and the
  pictures stay waiting.
- **앱에 넣은 사진** — up to 10 pictures (1 MB each after re-encoding at a
  1,600 px long edge, 5 MB together), added from the file sidebar's **사진
  넣기**. Each lives at `images/<name>` (a safe name; `-2` when taken),
  is written into the app's folder beside its files — the preview is
  rewritten at once, 게시 carries them, the ZIP packs them, server
  thumbnails show them — and every staged Claude call is told their paths
  and sizes, so "로고를 머리에 넣어 줘" works. 경로 복사 copies the path.
  They belong to the project, not to a version (되돌리기 brings back files,
  not pictures). Free.

**Project Builder — 만들기 / 고치기** (builder-static-runtime). In the
workspace's Claude panel the member writes what to make or change ("버튼
색을 바꿔 줘") and presses **만들기** (empty project) or **고치기**; the
estimate and worst case (≈ 230원 on Sonnet, the whole 16,000-token output
budget) show first, with the wallet check. Claude writes whole files
through one `write_file` tool; the backend checks every write — static
text only (HTML/CSS/JS/JSON/SVG/MD/TXT), ≤ 200 KB a file, ≤ 30 files,
≤ 2 MB a project, clean paths at most three deep — and **refuses server or
build code** (`.py`, `.php`, `.sh`, `.ts` …): the member is not charged,
the club's cost is recorded. **Versions are saved snapshots**
(builder-snapshots, 2026-10-17): v1, v2, … are made when the member presses
**버전 저장** (optional name), by **게시** (the working copy is saved first
when it changed) and when a project starts — not by each change; the newest
30 are kept (pinned and the published one excepted) and numbers only grow.
Between snapshots each 만들기 / 고치기 is a **작업 단계**: the last 20 give
**실행 취소 / 다시 실행** (free; Claude's edit itself is charged as always)
and are not numbered versions. **불러오기** of an old version changes the
working copy only (no new version; saving afterwards is simply the next
number); with unsaved work Builder first asks "저장 안 한 작업이 있어요.
저장할까요?" (저장 / 저장 안 함 / 취소), and leaving the Builder asks "이 버전을
저장할까요?". Saving files identical to the version they stand on says
"이미 같아요".

**The apps origin** (builder-static-runtime; since app-platform P1 the
"CTRL+AI 기능 상자"). After each change the backend writes the project's
files to the apps volume (a random slug; **미리보기 갱신** writes them
again by hand). `apps.ctrlai.my/<app-slug>/` is CTRL+AI's own **shell**
page; the app runs inside it in a frame with an opaque origin, from
`/<app-slug>/_app/` (sandboxed even when opened on its own, no network,
no cookies). The shell's tab shows the app's own cover as its icon — its
colour from the slug and its first letter or digit, the same cover as
the CtrlAIApps card, drawn by the shell as an SVG data URL, so every app
has one without the member doing anything (app-tab-icon, 2026-10-17;
Chrome, Edge and Firefox — Safari ignores SVG tab icons and keeps its
default, a PNG fallback is a later item if wanted). The
Builder preview and CtrlAIApps frame the shell; 새 창에서 열기 opens it
on its own. A deleted project stops being served at once.
An app keeps data with **`ctrlai.storage`** (and its old `localStorage`
keeps working): per app, per visitor, about 1 MB, signed out too — one
app can no longer read another's. **Since P2** an app can ask a visitor
to sign in with CTRL+AI (a consent window on ctrlai.my: the app, its maker,
"이 앱이 할 수 있는 일", "1회 약 N원 (최대 200원)", [허용] [거절]) and then
use **`ctrlai.ai`** — Claude, paid by the **visitor** from their own 동아리
지원, at most 200원 a call and 2,000원 a day across apps (an admin setting),
only for members taking part this quarter. The app sees a display name and
a per-app id, never the email, username or balance. Profile › 연결된 앱
disconnects; Usage lists each call as "앱 · <앱 이름>"; Admin › Apps can
stop an app's 기능 상자. **Since P3** an app has a database of its own,
**`ctrlai.db`**: named lists that are either 개인 (each signed-in visitor
sees only their own — a diary, a score history) or 공유 (everyone reads,
signed out too; members write, with their display name on each item — a
board, a poll, a ranking). The app says which with every call
(`shared: true`; otherwise the 개인 list of that name) — the same name is
two separate lists, so no visitor can turn another's private data public. An item is at most 4 KB, an app holds 2,000
items / 5 MB, a visitor writes 30 times a minute at most; the author can
change or delete their item, the app's maker can delete any shared item,
and 신고 of a shared item reaches Admin › Content, where the admin hides
or deletes it (audited; the app's own data is also under Admin › Apps). The Builder's 미리보기 has data of its own, so
trying an app never changes the live app's. **Since P4a** the lists an
app uses are the maker's to declare, in the project's `ctrlai.json`
(a visitor cannot make one); the Builder's Claude knows the whole 기능
상자 and writes that file itself; the new-project form offers four
**templates** beside 빈 프로젝트 — AI 챗봇, 투표·설문, 랭킹 게임, 동아리
게시판 — copied for free into a new project and opened in the preview at
once, each with a demo path for signed-out visitors and a 로그인 button;
and in the **미리보기** the maker uses their own app as a visitor, paid
from their own 지원금 ("미리보기 사용 · N원", Usage: "앱 미리보기 · <이름>").
**Since P4b** an app can price a call before it is made
(`ctrlai.ai.estimate` — "1회 약 N원 · 최대 M원" beside the button; a call
with the same options never costs more than that figure, the server's
JSON retry included); the three **showcase apps** run on 실제 AI when the
visitor is signed in, with a toggle back to 데모 and nothing charged until
a button is pressed; **Admin › Apps** lists every app that uses the 기능
상자 (published or not) with its AI use — visitors' today and this
quarter, the maker's 미리보기 apart — consents, data, reports, and holds
기능 상자 멈추기, 공유 데이터 and 게시 내리기, while Admin › Content keeps
the 신고 queue; and **/help/apps** explains all of it to members in
Korean, with code to copy. A template project starts with an empty
description and a 고치기 request never becomes one. **Since
app-ai-access** (owner, 2026-10-16) the maker of an app that uses AI
chooses at 게시 — "이 앱은 AI를 써요 — 다른 회원에게 AI 기능을 열까요?" —
**데모만** (the default) or **전체 기능**, and can change it later from the
Builder's 게시 menu; every visitor has a 데모 switch in a thin CTRL+AI
bar above the app (실제 AI 켜기 / 데모로 보기, remembered per app in their
browser; a bar rather than a floating pill, so it never covers the app's
own buttons or a phone's tab bar); the 관리자 keeps 기능 상자 멈추기. 데모 means no AI call and
0원 — the server refuses the visitor's call and the app shows its demo
answer; the maker's own 미리보기 always runs the real thing. CtrlAIApps'
detail page says which an app is; Admin › Apps shows it beside the app.
With the runtime off (local development without `dev_apps_server`), the
preview runs the files inside the page as before.

**프로젝트 내려받기** (project-export-handoff, 2026-10-15) — the Builder
header's 내려받기 button and ▾ menu item, and each library card's ⋯ menu
(프로젝트 내려받기 (ZIP), the draft). The member picks 작업 중 or 게시된
버전 and gets `<slug>-v<N>.zip`: the project's files plus `README.md`,
`CLAUDE.md`, `HANDOFF_PROMPT.md` and `HISTORY.md` written from the project's
own name, description, files and version notes (`services/project_handoff.py`),
and `SPEC.md` when the project has one. A project's own file of the same name
wins — the showcase apps ship hand-written guides that way. Never a `.env`, a
key, `node_modules`, `.git`, the owner's name, usage or cost, or anyone
else's data. **내 Claude로 이어서 만들기** is a guided sheet with a claude.ai
tab (① ZIP ② attach ③ paste the prompt, with "무엇을 더 하고 싶나요?" filled
into its blank live) and a Claude Code tab (`claude`, a first sentence to
copy). Admin › Content › ZIP 미리보기 shows an example app's ZIP file by
file. Downloading stays open to a member who is not participating this
quarter: their work is theirs.

**다운로드** works on any finished version, and keeps working for a member who
is not participating this quarter. Generated files are kept by CTRL+AI through
a storage interface (`backend/app/services/storage.py`) — a local folder in
development, cloud storage in Phase 9 — and never served from a provider URL,
which can expire or need the provider's own credentials.

Higgsfield is still not connected (Phase 6). While `VIDEO_PROVIDER=mock`, a
generated version gets a small **animated GIF placeholder**, built in pure
Python with no encoder and no ffmpeg. It is named `.gif` because that is what
it is: writing a file with an `.mp4` name that no player opens would make the
download look finished while being broken. Phase 6 swaps in Higgsfield's MP4,
and nothing downstream changes — the provider states its own content type and
extension.

**Video Generator** is deliberately not a one-shot form. It models the loop a
real creator works in:

```text
아이디어 → 생성 → 미리보기 → 수정하거나 이어서 만들기 → 버전 비교
        → 최종본 선택 → YouTube에 게시
```

Every generation, edit (이 영상 수정하기) and extension (이어서 만들기) goes
through the video provider behind `VIDEO_PROVIDER` — **mock by default**, which
returns a placeholder clip; the `higgsfield` setting refuses rather than calling
anything, because the real adapter is not written yet. Each one is charged to
the member's one wallet at `seconds × the model's price per second for the
chosen resolution`, recorded as Higgsfield spend, and the same figure is shown
as the estimate next to the button, compared with what is left.

What a member can choose — lengths, ratios, resolutions, sound, whether edit and
extend exist — is the selected model's **catalogue entry**, edited in
Admin › Video Models. The seeded prices are placeholders and are marked 예시
there until an admin saves the model. Each version records how it was made
(생성 / 수정 / 이어서), its source version and its exact settings.

The Claude panel, **프롬프트 도움받기 (선택)**, starts collapsed. It only
rewrites prompt text, never generates video, and is charged to the member's
wallet by the token, exactly like a Chat reply (below), recorded as Claude
spend.

## Signing in (member-password-login)

Every member may sign in with **Google로 계속하기** or with **username and
password**, or keep both. `/login` shows the Google button with the
username/password form below it (the form alone where Google sign-in is
off); `/login/password` redirects there. Sign-up is with Google (then a
setup screen: username, name, invite code) or with username + email +
password + invite code. An invite code is required either way.

**Profile › 로그인 방법** lists both methods:

- **Google 계정** — 연결하기 (linked by Google's `sub`, never by email) or
  연결 끊기. Unlinking asks for the password and is refused while the
  password is not set.
- **아이디와 비밀번호** — 만들기 for a Google member (8 characters or more,
  typed twice), 바꾸기 (current password), 없애기 (current password;
  refused while Google is not linked, or while Google sign-in is switched
  off on the server).

Adding a way in — a first password, or linking Google — needs a sign-in
less than 10 minutes old (there is no password to ask for), so a browser
left open is not enough (where the browser is still signed in to Google
itself, signing in again is easy — the rule protects where Google's own
session has ended). Every change, linking Google included, signs out the
member's other browsers. The backend keeps one method at all times, with the account row
locked while it checks. Wrong current passwords — here and in withdrawal —
count towards the sign-in attempt limit. Sign-up compares emails without
case. Each change is in the audit log (비밀번호 로그인 추가,
비밀번호 변경, 비밀번호 로그인 삭제, Google 로그인 연결 해제). Withdrawal
asks for the password when there is one, the username otherwise.

## Chat

Chat is the opening screen and a real conversation with Claude, behind
`CLAUDE_PROVIDER` (mock by default; the screen says
**테스트 모드 – 실제 AI 결과가 아닙니다** while it is).

- **Conversations** are listed on the left (chat-list-collapse,
  2026-10-17: the list folds like the sidebar — a 목록 접기 button at its
  head turns it into a slim rail with 새 대화 and 목록 펼치기, the
  conversation takes the full width, and the choice is remembered per
  browser; on a narrow screen the 대화 목록 drawer is the list as before):
  새 대화, and each row's ⋯ menu
  with 이름 바꾸기 · 맨 위에 고정 / 고정 해제 · 지우기 (chat-pins,
  2026-10-17 — the two hover icons became the same ⋯ menu a Builder or
  Video card has). A pinned conversation wears a small pin and sits under
  a **고정됨** heading above 최근 대화, newest pin first (`pinned_at` on the
  conversation, `POST …/pin {on}`; a pin is the owner's reading
  preference — it works while not participating and moves no date). They
  are private to the member. Deleting is a real delete — a chat is not
  *work*, so it does not go to Deleted Items — but the money it spent
  stays in Usage.
- **Replies stream** in as Claude writes them, with a **중지** button. A
  stopped reply keeps its text and is charged for the tokens used so far.
- **Previews** (chat-plus-artifacts): a finished reply's fenced `html` or
  `svg` block becomes a **미리보기** card — 코드 보기, 다운로드, **전체 화면**
  (chat-preview-fullscreen, 2026-10-17: an in-page window over everything —
  dark backdrop, 닫기 / Esc / a click outside, 새로고침, 데스크톱 / 폰
  (390 px) width, a full-screen sheet on a phone; its own frame from the
  same srcdoc with the same `allow-scripts`-only sandbox and CSP, started
  only by the press and removed on close; no Fullscreen API),
  (`ctrlai-<conversation>-<reply>.html|svg`, built by the page, not the
  frame) and, for HTML, **Builder로 보내기** (a new project whose
  `index.html` is the block; free; participating members only). The
  preview runs only after **미리보기 열기**, in an `<iframe srcdoc>` with
  `sandbox="allow-scripts"` and nothing else — an opaque origin with no
  access to CTRL+AI's cookies, storage or `/api` — and the srcdoc starts
  with a CSP that allows no network; SVG is never put into the page
  itself. A label over the frame says not to type passwords there. Blocks
  over 200 KB show code only; a block cut off by the reply's length says
  "계속"이라고 보내 주세요. Claude is told to write one self-contained
  block (inline CSS/JS, inline SVG charts, no external files).
  `CHAT_MAX_OUTPUT_TOKENS` stays 4,096 — raising it to 8,192 for longer
  pages is the owner's decision (it roughly doubles the worst-case
  pre-check).
- **Files** (chat-plus-files): 📎 or drag-and-drop attaches up to 5 files
  to a message — JPEG/PNG/WebP/GIF (10 MB; re-encoded to a 1,568 px long
  edge with EXIF/GPS removed), PDF (10 MB, 30 pages, not encrypted), CSV
  and TXT/MD (1 MB; UTF-8, else CP949). The type is judged by the bytes,
  never the extension; anything over a limit is refused in Korean, never
  truncated. Before sending, the composer shows "첨부 포함 답장 1회 약
  N원" and "이 대화에서 이어지는 답장마다 약 M원씩 더 듭니다" (files are
  resent with each reply; caching keeps that cheap) and says files go to
  Anthropic and stay until the conversation is deleted. Sent messages show
  image thumbnails and download chips for the rest; a member who is not
  participating can still download their own files. 200 MB per member,
  5 GB per server (Admin › Dashboard › System shows the figure). Deleting
  the conversation — or anonymising a withdrawn member — deletes the
  bytes. Sent to Claude as base64 `image` / `document` blocks, never as
  Files API ids (workspace-wide).
- **Replies render Markdown** (chat-plus-rendering): headings, lists, bold,
  links, tables and code blocks, through `react-markdown` + `remark-gfm`
  (`ChatMarkdown`). No raw HTML — a tag in a reply shows as text; links
  keep only `http(s)` and `mailto` and open in a new tab; images are not
  loaded (their description shows). Wide tables scroll inside their own
  box. Code blocks show the language and a **복사** button. While a reply
  streams, an open code fence is drawn as code and a table waits for its
  divider row, so no raw backticks or pipes flash. The member's own
  messages stay plain text.
- **기능 둘러보기.** The welcome screen shows four example prompts — 표
  만들기, 파일 요약, 차트 그리기, 웹페이지 만들기 — listed in
  `lib/chat-examples.ts`. A card only fills the composer; the member sees
  the model and its estimate, then sends. The other screens are reached
  from the sidebar and the reply action buttons.
- **Action buttons.** When a message is about building an app or making a
  video, the reply ends with **Project Builder에서 예시 앱 만들기** or **Video Generator
  열기**. The button opens that library with the new-project form already
  filled: the member's message becomes the description (Builder) or the
  prompt (Video). Claude chooses the button with a hidden marker the server
  removes; there is no agent routing.
- **Money.** Before Claude is called, the member's wallet is checked against the
  worst case (the history sent plus the longest reply). Afterwards the tokens
  actually used are charged: uncached input × input price + cache writes ×
  1.25 × input price + cache reads × the cache-read price + output × output
  price in dollars, × the won-per-dollar rate, rounded up to whole won. Each charge
  records the model, both token counts, the dollar cost and the rate. Prices
  are edited with the models in Admin › AI Models, the rate in Admin ›
  System; both are audited.
- **Live cost and the receipt** (live-cost-display). While a reply
  streams, 약 N원 ticks up beside it (an estimate, updated a few times a
  second). When it ends, the bubble shows the **ledger's** receipt — 입력 /
  출력 / 캐시 읽기 (/ 검색 N회 M원) / 합계 — and the sidebar wallet updates
  without a reload. A stopped or cap-stopped reply settles the same way; a
  server-reported failure says 청구되지 않았어요 (and only that case — a
  dropped connection still charges for what streamed, like 중지).
- **Model + 생각 깊이** (quality-tuning Q1). One picker — Chat's composer
  and welcome screen, the Builder's Claude panel, Profile › 기본 모델 — shows
  "<모델> · <깊이>"; its popover (a bottom sheet at 390 px) lists the models
  with a one-line description and "1회 약 N원", and a 생각 깊이 slider
  낮음 · 보통 · 높음 (· 최고 where the API has `max`) with a hint and "1회 약
  N원 (최대 M원)". A model without `effort` (Haiku 4.5) shows "이 모델은 깊이
  조절이 없어요" and is never sent one. The client sends only the model id
  and the level **name**; the server maps it, separately for chat and the
  Builder, to effort + `max_tokens` + a per-call cap (defaults: chat 낮음
  low/4,096/200원, 보통 medium/8,192/200원, 높음 high/16,000/400원, 최고
  max/32,000/800원; builder 16,000/500원 at 낮음·보통, 32,000/900원 높음,
  32,000/1,200원 최고 — Admin › System › 채팅 한도, audited). Remembered per
  conversation, per project, and as the member's default. Sonnet 5.5 at
  최고 thinks adaptively (the picker says so). Admin › Budget shows Claude
  usage by model × feature × depth.
- **The per-call cap and the daily cap** (token-guard). Admin › System ›
  **채팅 한도** sets each depth's per-call cost cap, the chat history sent
  with each reply (대화 기억, default 64,000 tokens), the reply timeout
  (응답 대기, 180 s), a long-conversation warning threshold and an
  optional daily cap per member (0 = off), all audited. The cap is
  enforced **before** the call: it buys a `max_tokens` budget after the
  estimated input cost. **Since `feat-auto-continue` (owner-polish 11,
  2026-10-16) a capped chat reply does not stop there:** the server
  continues it by itself, in the same bubble — the partial goes back as
  the assistant's turn with a "[이어서] 끊긴 바로 다음 글자부터" request,
  each call under the same per-call cap, each charged on its own with the
  wallet checked first — until the reply ends, the member presses 중지,
  the whole reply reaches that depth's **전체 한도** (Admin › System › 채팅
  한도, default 낮음 600 · 보통 1,500 · 높음 3,000 · 최고 6,000원; 0 = one
  call only), eight calls have been made, or the wallet runs short. While it continues the screen says
  "이어서 쓰는 중… (n번째) · 지금까지 N원" and 중지 stays; the pieces are
  saved as one message whose receipt adds the calls up ("3번에 나눠 씀"),
  so a code block split across calls previews as one page. A reply the
  server stopped says why (전체 한도 or the wallet) and still offers
  **이어서 쓰기** (a new, priced reply; the price shows on the button). If
  the input alone reaches the cap, the message is refused free with a 새
  대화 / 생각 깊이를 높여 suggestion. The daily cap counts every paid feature
  per KST day and refuses before anything is spent. Builder calls do not
  continue: they write whole files per stage under their own caps.
- **Tools in Chat** (chat-plus-tools — **mock only** until Phase 9: no
  real API call, no real fee). 웹 검색, 웹 페이지 읽기 and 코드 실행 as
  Anthropic server tools. An admin opens each tool per model in Admin ›
  AI Models; the member switches it on per conversation next to the model
  picker, and sees the cost first (search ≈ 14원 each plus result tokens).
  Both switches must be on or the tool is not sent. Each enabled tool's
  worst case — its fee plus its result tokens — is reserved **inside** the
  per-reply cap; a tool the cap cannot cover is refused in Korean, naming
  it. 검색 중… / 페이지 읽는 중… / 코드 실행 중… shows while a tool runs;
  sources appear as numbered domain links (http/https only); code runs
  only on Anthropic's side, never ours.
- **생각 과정 보기** (chat-thinking-view). A per-conversation switch next
  to the model picker, off by default; the chip says what it adds before
  it is switched on — 답장마다 +약 N원 on Sonnet 5.5 (≈ 300 thinking
  tokens to start) and Haiku 4.5 (its 1,024-token budget), **추가 비용
  없음** on Opus 5.5, which thinks anyway. Turning it on (when it costs
  more) asks first; it is a write, so a member not participating cannot.
  Once each kind has 10 replies the figure comes from the ledger (median
  with − median without). Requests: Sonnet/Opus `thinking: {type:
  "adaptive", display: "summarized"}` at the same low effort; Haiku
  `{type: "enabled", budget_tokens: 1024}` when the per-reply cap leaves
  room (otherwise no thinking). The summary streams as 생각하는 중…, then
  sits collapsed under the reply as **생각 과정 (N단계) · 영어로 표시될 수
  있어요**, expanding to numbered plain-text steps (one per paragraph);
  an empty summary shows nothing. Thinking is billed as output (the
  receipt says 출력(생각 포함)); the usage event carries `thinking_shown`
  and calibration keeps those replies out of the ordinary 답장 1회 약 N원.
  The summary is stored for display only — history is sent back as text,
  never thinking blocks (preserved-thinking rules). Whether a model writes
  the summary in Korean is unverified until the real API is switched on,
  so the English note always shows.
- **One club key, guarded** (audit-caching-and-distribution). Every call
  uses the club's one Anthropic key through the backend; a member's limit
  is their wallet. Five guards keep one member from draining the club:
  the per-minute message limit, the per-reply cap, the daily cap, the
  wallet pre-check and a **global concurrency limit** on outgoing provider
  calls (Admin › System, audited; over it the member sees "지금 요청이
  많아요" and nothing is charged). Out of credit shows Korean, charges
  nothing and raises a named alert on the Admin dashboard;
  `ANTHROPIC_MONTHLY_BUDGET_USD` draws a month bar in Admin › Budget with
  an 80% warning. Details: [`api-distribution.md`](api-distribution.md).
- **Prompt caching** (prompt-caching). Every request marks the system
  prompt and the conversation so far as cacheable, so each reply re-reads
  the earlier turns at a fraction of the input price (Sonnet 5.5 and
  Opus 5.5 a twentieth, Haiku 4.5 a tenth — the catalogue's cache-read
  column). Long conversations are trimmed in steps — half the history
  limit at a time — so the cached start of the conversation stays the same
  for many turns; a test pins that two consecutive turns send a
  byte-identical prefix. The check before a call still prices the whole
  input as a cache write, the dearest case. Haiku 4.5 only caches once the
  prefix passes 4,096 tokens (Anthropic's minimum), so short Haiku
  conversations run uncached — documented, accepted. Admin › Budget shows
  the cache share per provider, and Admin › AI Models › 비용 보정 › 캐시
  절약 shows hits and won saved per model and day;
  `CHAT_PROMPT_CACHE` / `CHAT_CACHE_TTL` switch it.
- **Cost calibration** (cost-calibration). Each Chat usage event keeps
  the input estimate made before the call. Once a model has 10 real
  replies, "답장 1회 약 N원" becomes the median of its recent replies
  (labelled 최근 실제 기준) and the pre-check prices input at the observed
  ratio × 1.2 — never above one token per character, output still the full
  maximum. Admin › AI Models › 비용 보정 shows estimate vs reality per
  model.
- **Choosing a model** (chat-model-choice). Next to the composer, per
  conversation: each model shows its Korean label, a one-line description
  and "답장 1회 약 N원" (3,000 input + 800 output tokens). A new conversation
  starts on the default (Sonnet 5.5); changing the model affects later
  replies only, and each reply shows the model that wrote it. Members see
  Haiku 4.5 and Sonnet 5.5; Opus 5.5 is admin-only until an admin opens it.
  A model a member may not use is refused with a Korean 400. The video
  prompt helper always uses the default.
- **A failed call is never charged.** Errors are shown in Korean: invalid
  key, out of credit, Claude's rate limit, timeouts, network failures.
- **Limits.** 10 messages per member per minute; up to 4,096 output tokens
  per reply; up to about 16,000 tokens of history, oldest dropped first.
- **Who may use it.** Sending, starting, renaming and deleting need
  participation this quarter. Reading past conversations does not.

## Language

The interface is **Korean-first, with an English menu**.

**The navigation is English throughout** — the group headings (Create,
Explore, Manage, Account — in that order; Manage only for admins, holding
the expanding Admin item, with a 관리자 badge beside the admin's name at
the bottom; owner decision 2026-10-14), the item names (Chat, Project Builder, Video Generator,
CtrlAIApps, CtrlAITube, Usage, Profile, Admin) and the Admin section
names (Dashboard, Members, Applications, Quarters, Budget, Video
Models, AI Models, Feedback, Deleted Items, Audit Log, System; Top-ups is
hidden while personal top-ups are off — `personal-topup-off`). Feedback
has no menu item for members: the 의견 보내기 button in the sidebar footer
is the one way to send a note (admin-and-nav-cleanup, 2026-10-14). A screen's own heading matches its
menu name, so the two never disagree.

**의견 보내기 with screenshots** (feedback-screenshots, 2026-10-16 — the
owner: "no board, only 관리자 can see it, and be able to put in
screenshots"). The dialog takes up to **3 pictures** (PNG, JPG, WebP, each
5 MB or less) three ways: 스크린샷 붙이기 (the file picker; on a phone the
photo library), dragging onto the dialog, and pasting (⌘V — a Mac
screenshot taken to the clipboard). Each shows as a thumbnail with ✕. One
line stays under them: "화면에 개인정보가 보이면 가린 뒤 올려 주세요."
The server treats a picture exactly like a Chat attachment — kind read
from the bytes, re-encoded (EXIF and location gone), stored on disk, a
limit refused in Korean with nothing stored. **Only an admin ever sees a
picture**: Admin › Feedback shows thumbnails that open large; the member
who sent it has no route back to it, and another member gets 403.
Closing the dialog without sending removes what was uploaded. An admin's
지우기 removes the note and its pictures together, audited (의견 삭제);
withdrawal anonymisation removes a former member's pictures and keeps the
(now anonymous) notes. Profile photos are **not** part of this — letter
avatars stay (owner, 2026-10-16: "letters okay for now").

External service names (Claude, Higgsfield, GitHub, YouTube) and technical
terms such as file names, code and repository names stay English as well.

**Everything else is Korean** — prompts, conversations, helper text,
explanations, buttons, comments, error messages. Members never need to write
English prompts. Where Korean body text points at a screen it uses that
screen's English name, the way "Usage 화면" already reads.

Three details matter for Korean text and are already handled:

- `word-break: keep-all`, so Korean words are not split across lines
- a Hangul-first font stack, so Korean never falls back to a substituted glyph
- IME composition is checked before Enter sends a message, so a half-formed
  syllable is never submitted

All user-facing Korean strings live either in `frontend/lib/mock-data.ts` or
directly in the page that shows them.

## Design

**Two themes — dark (default) and light** (ui-polish, 2026-10-07). The
choice lives in `localStorage` (`ctrlai-theme`), is applied before paint
by an inline head script, and toggles from the ☀/☾ button in the sidebar
footer. Every colour is a token in `frontend/app/globals.css`; no
component hard-codes one, which is what makes the second theme a token
swap rather than a redesign. Type is self-hosted Pretendard Variable.
Under `prefers-reduced-motion` nothing moves (ui-friendly-motion).

**Running state (running-state-calm, 2026-10-17, as the approved
mock-ups).** One calm "running" look for Chat and the Builder: the Chat
composer keeps its own dark surface (the motion-modern ring is gone) with
a 2px bar sweeping along its bottom, the stop button is a small outlined
square and the line under it says "중지하면 지금까지 쓴 만큼만 차감돼요";
the Builder's 만드는 중… is an outlined violet button with a spinner. The
same signal shows in four places: a sweeping bar on the card or header, a
pulsing dot on Chat / Project Builder in the sidebar and on the
conversation row, a **작업 중** chip in the Chat top bar, the Builder header
(with the elapsed time) and the project's card in the Builder list — it
survives moving between screens (and a reload, for 30 minutes at most).
Progress is shown, not implied, and only from real events: the Chat card
names 뼈대 → 스타일 → 동작 by what has arrived, with "12초 · 지금까지 약
56원" and a flowchart skeleton that draws itself in; the Builder's preview
pane shows the stage in large words and the elapsed time larger
(요구사항 읽기 → 파일 쓰기 → 미리보기 조립 — the plan call, each file's
start and finish, the check), file chips 쓰는 중 → 완료 and the real end of
the last file written; where there is no event, only the sweep and the
time — never a percentage. The Claude panel mirrors it: the current
action with a three-dot pulse and the last four events, and the input
says "작업이 끝나면 이어서 말해요". The aurora is now a very faint glow
inside the 그림 card and the 미리보기 pane only, with a Profile switch
**오로라 배경** (per device, on by default). Under 움직임 줄이기 the sweeps
stand still, the dots stop, the skeleton is drawn, the glow is off.

**Motion (motion-modern, 2026-10-16).** The owner asked for "더 현대적인
느낌" and for the middle of a generation to be skipped: (1) while a Chat
reply writes a preview's code, or the Builder writes files, the member
sees an **aurora card** — "미리보기 만드는 중…" (그림 만드는 중… for an
SVG) over a slow drifting gradient with the seconds, the running cost
("지금까지 약 N원") and two or three step chips (뼈대 → 스타일 → 동작,
read from what has arrived; in the Builder the first three planned
files), and when the reply is done the aurora unblurs into the preview;
the code stays under 코드 보기 as before. (2) Thinking is a calm stream:
"생각하는 중…" shimmers with its seconds, a slowly turning colour ring
runs around the composer while a reply is busy, words fade and unblur in,
and the caret glows instead of blinking. (3) The Builder's steps fold
while it works: only the current step is big ("index.html 작성 중… N초"),
finished steps fold into "✓ N개 완료" (a button that unfolds them), the
rest are dots with "남은 파일 N개", and the progress bar stays. (4) The
띠링 moment is **별가루**: small pale-gold and white stars flow from the
toast to the wallet and twinkle there, the number rolls down and the
toast pops (the sound stays the Profile switch). (5) 게시 완료 is **쭈욱
→ 팡!**: three thin lines shoot up and burst into rays with a white
flash, confetti falls from the centre and the letters of "게시 완료!"
pop one by one, in white, warm gold and a touch of lavender; it leaves
by itself after about two seconds and nothing can be clicked on it.
No dino. Under 동작 줄이기 every one of these keeps its text and loses
its motion (the aurora is a still card, the stars and confetti do not
appear), and nothing ever waits on an animation. CSS, motion/react and
the Web Animations API only.

Shared classes (`.card`, `.btn`, `.badge`, `.field`, `.meter`, `.table`) also
live in `globals.css`. Anything used by one screen only lives in that screen's
CSS module.

## Quarters, applications and money

**CTRL+AI operates by calendar quarter** — 2026 Q1, 2026 Q2, and so on.
A quarter is three months. (The earlier four-month "Season" concept is gone;
nothing in the product uses it.)

### Credits are not automatic

```text
Admin opens applications for a quarter
  -> member sees applications are open in Profile
  -> member presses 이번 분기 참여 — one amount, the quarter's
  -> admin approves
  -> the member's 동아리 지원 wallet for the quarter exists
```

### One wallet per member per quarter

Decided by the owner on 2026-10-08 (`single-wallet`). Each participating
member has **one** 동아리 지원 wallet per quarter — **80,000원 by default** —
and Chat, video generation, edit and extension, the prompt helper and every
later paid feature spend from that one balance. There is no Build/Video
split, no percentage and no preset; the application has nothing to choose.

The amount is not a constant scattered through the code. The default lives
in `quarterly_subsidy_limit_krw` (backend settings); each quarter copies it
at creation into `subsidy_limit_krw` and keeps its own, edited in Admin ›
Quarters as **1인 지원금** and audited. Approving an application copies the
quarter's amount into the wallet, so changing a quarter's amount later never
moves a wallet that already exists; an admin adjusts one member's wallet in
Members › member detail — **+/− with a required reason, recorded as an
adjustment row, never an overwrite** (cost-clarity), and refused below what
is already spent.

**분기 마감** (Admin › Quarters, cost-clarity): freezes every wallet of the
quarter (nothing is charged to it again), records each member's unspent
money as **회수**, and — at the carry-over % the admin chooses (default 0) —
adds that share to the member's next approved wallet, once. No wallet or
usage row is deleted; a closed quarter does not reopen. The close also
**purges everything still in Deleted Items that was deleted by the
quarter's last day** (`ui-improvements` B, owner 2026-10-16; a quarter
closed late leaves this week's deletions for their own quarter) — the
dialog says how many — and usage events of purged work keep the work's
name (`(삭제됨)` in Usage). **신청 마감** is different: it
stops new applications and makes the quarter *active*; wallets keep
working, and it can be undone — Admin › Quarters › 신청 다시 열기… sets a
new deadline (today or later, inside the quarter) and reopens; 신청 기한
연장… moves the deadline of an open window later. Both are audited.

What the money went on is information, not a limit: Usage shows the wallet
("이번 분기 지원금 80,000원 중 52,300원 남음") and a 채팅 / 빌더 / 영상 /
기타 breakdown.

**Where the money went** (cost-clarity, 2026-10-14). Every reply's receipt
shows 입력 / 캐시 쓰기 / 캐시 읽기 / 출력 / 도구 / 합계 in won, plus
"캐시로 아낀 금액 약 N원" and an ⓘ with two plain sentences about caching
(`frontend/lib/money.ts` › `CACHE_EXPLAINER`). The parts are unrounded; the
total is their sum rounded up once per reply. Usage repeats the same split
per conversation and per KST day, with this quarter's total saving. Admin ›
Budget adds the club side: credit bought per provider (append-only purchase
records), used (ledger), estimated remaining ("Anthropic 콘솔이 최종 기준"),
지급 vs 사용, a per-member table, a caching panel, CSV exports and an
optional reconciliation against Anthropic's cost report.

**The spend moment** (feat-spend-feedback, owner add-on B, 2026-10-14).
Whenever money leaves the wallet the member sees it happen, using only the
`charged_krw` the backend returned for that action (chat reply, Builder
generation, video, prompt help) — never an estimate; a failed or free call
shows nothing. The sidebar balance counts down (~0.6 s) with a floating
"-12원" and a brief pulse; a toast bottom-right (top on phones) says
"12원을 사용했어요! 남은 지원금 79,988원" with what it was for, merges
charges within 3 s ("3번 · 합계 36원"), disappears after 3 s and opens
Usage when clicked. Milestones — 첫 사용, 25 / 50 / 75 % used, 잔액
10,000원 이하 (a calm warning), 잔액 0 — appear **once per member per
quarter**, recorded server-side (`spend_milestones`); a charge that crosses
several shows only the highest. Profile › 알림 › **사용 알림 표시** turns it
off (default on); the device's reduced-motion setting drops the count-down
and the chip and keeps the toast. Nothing takes focus or blocks input;
screen readers hear one polite line per toast. Every usage event still records the **provider, feature, model
and native units** (tokens, seconds), so Admin › Budget can total each
quarter's spend **by provider** — the figure the club leader reads before
buying the next round of credit from Anthropic and from Higgsfield. The club
still buys per provider; members just do not have to guess the split.

**v2 — the "띠링" moment (owner-polish 10, 2026-10-16).** The toast springs
in with a coin that pops and sparks, the amount "-12원" is large, and when
the sidebar balance is on screen the "-12원" flies from the toast to the
balance (which then glows, as before). When the balance is not visible
(collapsed sidebar, phone, scrolled away) the toast itself carries the
amount and the remaining wallet, so the moment is seen anywhere. A short
two-tone **띠링** sound is a Profile › 알림 switch, **off by default and per
device** (localStorage — sound is a device matter, not an account one).
Still only on a real `charged_krw`; reduced motion keeps a plain toast,
no pop, no flight, no sound. **v3 (motion-modern, 2026-10-16):** the
flight is 별가루 — nine small stars instead of the "-12원" text, four
more twinkling at the balance — everything else about the moment is
unchanged.

Estimated costs next to paid buttons (Chat's "답장 1회 약 N원", video's
예상 비용) are compared with the one balance, and say so when it is short.

### KRW is the financial source of truth

Wallets are stored in won, never in tokens or generations. Provider prices
change, and an approved wallet must not move when they do. A
`pricing_snapshot` is captured at approval so a provider-specific quota can
still be displayed consistently afterwards.

`UsageEvent` keeps two separate figures: `provider_cost` (what the provider
charged, in their own units and currency) and `charged_krw` (what moved a
wallet). Conflating them would misreport both.

### Community money and personal money are separate

**The wallet is spent first.** A member who exhausts it stops there by
default; personal money is spent only if they have explicitly enabled it
*and* have enough for the whole charge — one charge is never split between
the two. Usage and Profile say this in one sentence. Topping up never raises
the 동아리 지원 wallet, and the two are never added together in the
interface. (Personal top-ups stay off in the beta — `prep-beta-launch`.)

Phase 1c uses a manual top-up workflow: the member requests an amount, an
admin confirms the deposit, and only then does the balance move. No payment
provider is involved.

### Participation status

A member who stops participating does not lose their published work:

| Status      | UI label   | Meaning                                                        |
| ----------- | ---------- | -------------------------------------------------------------- |
| `active`    | 활동 회원   | Participating this quarter; can use paid creation features      |
| `inactive`  | 비활동 회원 | Account exists, not enrolled this quarter; work is preserved    |
| `former`    | 탈퇴 회원   | Has left the community; published work keeps their attribution  |

"탈퇴 회원" is used rather than anything meaning "deleted", because
attribution on published apps and videos must continue to exist.

## List screens — one header row, pins, sort, thumbnails (ui-improvements, 2026-10-16)

The four list screens — Project Builder, Video Generator, CtrlAIApps,
CtrlAITube — share one header row (`ListToolbar`): the count on the
left ("내 프로젝트 6개", "게시된 앱 5개"), the search in the middle ending
at the card row's right edge, and the controls (status filter, 정렬,
the new-project button) on the right; below 44rem the three stack.

**Pins and sort.** A Builder or Video card's ⋯ menu has **맨 위에 고정**
/ **고정 해제**; a pinned card wears a small pin and always comes first
(`pinned_at` on the project, `POST …/pin {on}`). On CtrlAIApps a member's
own **★ 즐겨찾기** on a card does the same for that member only
(`app_favorites`, `POST /api/apps/{slug}/favorite`). Both are how a
member reads their own list, not a change to the work: they work while
not taking part this quarter, and neither a pin nor a thumbnail moves a
project's 마지막 수정 time. The **정렬** menu
offers 마지막 수정순 (default) and 이름순; the choice is remembered per
screen on the device (`localStorage`, not an account setting). Pinned or
favourite first, then the chosen order.

**Thumbnails (owner-polish 4·5).** An app's picture is a real screenshot
of the app, taken **in the maker's browser** — never by running member
code on the server (CLAUDE.md §8). In the Builder workspace, a moment
after the preview frame loads, the shell asks the app frame for a
picture (the SDK draws the page into a canvas and answers with a PNG),
the browser uploads the bytes, and the server checks the kind and size
from the bytes, re-encodes it to a 640×400 WebP with no metadata (like
의견 보내기 screenshots) and stores it as the project's **working-copy
thumbnail**; ⋯ › **썸네일 다시 찍기** retakes it by hand. **게시** does the
same once for the published version from its public address, in a hidden
frame, so CtrlAIApps shows the published look while the Builder card
shows the working copy. No picture yet (or a page the browser cannot
draw — WebGL, an app's own image files, Safari's weaker support) → a
plain coloured cover with the name (CtrlAIApps) or a code icon (Builder).
A Builder card shows a description only once the project is published;
a request typed in Chat or the Builder never becomes a card's text.

**Profile (owner-polish 2, 2026-10-16; owner-polish-3 (c2) took the list
away).** 알림 설정 is a card with the two aligned switch rows (사용 알림
표시, 띠링 소리) — the notification list itself lives only in the
sidebar's bell ("오른쪽 알림 필요 없음"); 내가 만든 앱 is a plain list —
name · vN · "N분 전 업데이트" · 열기 — with no pictures.

**Notifications (feat-notifications, owner-polish 2; cut down and moved by
owner-polish-3 (c)·(c2), 2026-10-16: "매번 쓸 때마다 알림 오면 너무 많잖아
… 걍 벨 누르면 숫자는 사라지고 clear 누르면 알림 없애기").** A bell in the
sidebar's **header**, beside the CTRL+AI name, carries the unread count;
pressing it opens a small panel under it with the latest notifications —
**and the number disappears as it opens** (everything is marked read).
A row leads where the thing happened; **지우기** deletes the rows shown,
and nothing is kept elsewhere: Profile has no list any more, only the
알림 설정 switches. Every row is **stored on the server and comes only
from something that really happened**, written by the code that did it —
never by the browser — and only four kinds exist: `'앱 이름' 게시 완료 —
v3` / 업데이트 게시 완료 (→ the app on CtrlAIApps); `2026 Q4 참여 신청이
승인됐어요` with the wallet amount (→ Usage), or 거절 with the admin's
note; **반응을 얻었어요** — a reaction or comment on the member's
CtrlAITube video, or a reply to their comment, **one row per item per KST
day** that counts up ("'내 영상'이(가) 10월 16일 반응 3개를 얻었어요 · 방금:
댓글" — a member counts once a day whatever they press, each comment
once; the club's own video has no maker to tell, and a ★ 즐겨찾기 on an
app stays the visitor's private preference); and 신고 처리 — an app taken
down by an admin with the reason, or a report on it closed with the app
kept. No spending notifications any more (the toast and Usage say what
was spent); older spend and milestone rows are hidden. Rows older than
90 days are removed the next time the member looks. The count is
refreshed on open, when the tab comes back and every minute; nothing
animates, so 동작 줄이기 has nothing to turn off.

**The sidebar's account area (owner-polish-3 (c2)).** The way common
sites split it: the bell up in the header next to the name (its panel
opens below, over nothing); the account row — avatar, name, 관리자 badge,
@username — is a button that opens a small menu upward: Profile, Usage,
밝은/어두운 화면으로, 처음 안내 다시 보기, 의견 보내기, 로그아웃; the line
under it keeps only 개인정보 · 약관. In the collapsed rail the avatar
alone opens the same menu and the bell keeps its badge; on a phone the
menu lives inside the slide-down navigation. Nothing overlaps at any
width.

## Search

Contextual search, not one global search engine. Each list has the search
its own screen needs:

| Screen | Search by | Filters |
| ------ | --------- | ------- |
| Project Builder | project name, description | status |
| Video Generator | project name, prompt | status |
| CtrlAIApps | app name, description, creator | category, sort |
| CtrlAITube | title, description, creator | creator, sort |
| Admin — Members | name, username | role, account status, membership status, sort |
| Admin — Applications | member name, username | status tabs + stat cards |
| Admin — Top-ups (hidden while top-ups are off) | member name, username | top-up status |
| Admin — Audit Log | summary, admin, action, target | action |
| Admin — Video Models | model name, provider, model id | — |
| Admin — AI Models | label, provider, model id | — |

Filtering currently happens in the browser, because the data is small and
each screen already holds its list. `SearchBar` only lifts the query out, so
moving to server-side search later changes the data call and not the screen.

## Leaving CTRL+AI (회원 탈퇴)

A member withdraws from the bottom of **Profile**, after re-entering their
password; an admin can do the same from **Admin › Members › (member)**.
Both go through one service, `backend/app/services/withdrawal.py`, so the
rules are the same either way:

- the account becomes `former` at once, every session ends, and signing in
  is refused;
- remaining 동아리 지원 in any quarter that is not closed is **released**
  and written to the audit log (there is no club reserve to return it to
  yet — `budget-by-provider` adds one);
- a remaining 개인 충전 balance, or a top-up request nobody has reviewed,
  marks the withdrawal **환불 대기**; an admin records the refund with
  **환불 완료 기록** (with personal top-ups off — `personal-topup-off` —
  nobody can acquire a new balance, so this shows only for money that
  already existed);
- published work stays up labelled 탈퇴 회원, or is unpublished if the
  member chose that;
- usage history is untouched, so quarter reports still add up.

For **30 days** an admin can **복구** the account, which puts back the
released budget, participation and anything unpublished. After that, a
job anonymises the username, email and display name:

```powershell
cd backend
.\.venv\Scripts\python.exe -m app.jobs.anonymise_withdrawn --dry-run   # report only
.\.venv\Scripts\python.exe -m app.jobs.anonymise_withdrawn
```

It is run from outside the server — by hand or from cron locally, by Cloud
Scheduler in Phase 9 — and is safe to run again. A withdrawal still
waiting for its refund is skipped and listed: an account is not finalised
while money is owed. The audit log is left as written; it is append-only.

## Direction — the product areas ahead

Moved here from `CLAUDE.md` sections 3–8 and 12 (docs-cleanup,
2026-10-14). Direction, not status: the backlog decides when each part is
built. The flows every area serves:

`Chat/Idea → Builder → Claude-assisted project → GitHub → Publish → CtrlAIApps`
`Chat/Idea → Video Generator → Claude assists prompt → Higgsfield generates → library → YouTube → CtrlAITube`

### Chat as the router

Chat is both a general Claude chat and a natural-language way into the
features — members must never need to know feature names. "가계부 앱
만들어 줘" offers Project Builder; "도쿄 밤거리 15초 쇼츠" offers Video
Generator; "크레딧 얼마 남았어?" shows the wallet; "지난 분기에 만든 앱"
routes to Profile. Simple explicit routing (the action markers Phase 2
built) stays enough — no complex agent router.

### Project Builder

Long-term: `prompt → project files → preview → edit → GitHub → publish`,
with a browser editor (file tree, tabs, preview, build output, Claude
panel — Monaco later). Claude works through a controlled backend coding
workflow, never a raw provider key in the browser. **Arbitrary member
code never runs on the main backend**; live execution needs the later
isolated runtime (builder-static-runtime and after). Per-member GitHub
arrives as a **GitHub App** with fine-grained repository permissions —
members are never asked for personal access tokens, and GitHub is
optional for using CTRL+AI.

### CtrlAIApps (route `/ctrlaistore`)

**AI 스위치 문구** (ai-switch-wording, 2026-10-17; owner: "실제 AI켜기가
아니라 로그인해서 사용하기 (토큰 소모 있을 수도 있음)"): the shell bar's
button reads **로그인해서 사용하기** for a visitor who is not signed in and
**AI 사용하기** for one who is (it was 실제 AI 켜기); in demo the bar says
"AI를 쓰면 내 지원금이 조금 쓰일 수 있어요". Wording only — the same switch.

**반응과 댓글** (ctrlaiapps-reactions, 2026-10-17; owner: "7:3 … 영상처럼
댓글 윈도우"). On a wide screen a published app's page splits about 7 : 3:
the app on the left, a **반응과 댓글** panel on the right with 좋아요 ·
유용해요 · 흥미로워요 and the comments — CtrlAITube's shape: one level of
replies, the author edits and deletes, 신고 goes to Admin › Content (the
comment-report table now holds 영상 and 앱 rows), the admin hides or
deletes with a reason (audited). The panel folds away to give the app the
full width (remembered per browser); on a phone it sits under the app.
Reading needs an account; reacting and commenting need a member taking
part this quarter. The maker hears 반응을 얻었어요 (a member once a day for
reactions, every comment); a comment's author hears of a reply. An app
that is unpublished or deleted takes its reactions and comments with it;
purge removes them.

The community surface for published apps (Phase 5). **Built so far
(`ctrlaiapps-publish`, 2026-10-14):** 게시 from the Builder publishes the
project's newest *version*; CtrlAIApps lists it (name, short Korean
description, author, "v5 · 3일 전 업데이트", optional 업데이트 메모) and
`apps.ctrlai.my/<app-slug>/` serves exactly that version. The member keeps
editing the working copy — previewed from its own unlisted folder — and
nothing public changes until **업데이트 게시** (the dialog shows v3 → v5).
**게시 취소** takes it down and keeps every version. **Since
publish-summary (2026-10-16)** the dialog's 설명 — and for 업데이트 게시
the 메모 — are pre-filled by Claude's fast model from the project's name
and files (and the versions since the published one): written once per
working version, kept on the version, free to the member (the club's cost
is an absorbed 0원 row, feature `publish_summary`), never blocking 게시
(a failure leaves the field empty, "직접 적어 주세요"). Only empty fields
are filled; a field the member typed in is never overwritten, and an
existing description gets a "Claude 요약으로 바꾸기" button. **The detail page (ui-improvements, owner-polish 15, 2026-10-16)** is
one head row — the app's small thumbnail · name · maker · "v5 · 3일 전
업데이트" · 업데이트 메모, with **새 창에서 열기** and **신고하기** on the
right — the description folded to one line (설명 더 보기), and right
under it the app itself in its sandboxed frame, taking the first screen
(the frame's height follows the viewport, at 390px too); the big colour
block and the duplicate 앱 실행 button are gone. The honest note under the
frame is per app: when the published version's `ctrlai.json` declares a
shared list it says "이 앱의 공유 글은 다른 회원도 볼 수 있어요". Admin › Content lists open
reports (the apps themselves are under Admin › Apps since app-platform
P4b); **게시 내리기** (with a reason) is audited and
closes the app's reports; closing a report without taking the app down is
audited too. No mock listings remain. Later: reactions (Like / Useful /
Interesting), threaded comments, GitHub link. Published
apps stay visible when their developer is no longer participating —
attribution is never erased, a former member shows as 탈퇴 회원.
**Every listing query filters the project's `deleted_at`** — deleting is
soft, and work a member removed must not survive on the one screen they
cannot control.

### Video Generator

Claude (scripts/prompt help) and Higgsfield (generation) stay separate
responsibilities behind their providers. Model-driven settings come from
the `VideoModel` catalogue (admin allowlist, enforced in the backend).
Later: model selector growth, templates, image-to-video, other providers
behind the same `VideoGenerationProvider` seam.

### YouTube (Phase 7)

Per-member Google OAuth by **incremental authorization** — sign-in asks
only `openid email profile`; the upload scope is asked for later, from
Profile › YouTube 연결. Upload with title/description/privacy, store the
returned video id, embed it. Until Google's audit passes, API uploads are
restricted to private — public publishing is a deployment/compliance
step, not a code step. Client secret and refresh tokens never reach the
browser.

### CtrlAITube (Phase 8)

The community feed embeds YouTube videos (CTRL+AI stores the video id,
never the file). **Entries can be created from a pasted YouTube URL**, so
Phase 8 does not depend on Phase 7. CTRL+AI reactions and comments live
in CTRL+AI PostgreSQL, deliberately separate from YouTube comments (an
optionally shown, clearly labelled YouTube-comments section is fine —
never mixed). The same `deleted_at` listing rule as CtrlAIApps.

**First real rows — `promo-videos` (2026-10-16).** One video row has a
*kind*: **hosted** (a file CTRL+AI serves itself) or **youtube**. The only
hosted video is the club's own 1-minute intro, **"CTRL+AI 한눈에 보기"**:
the only card in the grid for now, with a **공식** badge. Two cuts, placed
by **shape, not device** (owner, 2026-10-16, `fix-promo-video-placement`):
the **9:16 cut plays on CtrlAITube** — on a wide screen a vertical player
sized by height with the title and description beside it, the reactions
and comments in the right column; on a phone stacked — and the **16:9 cut
plays in the first-visit guide**. Both in the page with the browser's
controls, never autoplaying, muted until the member presses **소리
켜기**, with **크게 보기** for fullscreen. Its reactions (좋아요 · 유용해요 · 흥미로워요, a
toggle per member) and comments (one level of replies) are stored:
reading needs a signed-in account, reacting and commenting a member taking
part this quarter; a comment is its author's to edit or delete (anyone
else's is a 404); a member may 신고 a comment; Admin › Content lists those
reports and the admin hides (for everyone, with a reason) or deletes
(replies included) the comment — both audited — or closes the report and
keeps it. Per-comment 공감 is not stored yet, so the official video shows
no 공감 button and no 인기순. The 16:9 cut is the last step of the
first-visit guide. **The sample cards are gone** (owner, 2026-10-16):
the feed lists real rows only, and the "테스트 모드 – 예시" tag left the
screen with them.

### Admin, eventually

Beyond what exists (members, quarters, applications, wallets, budget by
provider, catalogues, feedback, deleted items, audit log): content
moderation — hide an app or video, moderate comments, disable a member's
publishing. Admin can choose what simplified units members see; the club
buys credit per provider, so Budget stays the purchase evidence.

**owner-polish-3 (2026-10-16, the owner's evening walk through production).**
(a) **Thumbnails**: the stored picture is **the app's first screen, like a
screenshot** — filled into 640×400 and cut from the top, never letterboxed
(owner, 2026-10-17, replacing the first version's whole-page fit), taken
in a 1024×640 frame so text stays readable on the card; the Builder's
미리보기 photographs the app after every load of the frame (so after
every new version) and once more a few seconds later when the first try
failed; 게시 photographs the published app; Admin › Apps has a one-time
**썸네일 만들기** that opens each published app without a picture in the
admin's own browser, one at a time, and saves what the SDK drew — or,
with `THUMBNAIL_RENDERER=server` (thumbnail-render-worker, 2026-10-17),
asks the server's own headless Chromium for an exact screenshot of each
app, one at a time ("서버의 브라우저가 … 찍어요"); 게시 then also gets the
server's picture a few seconds after the maker's browser's, and a failed
server render keeps whatever picture or cover the app had — and since
draft-server-thumbnails (2026-10-17) the Builder card's working-copy
picture is the server's too, after every change (fonts loaded first);
until a picture exists the cover is the app's name on its colour with a
large faint initial behind it (no more `</>`), on CtrlAIApps and Builder
cards alike. A visitor's browser never uploads a thumbnail. **(a2) The
maker chooses**: the 게시 dialog photographs three candidates from the
미리보기 — 첫 화면, 조금 내려간 화면, 폰 너비 — and 「지금 화면으로」 adds the
preview exactly as it is; nothing chosen means the first screen; no AI,
no charge. Once published, **the chosen picture is the thumbnail
everywhere** — CtrlAIApps and the Builder card both show it, and the
automatic draft captures stop replacing it (`thumbnail_chosen_at`); the
게시 menu's **썸네일 바꾸기…** opens the same picker later. Admin › Apps'
썸네일 만들기 stays for apps published before this.
(b) **The exchange rate is automatic**: Admin › System › 환율 shows
자동 반영 (the ECB's USD→KRW through Frankfurter — free, keyless, fetched
once a day by the server's daily job; `FX_PROVIDER=mock|frankfurter`) with
the last check and its outcome, 지금 새로 고침, and the admin's **환율
고정** switch; a day-to-day move over 5% is held back and shown as a
warning in that fold instead; a rate typed in by hand pins itself (자동
반영 off until switched back on); a failed fetch keeps the last rate and
never blocks a charge; every change — automatic, held back, pinned — is
in the Audit Log; only new charges use a new rate, wallets never move.
(d) The CtrlAIApps header says what apps can do now: AI inside an app is
paid by the signed-in active member who presses the button, a 데모 app
calls no AI, what an app stores on CTRL+AI (게시판·투표) shows on every
device while what it stores on the device stays in that browser — with
자세히 → /help/apps.
