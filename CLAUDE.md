# CTRL+AI — Product + Claude Code Project Instructions

## 1. Product Summary

Repository: `anoukkim/ctrl-ai-platform` (the repository name stays as it is)

The community is called **CTRL+AI**. That is the name members see — in the
sidebar, on the Chat welcome, and in the page title. The repository, the
database and the code keep their existing `ctrl-ai` / `ctrlai` spellings;
renaming them would break remotes and connection strings for a change
nobody can see.

CTRL+AI is a beginner-friendly AI creation community.

Most users are expected to be entry-level users who may not know how to code, use APIs, configure development environments, or work with AI tools directly.

The product should therefore feel simple and guided.

The opening screen is **Chat**.

Chat is the main entry point where users can:
- ask general questions
- ask for help using CTRL+AI
- describe something they want to build
- describe a video they want to make
- be routed into the correct CTRL+AI workspace

The main product areas are:

1. Chat
2. Builder — screen name **Project Builder**
3. Video Generator
4. **CtrlAI Apps** — the community app store (route stays `/ctrlaistore`)
5. CtrlAITube
6. **Usage**
7. Profile
8. Admin

## Decisions settled in Phase 0

These were open questions when this document was first written. Phase 0
answered them, and they are no longer up for debate:

| Decision | Settled as |
| -------- | ---------- |
| Interface language | **Korean-first.** Product names (Ctrl AI, Chat, Project Builder, Video Generator, CtrlAI Apps, CtrlAITube, Usage, Profile, Admin) and external service names (Claude, Higgsfield, GitHub, YouTube) stay in English. Everything a member reads or writes is Korean. |
| App store screen name | **CtrlAI Apps.** The route stays `/ctrlaistore` so existing links do not break. |
| Usage screen name | **Usage** — not "Usage & Credits", "My Credits" or "Balance". |
| Participation period | **Quarter — three months** (2026 Q1, 2026 Q2, …). The earlier four-month "Season" concept is retired; see section 10. |
| Roles | **`admin` and `member` only.** |
| Club name | **CTRL+AI**, shown wherever a member reads the name. Product names (Chat, Project Builder, Video Generator, CtrlAI Apps, CtrlAITube, Usage, Profile, Admin) and every route are unchanged. |

Remaining names in this document are working names and may still change.

---

# 2. Core Product Principle

Users should not need to understand technical architecture.

The desired experience is:

`I describe what I want -> CTRL+AI helps me create it -> I can publish/share it`

For apps:

`Chat/Idea -> Builder -> Claude-assisted project -> GitHub -> Publish -> CtrlAI Apps`

For videos:

`Chat/Idea -> Video Generator -> Claude assists prompt/script -> Higgsfield generates -> CTRL+AI library -> YouTube -> CtrlAITube`

The platform should hide unnecessary infrastructure complexity from normal members.

---

# 3. Opening Screen — Chat

Chat is the default home screen after login.

It is both:

1. a general Claude chat
2. a natural-language router into CTRL+AI features

Examples:

User:
> Make me a simple expense tracker app.

CTRL+AI can suggest:
- Start this in Builder
- Create a new project
- Continue discussing requirements in Chat

User:
> I want to make a 20-second short about Tokyo at night.

CTRL+AI can suggest:
- Open Video Generator
- Draft a prompt/script with Claude
- Generate with Higgsfield

User:
> How many credits do I have left?

CTRL+AI can show:
- Claude credits
- Higgsfield/video credits
- current quarter allocation
- recent usage

User:
> Show me the apps I made last quarter.

CTRL+AI can route to:
- Profile -> My Projects / My Apps

Chat should NOT require users to know feature names.

## Initial Chat Actions

The UI may include beginner-friendly shortcut cards such as:

- Build an App
- Make a Video
- Ask a Question
- Browse Apps
- Watch CtrlAITube

But the primary interaction remains the chat box.

---

# 4. Builder

Builder is the project creation workspace.

Primary provider:
- **Claude**

Initial purpose:
- create apps/projects using natural-language instructions
- let beginners build without needing to know how to code

Long-term goal:

`Prompt -> project files -> preview -> edit -> GitHub -> publish`

## Builder Features

### 4.1 Projects

Each user can create multiple projects.

Project fields may include:
- project name
- description
- owner
- status
- framework/type
- GitHub repository
- deployment/preview URL
- created date
- last updated date

Possible project statuses:
- draft
- building
- ready
- published
- archived

### 4.2 Claude-Assisted Building

Users should be able to say things like:

> Make a simple habit tracker.

> Add login.

> Change the colors.

> Add a chart.

Claude should work through a controlled backend coding workflow rather than exposing a raw provider key to the browser.

### 4.3 Code Editing

It IS possible to provide coding inside the portal.

Long-term direction:
- browser code editor using something like Monaco Editor
- file tree
- code tabs
- preview panel
- terminal/build output
- Claude chat alongside the code

Possible layout:

```text
+------------------------------------------------------+
| Builder                                              |
+------------+----------------------+------------------+
| Files      | Code Editor          | Claude           |
|            |                      |                  |
| app/       | page.tsx             | "Change this..." |
| components |                      |                  |
| ...        |                      |                  |
+------------+----------------------+------------------+
| Preview / Build Output                               |
+------------------------------------------------------+
```

However, do NOT run arbitrary member code directly on the main CTRL+AI backend.

A secure isolated execution/sandbox system is a later milestone.

For the earliest MVP:
- Claude may generate project files
- users can inspect/edit text files
- live sandbox execution can come later

### 4.4 GitHub Connection Per User

Each user should be able to connect their own GitHub account.

Preferred long-term approach:
- GitHub App
- user authorizes CTRL+AI
- CTRL+AI receives only the repository permissions needed

GitHub recommends GitHub Apps over classic OAuth apps in many cases because permissions can be more fine-grained and users have better control over repository access.

User flow:

`Profile -> Connect GitHub -> authorize -> Builder can create/select repo`

Builder should eventually support:
- create repository
- select existing authorized repository
- push project files
- commit updates
- show repository URL
- sync project status

Do NOT ask members to paste personal access tokens into CTRL+AI.

### 4.5 Publishing to CtrlAI Apps

When a project is ready:

`Builder project -> Publish`

Publishing creates or updates a CtrlAI Apps listing.

The Builder project and CtrlAI Apps listing should be related but not identical.

Project = private/working development object.

App = community-facing published object.

---

# 5. CtrlAI Apps

Screen name: **CtrlAI Apps** (settled in Phase 0). The route is
`/ctrlaistore`, kept from the earlier "App Store" working name so existing
links do not break.

This is the public/community surface for completed member projects.

Members can:
- browse published apps
- search/filter apps
- open app details
- see who developed the app
- launch/try the app when a launch URL exists
- react
- comment
- reply to comments

Possible reactions:
- Like
- Useful
- Interesting

Keep reactions simple initially.

## App Detail

Show:
- app name
- thumbnail/screenshots
- description
- developer
- developer membership status if appropriate
- created/published date
- launch button
- GitHub link only if developer chose to make it public
- reactions
- comments
- threaded replies

Published apps should remain visible even if the developer is no longer participating in the current quarter.

---

# 6. Video Generator

Primary providers:

- **Claude** = text / scripts / prompt assistance
- **Higgsfield** = AI video generation
- **YouTube** = publishing/distribution

The system must keep these responsibilities separate.

## Video Creation Flow

```text
User idea
   |
   v
Claude
- concept
- script
- prompt
- title
- caption
   |
   v
Higgsfield
- generate short/video
   |
   v
CTRL+AI video library
   |
   +----> Publish to CtrlAITube
   |
   +----> Upload to user's YouTube
```

## Intended Use

Main initial use case:
- create YouTube Shorts by prompt

The UI should be beginner-friendly.

Example:

```text
Describe your video:
[ A cinematic 15-second short of Seoul at night... ]

[ Improve with Claude ]

Style / Duration / Aspect Ratio

[ Generate with Higgsfield ]
```

Higgsfield has a server-side API for text-to-video models and credentials should remain on the backend.

Do not hard-code one underlying Higgsfield model everywhere. Use a video-generation provider/service layer.

Example:

```text
VideoGenerationProvider
└── HiggsfieldProvider
```

Possible later addition:
- model selector
- templates
- image-to-video
- different video providers

---

# 7. YouTube Connection Per User

Each user can connect their own YouTube/Google account.

Flow:

`Profile -> Connect YouTube -> Google OAuth -> authorized channel`

CTRL+AI should later allow:
- see connected channel
- upload a generated/final video to that channel
- set title
- description
- privacy
- save returned YouTube video ID
- embed published video in CTRL+AI

YouTube uploads require OAuth authorization.

Important implementation note:
YouTube API projects that have not completed Google's required audit may have API-uploaded videos restricted to private visibility. Treat public production publishing as a later deployment/compliance step.

Never expose:
- Google client secret
- OAuth refresh tokens
- provider credentials

---

# 8. CtrlAITube

Working name: **CtrlAITube**

CtrlAITube is the community video feed.

A video can be:
- created using Higgsfield
- uploaded/published to the creator's YouTube channel
- represented in CTRL+AI using its YouTube video ID/link

The feed shows embedded YouTube videos rather than trying to replace YouTube hosting.

Members can:
- browse videos
- watch embedded videos
- see creator
- react
- comment
- reply to comments

## Important: CTRL+AI Comments vs YouTube Comments

CtrlAITube should have its OWN CTRL+AI community discussion.

That means:
- CTRL+AI reactions/comments are stored in CTRL+AI PostgreSQL
- YouTube comments remain separate

Optionally show a separate section such as:

`YouTube Comments`

but do not mix them together.

This makes community reactions independent from the creator's YouTube channel.

---

# 9. Usage

The screen is called **Usage** (settled in Phase 0 — not "Usage & Credits",
"My Credits" or "Balance"). The route is `/usage`.

Members should easily see what they have left.

Example:

```text
2026 Q1

COMMUNITY SUPPORT

Build
지원: 70,000원
사용: 24,500원
남음: 45,500원

Video
지원: 30,000원
사용: 12,000원
남음: 18,000원

PERSONAL BALANCE

충전 잔액:     30,000원
개인 사용:      5,000원
남은 개인 잔액: 25,000원
```

**KRW is the financial source of truth.** Budgets are stored in won, never
in tokens or generations: provider prices change, and an approved
allocation must not move when they do. A provider-specific quota may be
*displayed* using the pricing captured at approval time.

Community support and personal money are shown separately and never added
together. Personal funds are not part of the quarterly subsidy.

Use concepts such as:

- provider
- resource type
- allocated amount
- consumed amount
- remaining amount
- provider cost
- internal credit amount

Admin can choose what simplified units members see.

---

# 10. Quarterly Participation

CTRL+AI operates by calendar quarter. A quarter is normally three months.
(The earlier four-month "Season" concept is no longer used anywhere.)

Examples:
- 2026 Q1
- 2026 Q2
- 2026 Q3
- 2026 Q4

Users can participate in one or more quarters.

Do NOT delete their work simply because they are not active in the current quarter.

Separate:

1. Account
2. Quarterly Participation
3. Published Work

## Credits are not automatic

A user does not receive quarterly credits by existing. The flow is:

```text
Admin opens applications for a Quarter
  -> user sees applications are open in Profile
  -> user applies, splitting their budget between Build and Video
  -> admin reviews and approves
  -> the approved allocation becomes usable
```

The Build and Video percentages must add up to exactly 100%.

## Quarterly subsidy limit

Each approved member may receive at most **100,000 KRW per quarter** of
community-funded budget, combined across Build and Video.

```text
Build 100% / Video   0%  =  100,000 /       0
Build  70% / Video  30%  =   70,000 /  30,000
Build  50% / Video  50%  =   50,000 /  50,000
Build  20% / Video  80%  =   20,000 /  80,000
Build   0% / Video 100%  =        0 / 100,000
```

This figure is NOT a constant scattered through the code. The default
lives in configuration; each Quarter copies it at creation and keeps its
own, so an admin can change it for a future quarter without altering a
quarter that already ran.

## Participation status

Suggested statuses:

- `active` — participating in this quarter and has access
- `inactive` — account exists but user is not participating in the current quarter
- `former` — member has left the community

Recommended English UI labels:

- Active Member
- Inactive Member
- Former Member

Use **Former Member** for the meaning of "탈퇴멤버".

Avoid "Deleted Member" because their profile attribution and content still need to exist.

## Behavior

### Active Member
Can:
- access Chat
- use Builder
- generate video
- consume allocated credits
- publish/comment/react according to permissions

### Inactive Member
Cannot use paid/private creation features for the current quarter.

Their:
- projects remain
- apps remain
- videos remain
- profile remains
- GitHub/YouTube links can remain stored subject to security policy

They may join a future quarter and continue existing work.

### Former Member
No normal platform access.

Published community works can remain visible and show:

`Developed by username — Former Member`

or:

`Creator: username (Former Member)`

Do not erase attribution from published works.

If privacy/legal requirements later require account deletion, design a separate true deletion/anonymization workflow rather than overloading `former`.

---

# 11. Authentication and Profile

Users should be able to create a CTRL+AI account.

Initial fields:
- username
- email
- password
- display name
- avatar optional

Security:
- NEVER store plaintext passwords
- store secure password hashes
- enforce unique username/email
- server-side sessions or secure token-based auth

Connected accounts are separate from CTRL+AI login:

```text
CTRL+AI account
├── GitHub connection
└── YouTube/Google connection
```

A user should not be required to use GitHub or Google as their primary login just to use CTRL+AI.

## Profile

Profile can show:
- username
- display name
- membership status
- quarters participated
- apps
- videos
- projects (private to owner)
- GitHub connection status
- YouTube connection status
- usage/credits

---

# 12. Admin

Admin is especially important because access and credits are quarterly, and because every allocation passes through an approval.

Admin features should eventually include:

## Members
- view users
- approve/activate users
- mark inactive
- mark former
- assign role
- enrol user into a quarter
- reactivate user for a later quarter

## Quarters
- create quarter
- start/end dates
- application open/close dates
- subsidy limit for the quarter
- open and close applications
- status

## Quarter applications
- view applicants
- review the requested Build/Video split
- approve or reject
- approving creates the allocation

## Credit Allocation
Admin should be able to open a member and assign resources.

Example:

```text
김유리

Quarter: 2026 Q1

Requested:
Build  70%  =  70,000원
Video  30%  =  30,000원

[ 승인 ]  [ 거절 ]
```

Admin normally approves the requested split as submitted. The approved
allocation copies the requested figures, so a later change to the
quarter's subsidy limit cannot move an allocation that already exists.

This is preferable to putting raw provider API keys in member accounts.

The platform owns/routs provider access and records member usage.

## Content
Admin may later:
- hide app
- hide video
- moderate comment
- disable member publishing

---

# 13. Roles

System roles are **`admin` and `member` only** (settled in Phase 0):

- `admin`
- `member`

There is no `moderator` and no `developer` role. Do not create unnecessary
complex RBAC at the beginning.

"Developer" should NOT necessarily be an account role because any active member may create an app.

A member becomes the developer/creator of a project based on ownership.

---

# 14. Suggested Core Data Model

This is direction, not a requirement to implement everything immediately.

## User
- id
- username
- email
- password_hash
- display_name
- avatar_url
- account_status
- role
- created_at
- updated_at

## Quarter
- id
- code: "2026-Q1"
- display_name: "2026 Q1"
- starts_at
- ends_at
- application_opens_at
- application_closes_at
- status: draft | application_open | active | closed
- subsidy_limit_krw

## QuarterApplication
- id
- user_id
- quarter_id
- build_percentage
- video_percentage
- requested_total_budget_krw
- requested_build_budget_krw
- requested_video_budget_krw
- status: draft | submitted | approved | rejected | cancelled
- submitted_at
- reviewed_at
- reviewed_by
- admin_note

One live application per user per quarter.

## QuarterAllocation
- id
- user_id
- quarter_id
- community_total_budget_krw
- build_budget_krw
- video_budget_krw
- build_percentage
- video_percentage
- build_consumed_krw
- video_consumed_krw
- pricing_snapshot (provider prices captured at approval)
- approved_at
- approved_by

## PersonalBalance
- id
- user_id
- balance_krw
- consumed_krw
- overage_enabled (the member must opt in before personal money is spent)

## PersonalTopUp
- id
- user_id
- amount_krw
- status: requested | confirmed | rejected | cancelled
- requested_at
- confirmed_at
- confirmed_by
- payment_reference

## UsageEvent
- id
- user_id
- quarter_id
- category: build | video
- funding_source: community_build | community_video | personal
- provider
- model_id
- provider_units / provider_unit
- provider_cost / provider_currency
- charged_krw
- builder_project_id / video_project_id
- created_at

`provider_cost` (what the provider charged) and `charged_krw` (what moved
a budget) are deliberately separate figures.
- related_project_id nullable
- related_video_id nullable

## Project
- id
- owner_user_id
- name
- description
- status
- github_repo
- preview_url
- created_at
- updated_at

## App
- id
- project_id
- owner_user_id
- name
- slug
- description
- thumbnail_url
- launch_url
- status
- published_at

## AppReaction
- id
- app_id
- user_id
- reaction_type

## AppComment
- id
- app_id
- user_id
- parent_comment_id nullable
- body
- created_at

## Video
- id
- owner_user_id
- source_provider
- provider_job_id
- asset_url
- youtube_video_id
- title
- description
- prompt
- status
- published_at

## VideoReaction
- id
- video_id
- user_id
- reaction_type

## VideoComment
- id
- video_id
- user_id
- parent_comment_id nullable
- body
- created_at

## ConnectedAccount
- id
- user_id
- provider
- provider_account_id
- encrypted_credential_reference
- created_at
- updated_at

---

# 15. Main Navigation

Recommended desktop navigation:

```text
Ctrl AI

Chat
Project Builder
Video Generator

Explore
  CtrlAI Apps
  CtrlAITube

Usage
Profile
```

As built in Phase 0, the sidebar groups these in Korean — 만들기 / 둘러보기 /
내 정보 / 관리 — while the item names themselves stay in English.

Admin sees:

```text
Admin
```

as an additional item.

On mobile this can become bottom navigation + More.

---

# 16. Provider Architecture

## Claude

Use for:
- opening Chat
- general questions
- Builder assistance
- code generation
- debugging
- project planning
- Higgsfield prompt improvement
- scripts/titles/descriptions

Application provider calls must use backend APIs.

A user's Claude subscription is NOT the same thing as the CTRL+AI application's Anthropic API access.

## Higgsfield

Use for:
- text-to-video
- later image-to-video
- Shorts generation

Keep credentials server-side.

## GitHub

Use per-user connected GitHub access.

Prefer a GitHub App with fine-grained repository permissions rather than asking users for personal access tokens.

## Google / YouTube

Use OAuth per user.

Use for:
- channel connection
- upload
- metadata
- embed IDs
- optional YouTube comments

---

# 17. Security Rules

Non-negotiable:

- never commit secrets
- never store plaintext passwords
- never expose Anthropic/Higgsfield master credentials in frontend
- never expose Google client secret
- never expose OAuth refresh tokens
- do not ask users to paste GitHub PATs
- authorization must be checked in backend
- inactive/former users must lose paid creation access
- provider usage must be attributable to a user and quarter
- arbitrary generated app code must NOT execute on the main backend
- app execution requires an isolated sandbox/runtime later
- production credentials belong in a secret manager
- maintain audit logs for admin credit/membership changes

---

# 18. Target Stack

Frontend:
- Next.js
- React
- TypeScript

Backend:
- Python
- FastAPI
- Pydantic
- SQLAlchemy
- Alembic

Database:
- PostgreSQL
- local: Docker Compose
- production later: Google Cloud SQL

Potential Builder editor later:
- Monaco Editor

Infrastructure later:
- Google Cloud
- Docker
- Cloud Storage
- Secret Manager
- isolated build/runtime environment for member apps

---

# 19. Environment Variables

Create `.env.example`.

Never commit real `.env`.

Example:

```env
APP_ENV=development

DATABASE_URL=postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai

NEXT_PUBLIC_API_BASE_URL=http://localhost:8000

# Provider selection. Mock is the default everywhere, so the whole
# platform runs with no keys. See section 20.
CLAUDE_PROVIDER=mock
VIDEO_PROVIDER=mock
GITHUB_PROVIDER=mock
YOUTUBE_PROVIDER=mock

# Only needed when the matching provider above is switched off mock.
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=

HF_CREDENTIALS=

GITHUB_APP_ID=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_PRIVATE_KEY_PATH=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

Never put secrets in `NEXT_PUBLIC_*`.

An empty provider key is not an error while that provider is `mock`. A
missing key must only fail at startup when the real implementation is
selected.

---

# 20. Development Phases

Do not build the whole platform at once.

**Build every phase locally first. Deploy last.** There is no domain, no
server and no provider API key, and none of Phases 0–8 need one. Going live
is Phase 9 and nothing before it depends on that work.

## The provider rule — applies to every phase

Every external provider sits behind a **provider interface with a mock
implementation**, and the implementation is chosen by an environment
variable. **The mock is the default.**

| Provider | Variable | Values |
| -------- | -------- | ------ |
| Claude | `CLAUDE_PROVIDER` | `mock` (default) \| `anthropic` |
| Higgsfield | `VIDEO_PROVIDER` | `mock` (default) \| `higgsfield` |
| GitHub | `GITHUB_PROVIDER` | `mock` (default) \| `github` |
| Google/YouTube | `YOUTUBE_PROVIDER` | `mock` (default) \| `google` |

Consequences, all deliberate:

- Every phase can be built, run and tested with **no API keys and no domain**.
- A mock returns plausible, deterministic data so the UI and the usage
  ledger can be exercised end to end — including failure paths.
- Switching to a real provider is a configuration change in Phase 9, not a
  rewrite. If swapping the variable requires touching a screen or a route,
  the interface was drawn in the wrong place.
- Tests run against mocks and therefore never contact a paid API.
- OAuth phases (4 and 7) use **localhost callback URLs** during development.
  Production callback URLs are registered in Phase 9.

The existing `VideoModel` catalogue already follows this shape: the model
list lives in the database, and the provider field names who would serve it.

## Phase 0 — Product Shell ✅ Complete

Goal: make the product concept visible locally.

Build:
- Next.js frontend
- FastAPI backend
- PostgreSQL via Docker Compose
- `/api/health`
- main navigation
- Chat as opening/default page
- Builder mock page
- Video Generator mock page
- CtrlAI Apps mock page
- CtrlAITube mock page
- Usage mock page
- Profile mock page
- Admin mock page
- responsive basic layout
- mock data only where appropriate

The Chat page should visibly offer routes such as:
- Build an App
- Make a Video
- Browse Apps
- Watch CtrlAITube

Builder page should visually show future:
- Claude panel
- files/editor area
- preview
- GitHub connection/push action

Video page should visually show future:
- prompt
- Improve with Claude
- Generate with Higgsfield
- Publish to YouTube

Do NOT implement real authentication/provider APIs/GitHub/YouTube yet.

**Delivered.** The shell runs locally: Next.js frontend with every screen and
the full navigation, FastAPI backend, PostgreSQL via Docker Compose,
`/api/health`, Korean-first UI, and a single dark theme. Anything not yet
built renders a **준비 중** badge with disabled controls.

## Phase 1 — Accounts + Quarters + Credits ✅ Complete

Phase 1 is three sub-phases. Do them in order: 1b and 1c both assume a real
signed-in user, which only 1a provides.

Status below reflects what has actually been verified running, not what
exists on disk.

### Phase 1a — Auth and the foundations underneath it ✅ Complete

- ✅ **Alembic migrations replace `create_all`** — Alembic owns the schema
  (`alembic upgrade head`, then `python -m app.db.init_db` to seed).
  `create_all` is gone from application code; it survives only in
  `tests/conftest.py`, which builds a throwaway in-memory SQLite schema.
  `create_all` must not be reintroduced: every schema change is a migration,
  and migrations are what run in production in Phase 9.
- ✅ **username/password auth** — `POST /api/auth/register`, `/login`,
  `/logout`, `GET /api/auth/me`. Passwords are hashed with **Argon2id**
  (`app/core/security.py`) and `password_hash` appears in no response
  schema. Sessions are **rows** in `user_sessions`, not self-contained
  tokens, so signing out — or deactivating an account — takes effect on the
  very next request.
- ✅ **Next.js rewrites proxy `/api/*` to FastAPI** — `next.config.ts`
  forwards to `BACKEND_ORIGIN`. The browser sees one origin, which is what
  makes the **HttpOnly** session cookie work: it is sent automatically and
  no script on the page can read it. No CORS credentials dance, and no
  token in `localStorage`. The same arrangement holds in production.

`get_current_user` in `api/deps.py` now resolves the session cookie to a
real member and is in front of every member and admin route. Account status
is re-checked on each request, not only at sign-in.

Phase 1a also introduced **`account_status`** (`active` / `inactive` /
`former`), replacing the Phase 0 `is_active` boolean. Phase 1a only blocks
sign-in for anything that is not `active`; the participation rules that
hang off it are Phase 1b.

### Phase 1b — Quarters and membership ✅ Complete

- ✅ `Quarter`
- ✅ `QuarterApplication` — one live application per member per quarter,
  and the Build/Video split must total exactly 100%
- ✅ active / inactive / former behaviour, **enforced in the backend**

Participation is a real model, `QuarterMembership`, with one row per
member per quarter. It is per quarter rather than a single flag on the
user because CTRL+AI runs by quarter: someone may be active in Q1, sit out
Q2 and return in Q3, and that history is what attribution depends on.

**A missing row means "not participating."** No inactive row is written
for every member who did not apply.

Two statuses answer two different questions and must not be confused:

| Column | Question it answers |
| ------ | ------------------- |
| `User.account_status` | May this person use CTRL+AI at all? |
| `QuarterMembership.status` | Are they participating in *this* quarter? |

The rules, as enforced:

- **active** — may create; everything works.
- **inactive** — may sign in, may read everything they own, **may not use
  paid creation features**. `require_active_member` guards project
  creation and video version generation (the budget-spending call). Reads
  stay open, so their work never disappears.
- **former** — cannot sign in at all, and an open session stops working on
  the next request. Their account is kept rather than deleted precisely so
  published work keeps their name with the 탈퇴 회원 label.

Approving an application is what makes a member a participant: it writes
the membership row alongside the allocation. Without that the member would
have a budget they could not spend.

Admins can also set participation directly
(`PUT /api/admin/quarters/{id}/members/{user_id}`). Setting `former` closes
the account at the same time, so the two statuses cannot drift apart.

### Phase 1c — Allocation, usage and administration ✅ Complete

- ✅ `QuarterAllocation` — created by admin approval, copying the requested figures
- ✅ `PersonalBalance` / `PersonalTopUp`
- ✅ `UsageEvent` and the **Usage page on real data**
- ✅ admin member list
- ✅ admin quarter enrolment
- ✅ admin credit allocation, in KRW
- ✅ **audit log for admin changes**

**Money moves in one transaction.** `app/services/usage.py` is the only
place a budget is reduced. It locks the allocation row with
`SELECT ... FOR UPDATE`, checks the money is there, then deducts it and
writes the `UsageEvent` — all before committing. Without the lock, two
concurrent requests both read the same remaining figure, both decide the
charge is affordable, and the member ends up overdrawn. There is a test
that proves this: with the lock removed, eight concurrent 20,000원 charges
against a 100,000원 budget spend 160,000원.

A charge is paid from **one** pot, never split. Personal money is used
only when the member has enabled overage and has enough, which keeps the
Usage screen explainable and matches section 9.

**The audit log is append-only.** Nothing in the application updates or
deletes a row, and the API exposes only a list. `actor_user_id` is
`ON DELETE SET NULL` with the username denormalised, so removing an admin
account never erases the record of what they changed.

**Simulate usage** (`POST /api/admin/simulate-usage`) spends a budget
without calling a provider, so the Usage screen and the audit log can be
exercised before Phases 2 and 6. It goes through the same `charge()` the
real providers will use — a shortcut writing its own ledger row would
prove nothing. It returns **404 outside development**, not 403: a deployed
instance should not reveal that the route exists.

## Phase 2 — Chat

Implement:
- backend Claude adapter **behind `CLAUDE_PROVIDER`, mock by default**
- chat conversations/messages
- general chat
- basic intent actions/links into Builder and Video Generator
- usage event recording
- credit checks

The mock Claude provider returns canned Korean replies, so the whole of
Chat — conversation storage, routing, usage recording and budget checks —
is built and tested with no Anthropic key.

Do not create a complex AI agent router initially.
Simple explicit routing/actions are enough.

## Phase 3 — Builder MVP

> **Groundwork already exists — extend it, do not rebuild it.** The Phase 1
> branch built `BuilderProject` (model, schema, `routes/builder.py` with full
> CRUD and per-owner access), the project library at `/builder`, and the
> `/builder/[projectId]` workspace with its file tree, editor pane, Claude
> panel and `PreviewPane`. All of it persists to PostgreSQL and is covered by
> tests. **What is missing is the provider**: nothing calls Claude, no project
> files are generated, and `PreviewPane` renders a `MockRuntime` behind a
> documented adapter boundary. Phase 3 fills that in.

Implement:
- Projects — *extend the existing `BuilderProject`*
- create project from prompt
- Claude generates/edits text project files
- project file browser — *the UI shell exists; give it real files*
- simple text/code editor
- project history/save
- no arbitrary live code execution yet

## Phase 4 — GitHub Integration

Implement:
- GitHub App **behind `GITHUB_PROVIDER`, mock by default**
- connect account/install app
- authorized repository selection
- create repository if permitted
- push/commit project
- sync repository metadata

The mock provider simulates a connected account and a repository push, so
the Profile connection flow and the Builder push action are built without a
registered GitHub App. Use a **localhost callback URL** during development;
the production callback is registered in Phase 9.

## Phase 5 — CtrlAI Apps

Implement:
- publish Builder project as App
- public listing
- app detail
- creator attribution
- reactions
- comments
- threaded replies
- inactive/former creator attribution

## Phase 6 — Video Generator

> **Groundwork already exists — extend it, do not rebuild it.** The Phase 1
> branch built `VideoProject`, `VideoVersion` and the `VideoModel` catalogue
> (with an admin allowlist enforced in the backend: a hidden or disabled model
> is refused), `routes/video.py`, the library at `/video`, and the
> `/video/[projectId]` workspace with its iterative version loop — generate,
> compare versions, mark a final. Versions persist and are covered by tests.
> **What is missing is the provider**: creating a version records a row and
> returns a placeholder; Higgsfield is never contacted and nothing is charged.
> Phase 6 fills that in.

Implement:
- Claude prompt/script assistance
- Higgsfield provider adapter **behind `VIDEO_PROVIDER`, mock by default**
- generation request
- generation status
- final result
- Video record — *extend the existing `VideoProject` / `VideoVersion`*
- usage tracking / credit deduction

The mock video provider returns a placeholder asset after a simulated delay,
which is enough to exercise the version loop, the status transitions and the
budget deduction without spending anything.

## Phase 7 — YouTube Integration

Implement:
- Google OAuth **behind `YOUTUBE_PROVIDER`, mock by default**
- connect channel
- upload selected generated video
- title/description/privacy
- save YouTube ID
- embed in CTRL+AI

Use a **localhost callback URL** during development. Note that YouTube API
projects which have not passed Google's audit may have uploaded videos
forced to private — treat public publishing as part of Phase 9.

## Phase 8 — CtrlAITube

Implement:
- community video feed
- **entries created from a pasted YouTube URL**
- YouTube embeds
- creator attribution
- CTRL+AI reactions
- CTRL+AI comments
- threaded replies
- optionally show YouTube comments in a separate labeled area

**Phase 8 does not depend on Phase 7.** A member can paste the URL of a
video they uploaded to YouTube themselves; CTRL+AI extracts the video ID and
creates the entry. Automatic publishing from Phase 7 is a convenience on top
of this, not a prerequisite — so the community feed can be built and filled
with real videos before any Google OAuth work exists.

## Phase 9 — Go Live 💳 **requires paid cloud resources**

Everything before this phase runs on a laptop. This is the only phase that
costs money and the only one that needs a domain or an API key.

> **Ask before creating any paid cloud resource.** Domains, managed
> databases, hosting plans and provider API keys all bill someone. Confirm
> first — this is also rule 5 of section 21.

Implement:

- **domain** — register and point DNS
- **HTTPS** — certificate and redirect; no plaintext HTTP in production
- **frontend hosting** — the Next.js app, with the `/api/*` rewrite from
  Phase 1a pointing at the deployed backend
- **backend hosting** — bind the platform's port
  (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`)
- **managed PostgreSQL** — point `DATABASE_URL` at it; the database must not
  be reachable from the public internet
- **Secret Manager** — provider keys, database credentials and the session
  signing key; none of them in the repository, none in `NEXT_PUBLIC_*`
- **production CORS** — `CORS_ALLOW_ORIGINS` set to the real frontend origin
  only. With the Phase 1a rewrite the browser sees one origin, so this stays
  narrow.
- **production cookie settings** — `Secure`, `HttpOnly`, `SameSite`
- **run Alembic migrations in production** — `alembic upgrade head` as part
  of deployment. This is why Phase 1a replaced `create_all`: a production
  database is migrated, never re-created.
- **switch providers from mock to real** — flip `CLAUDE_PROVIDER`,
  `VIDEO_PROVIDER`, `GITHUB_PROVIDER`, `YOUTUBE_PROVIDER` and supply the
  keys. If this needs a code change, the provider rule was not followed.
- **update OAuth callback URLs** — replace the localhost callbacks from
  Phases 4 and 7 with production URLs, in the GitHub App and Google Cloud
  console

Deploy one piece at a time and verify each before the next. A broken
deployment with real members on it is far more expensive than a slow one.

## Later — Secure App Runtime

Only later:
- execute/run generated apps
- live preview
- deploy member apps
- isolated containers/sandbox
- resource limits
- secrets/environment variables
- deployment URLs

Never execute arbitrary member code directly on the primary backend.

---

# 21. Claude Working Method

At the beginning of every task:

1. run `pwd`
2. run `git status`
3. read `README.md`
4. read `CLAUDE.md`
5. read `docs/BACKLOG.md` — it decides what to work on (section 22)
6. inspect relevant project files
7. explain the next small milestone
8. implement incrementally
9. run tests/build
10. summarize:
   - what changed
   - changed files
   - commands to run
   - what remains

The primary developer knows Python but is learning full-stack architecture.

Explain unfamiliar concepts briefly and clearly.

Do not overengineer.

Do not claim something works unless verified.

Ask before:
- deleting significant files
- force-pushing
- rewriting Git history
- creating paid cloud resources
- major architecture changes

---

# 22. Git Workflow

## One branch per phase

Each phase or sub-phase is built on **its own branch**, named
`phase-<id>-<short-name>`, created from an **up-to-date `main`**:

```text
phase-1a-auth
phase-1b-quarters
phase-2-chat
phase-9-go-live
```

```bash
git checkout main
git pull
git checkout -b phase-1a-auth
```

The existing `phase/1-foundation` branch predates this rule and keeps its
name; everything from Phase 1a onward uses the `phase-<id>-<short-name>`
form.

## While working

Commit in **small logical steps** — not one large commit at the end. Use
conventional messages:

| Prefix | For |
| ------ | --- |
| `feat:` | a new capability |
| `fix:` | a bug fix |
| `docs:` | documentation only |
| `test:` | tests only |
| `chore:` | tooling, dependencies, configuration |

A commit should be reviewable on its own and leave the project working.

## Before every commit

Run `git status` and **confirm none of these are staged**:

- `.env`, `.env.local`, or any real environment file
- `.venv/`, `node_modules/`, `.next/`
- API keys, passwords, OAuth client secrets, refresh tokens, private key
  files, database credentials, generated secret files

**If a secret is ever staged, stop immediately and tell the developer.** Do
not quietly unstage it and carry on, and do not commit "just to fix it
next" — a secret that reaches a commit must be treated as compromised and
rotated, which is the developer's decision to make.

## When the phase is done

1. Run **all tests** and the **build**.
2. Report what changed, what passes, and what remains.
3. **WAIT.**

**Do not merge into `main` until the developer explicitly says the phase is
approved.** Finishing the work is not approval. A green test run is not
approval. Only the developer saying so is approval.

## On approval

```bash
git checkout main
git merge --no-ff phase-1a-auth      # a merge commit, so the phase stays visible
git push origin main
git branch -d phase-1a-auth          # delete the local branch
git status                           # confirm clean
```

Then confirm to the developer that `git status` is clean.

## Never

- **never force-push** (`--force`, `--force-with-lease`)
- **never rewrite history** (`rebase`, `reset --hard`, `commit --amend` on
  anything already pushed)
- **never delete `main`**

Ask first before anything destructive — discarding changes, deleting
branches other than a merged phase branch, resetting, or dropping a
database.

## The backlog decides what gets worked on

[`docs/BACKLOG.md`](docs/BACKLOG.md) is the single ordered queue of
upcoming work. It exists so that work arrives in one place and in one
order, instead of being inferred from whatever was said most recently.

- **At the start of every session, read `docs/BACKLOG.md`.** It comes
  after `README.md` and `CLAUDE.md` in the working method (section 21).
- **Work only on the item the developer names**, or the top of **Next**
  if they say *"next item"*. Do not start the item that merely looks most
  urgent.
- **A new UI request mentioned mid-phase is appended to "UI requests" and
  is NOT implemented in the current branch** — unless the developer says
  *"do it now"*. This keeps a branch about one thing, which is what makes
  it reviewable and what keeps its tests meaningful.
- **When an item is merged, move it to "Done"** with the merge date,
  newest first, and take it out of **Next**.

Keeping the backlog current is part of finishing an item, not a separate
chore.

---

# 23. Current status / next task

**Phase 0 and Phase 1 are complete.** Accounts, quarters, participation,
budgets, the usage ledger and the audit log all work end to end against a
real database, with no provider connected.

- **Phase 1a** — auth: Argon2id, HttpOnly same-origin session cookie,
  real `get_current_user` / `require_admin`. Merged.
- **Phase 1b** — membership: per-quarter `QuarterMembership`,
  `require_active_member` on paid creation. Merged.
- **Phase 1c** — usage ledger and audit log: charging and the
  `UsageEvent` row in one locked transaction, the real admin member list,
  the append-only audit log. Merged.

**The next task is Phase 2 — Chat** (section 20):

> Add the backend Claude adapter behind `CLAUDE_PROVIDER`, mock by
> default, so the whole of Chat can be built without an Anthropic key.
> Store conversations and messages. Route simple intents into Project
> Builder and Video Generator — explicit actions, not an agent router.
> Record a `UsageEvent` for every reply through the existing
> `charge()` service, and check the budget before calling the provider,
> never after.

`docs/BACKLOG.md` holds the order of work. The `ui-brand-refresh` UI batch
is built and waiting on review ahead of Phase 2.

No mock data remains in the money path. What is still mock: the CtrlAI
Apps and CtrlAITube listings (Phases 5 and 8) and the Chat replies
(Phase 2).

Do not start Phase 9 or create any paid cloud resource without asking
first.
