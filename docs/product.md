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
| Navigation & shell    | Built — sidebar with quarterly participation status; menu button on narrow screens |
| Chat (default page)   | **Built** — conversations, streamed replies with 중지, action buttons into Builder/Video; mock Claude by default, charged to Build by the token |
| Project Builder       | Full-viewport workspace: files │ code │ Claude, preview and build output below    |
| Video Generator       | Generate / edit / extend through the **mock** Higgsfield provider, charged to Video in KRW |
| CtrlAIApps            | Mock listings; detail page is a hero, one primary action and three tabs (소개 / 댓글 / 업데이트 기록) sharing CtrlAITube's comment section |
| CtrlAITube            | Mock feed; watch page is two columns — player sized by ratio, sticky comment panel; CTRL+AI comments kept separate from YouTube comments |
| Usage                 | **Live** — real budgets, real ledger, redesigned around one figure per card       |
| Profile               | Live signed-in member, quarter participation, application form and 회원 탈퇴        |
| Admin                 | **Live** — section hub, member/application/quarter figures, KRW budgets, audit log |
| Backend `/api/health` | Real and working                                                                  |
| PostgreSQL            | Real, via Docker Compose; Alembic owns the schema                                 |
| Authentication        | **Built** — register, login, logout; Argon2 hashes; HttpOnly session cookie       |
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
| `/signup`             | 회원가입        | Korean sign-up                                |
| `/`                   | Chat            | Default landing page (requires sign-in)      |
| `/builder`            | Project Builder | Workspace: files, code, Claude, preview      |
| `/video`              | Video Generator | Workspace: prompt, 9:16 player, Claude, versions |
| `/ctrlaistore`        | CtrlAIApps      | Community app listings                       |
| `/ctrlaistore/[slug]` | App detail      | Hero, 앱 실행, tabs; same comments as CtrlAITube |
| `/ctrlaitube`         | CtrlAITube      | Community video feed                         |
| `/ctrlaitube/[id]`    | Video detail    | CTRL+AI comments + separate YouTube section  |
| `/usage`              | Usage           | Club support and personal balance, in KRW    |
| `/profile`            | Profile         | Quarter participation, application, accounts, 회원 탈퇴 |
| `/issues`             | Report Issue    | Bug reports and ideas, via GitHub Issues     |
| `/admin`              | Admin           | Section hub: work waiting, quarter figures, cards |
| `/admin/members`      | Members         | Search, filter, sort; row opens the member   |
| `/admin/members/[id]` | Member detail   | Participation history, budgets, audit trail  |
| `/admin/applications` | Applications    | Approve or reject, with stat cards and tabs  |
| `/admin/quarters`     | Quarters        | Quarter list with figures; create a quarter  |
| `/admin/topups`       | Top-ups         | Confirm personal top-up deposits             |
| `/admin/video-models` | Video Models    | Which models members may pick                |
| `/admin/claude-models` | Claude Models  | Chat models, their prices, who may pick them, the default |
| `/admin/deleted`      | Deleted Items   | Restore a project or video a member deleted  |
| `/admin/audit`        | Audit Log       | Every admin change, read-only                |
| `/admin/system`       | System          | Server health and external service status    |
| `/admin/dev`          | Dev Tools       | Usage simulator; development only            |

`/admin/budget` and `/admin/content` exist in the code but are hidden from
the navigation until budget-by-provider and Phases 5/8 fill them — a menu
item that always leads to an empty screen is in the way. Turning one on is
deleting its `hidden: true` in `frontend/app/admin/sections.ts`.

The App Store route is still `/ctrlaistore` although the screen is now called
**CtrlAIApps**; the path was kept so existing links do not break.

## Name

The community is **CTRL+AI** — that is what members see in the sidebar, on
the Chat welcome and in the page title. The repository, the database and
the code keep their existing `ctrl-ai` / `ctrlai` spellings: renaming them
would break remotes and connection strings for a change nobody can see.

Product names (Chat, Project Builder, Video Generator, CtrlAIApps,
CtrlAITube, Usage, Profile, Report Issue, Admin) are unchanged, as are all
routes.

Backend endpoints: `GET /api/health`, `GET /api/users`, and `GET /docs` for the
generated API documentation.

## The two creation workspaces

Project Builder and Video Generator are sibling workspaces. Both use the full
viewport with a compact top bar, side tools, a persistent Claude panel, and a
preview — closer to a desktop application than a web page. They share their
frame in `frontend/app/components/workspace.module.css`.

**Project Builder** — selecting a file changes the editor contents. Nothing
generates or runs code: that is Phase 3, and member code will never execute on
the CTRL+AI backend.

**코드 다운로드 (ZIP)** works today, in the project's ▾ menu and in each
library card's ⋯ menu. The archive holds the project's files in their folder
structure plus a short Korean guide, and never a `.env`, a key, `node_modules`
or `.git`. Project files live in `builder_project_files`, which **Phase 3 is
what fills** — so a project made now downloads as a ZIP containing only the
guide, and the guide says so rather than explaining how to run code that is not
there. Downloading stays open to a member who is not participating this
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
the member's **Video** budget at `seconds × the model's price per second for the
chosen resolution`, and the same figure is shown as the estimate next to the
button.

What a member can choose — lengths, ratios, resolutions, sound, whether edit and
extend exist — is the selected model's **catalogue entry**, edited in
Admin › Video Models. The seeded prices are placeholders and are marked 예시
there until an admin saves the model. Each version records how it was made
(생성 / 수정 / 이어서), its source version and its exact settings.

The Claude panel, **프롬프트 도움받기 (선택)**, starts collapsed. It only
rewrites prompt text, never generates video, and is charged to the **Build**
budget by the token, exactly like a Chat reply (below).

## Chat

Chat is the opening screen and a real conversation with Claude, behind
`CLAUDE_PROVIDER` (mock by default; the screen says
**테스트 모드 – 실제 AI 결과가 아닙니다** while it is).

- **Conversations** are listed on the left: 새 대화, rename, delete. They are
  private to the member. Deleting is a real delete — a chat is not *work*,
  so it does not go to Deleted Items — but the money it spent stays in Usage.
- **Replies stream** in as Claude writes them, with a **중지** button. A
  stopped reply keeps its text and is charged for the tokens used so far.
- **Action buttons.** When a message is about building an app or making a
  video, the reply ends with **Project Builder에서 시작** or **Video Generator
  열기**. The button opens that library with the new-project form already
  filled: the member's message becomes the description (Builder) or the
  prompt (Video). Claude chooses the button with a hidden marker the server
  removes; there is no agent routing.
- **Money.** Before Claude is called, the Build budget is checked against the
  worst case (the history sent plus the longest reply). Afterwards the tokens
  actually used are charged: input × input price + output × output price in
  dollars, × the won-per-dollar rate, rounded up to whole won. Each charge
  records the model, both token counts, the dollar cost and the rate. Prices
  are edited with the models in Admin › Claude Models, the rate in Admin ›
  System; both are audited.
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
Explore, Account), the item names (Chat, Project Builder, Video Generator,
CtrlAIApps, CtrlAITube, Usage, Profile, Report Issue, Admin) and the Admin
section names (Dashboard, Members, Applications, Quarters, Top-ups, Video
Models, Audit Log, System, Dev Tools). A screen's own heading matches its
menu name, so the two never disagree.

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

A single dark theme, inspired by developer tools rather than a generic
dashboard. Every colour is a token in `frontend/app/globals.css`; no component
hard-codes one. There is deliberately no light theme, so the prototype looks the
same for everyone reviewing it.

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
  -> member applies, splitting their budget between Build and Video
  -> admin approves
  -> the approved allocation becomes usable
```

The Build and Video percentages must add up to exactly 100%. Each approved
member may receive at most **100,000 KRW per quarter** of club-funded
budget, combined across both:

| Split | Build | Video |
| ----- | ----- | ----- |
| 100 / 0 | 100,000원 | 0원 |
| 70 / 30 | 70,000원 | 30,000원 |
| 50 / 50 | 50,000원 | 50,000원 |
| 20 / 80 | 20,000원 | 80,000원 |
| 0 / 100 | 0원 | 100,000원 |

That figure is not a constant scattered through the code. The default lives
in `quarterly_subsidy_limit_krw` (backend settings); each quarter copies it
at creation and keeps its own, so an admin can change it for a future
quarter without altering one that already ran. The percentage-to-KRW rule
lives in `backend/app/services/budget.py`, so the API, the UI and the tests
cannot drift.

### KRW is the financial source of truth

Budgets are stored in won, never in tokens or generations. Provider prices
change, and an approved allocation must not move when they do. A
`pricing_snapshot` is captured at approval so a provider-specific quota can
still be displayed consistently afterwards.

`UsageEvent` keeps two separate figures: `provider_cost` (what the provider
charged, in their own units and currency) and `charged_krw` (what moved a
budget). Conflating them would misreport both.

### Community money and personal money are separate

A member who exhausts their community budget stops there by default.
Personal money is spent only if they have explicitly enabled it *and* have a
balance. Topping up never raises the community subsidy above the quarter's
limit, and the two are never added together in the interface.

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
| Admin — Top-ups | member name, username | top-up status |
| Admin — Audit Log | summary, admin, action, target | action |
| Admin — Video Models | model name, provider, model id | — |
| Admin — Claude Models | label, provider, model id | — |

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
  **환불 완료 기록**;
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
