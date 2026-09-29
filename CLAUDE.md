# Ctrl AI — Product + Claude Code Project Instructions

## 1. Product Summary

Repository: `anoukkim/ctrl-ai-platform`

Ctrl AI is a beginner-friendly AI creation community.

Most users are expected to be entry-level users who may not know how to code, use APIs, configure development environments, or work with AI tools directly.

The product should therefore feel simple and guided.

The opening screen is **Chat**.

Chat is the main entry point where users can:
- ask general questions
- ask for help using Ctrl AI
- describe something they want to build
- describe a video they want to make
- be routed into the correct Ctrl AI workspace

The main product areas are:

1. Chat
2. Builder
3. Video Generator
4. App Store
5. CtrlAITube
6. Usage / Credits
7. Profile
8. Admin

Names are working names and may change.

---

# 2. Core Product Principle

Users should not need to understand technical architecture.

The desired experience is:

`I describe what I want -> Ctrl AI helps me create it -> I can publish/share it`

For apps:

`Chat/Idea -> Builder -> Claude-assisted project -> GitHub -> Publish -> App Store`

For videos:

`Chat/Idea -> Video Generator -> Claude assists prompt/script -> Higgsfield generates -> Ctrl AI library -> YouTube -> CtrlAITube`

The platform should hide unnecessary infrastructure complexity from normal members.

---

# 3. Opening Screen — Chat

Chat is the default home screen after login.

It is both:

1. a general Claude chat
2. a natural-language router into Ctrl AI features

Examples:

User:
> Make me a simple expense tracker app.

Ctrl AI can suggest:
- Start this in Builder
- Create a new project
- Continue discussing requirements in Chat

User:
> I want to make a 20-second short about Tokyo at night.

Ctrl AI can suggest:
- Open Video Generator
- Draft a prompt/script with Claude
- Generate with Higgsfield

User:
> How many credits do I have left?

Ctrl AI can show:
- Claude credits
- Higgsfield/video credits
- current season allocation
- recent usage

User:
> Show me the apps I made last season.

Ctrl AI can route to:
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

However, do NOT run arbitrary member code directly on the main Ctrl AI backend.

A secure isolated execution/sandbox system is a later milestone.

For the earliest MVP:
- Claude may generate project files
- users can inspect/edit text files
- live sandbox execution can come later

### 4.4 GitHub Connection Per User

Each user should be able to connect their own GitHub account.

Preferred long-term approach:
- GitHub App
- user authorizes Ctrl AI
- Ctrl AI receives only the repository permissions needed

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

Do NOT ask members to paste personal access tokens into Ctrl AI.

### 4.5 Publishing to App Store

When a project is ready:

`Builder project -> Publish`

Publishing creates or updates an App Store listing.

The Builder project and App Store listing should be related but not identical.

Project = private/working development object.

App = community-facing published object.

---

# 5. App Store

Working name: **App Store**

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

Published apps should remain visible even if the developer is no longer an active seasonal member.

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
Ctrl AI video library
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

Ctrl AI should later allow:
- see connected channel
- upload a generated/final video to that channel
- set title
- description
- privacy
- save returned YouTube video ID
- embed published video in Ctrl AI

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
- represented in Ctrl AI using its YouTube video ID/link

The feed shows embedded YouTube videos rather than trying to replace YouTube hosting.

Members can:
- browse videos
- watch embedded videos
- see creator
- react
- comment
- reply to comments

## Important: Ctrl AI Comments vs YouTube Comments

CtrlAITube should have its OWN Ctrl AI community discussion.

That means:
- Ctrl AI reactions/comments are stored in Ctrl AI PostgreSQL
- YouTube comments remain separate

Optionally show a separate section such as:

`YouTube Comments`

but do not mix them together.

This makes community reactions independent from the creator's YouTube channel.

---

# 9. Usage / Credits

Working name options:
- Usage
- My Credits
- Balance
- Usage & Credits

Recommended user-facing name: **Usage & Credits**

Members should easily see what they have left.

Example:

```text
This Season

Claude
Allocated: 2,000,000 tokens
Used:      650,000
Remaining: 1,350,000

Video
Allocated: 100 credits
Used:      35
Remaining: 65
```

The system should support different units because Claude and video-generation providers may not bill in the same way.

Do not force everything into a fake universal "token" unit internally.

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

# 10. Seasonal Membership

Ctrl AI operates in seasons.

Examples:
- 2026 Season 1
- 2026 Season 2
- 2027 Season 1

Users can participate in one or more seasons.

Do NOT delete their work simply because they are not active in the current season.

Separate:

1. Account
2. Seasonal Membership
3. Published Work

## Seasonal Membership Status

Suggested statuses:

- `active` — participating in this season and has access
- `inactive` — account exists but user is not participating in the current season
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
Cannot use paid/private creation features for the current season.

Their:
- projects remain
- apps remain
- videos remain
- profile remains
- GitHub/YouTube links can remain stored subject to security policy

They may join a future season and continue existing work.

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

Users should be able to create a Ctrl AI account.

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

Connected accounts are separate from Ctrl AI login:

```text
Ctrl AI account
├── GitHub connection
└── YouTube/Google connection
```

A user should not be required to use GitHub or Google as their primary login just to use Ctrl AI.

## Profile

Profile can show:
- username
- display name
- membership status
- seasons participated
- apps
- videos
- projects (private to owner)
- GitHub connection status
- YouTube connection status
- usage/credits

---

# 12. Admin

Admin is especially important because access and credits are seasonal.

Admin features should eventually include:

## Members
- view users
- approve/activate users
- mark inactive
- mark former
- assign role
- enroll user into a season
- reactivate user for a later season

## Seasons
- create season
- start/end dates
- status
- enrollment

## Credit Allocation
Admin should be able to open a member and assign resources.

Example:

```text
Yuri

Season: 2026 S2

Claude tokens:
[ 2,000,000 ]

Higgsfield credits:
[ 100 ]

[ Save Allocation ]
```

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

Initial system roles:

- `admin`
- `member`

Optional later:
- `moderator`

Do not create unnecessary complex RBAC at the beginning.

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

## Season
- id
- name
- starts_at
- ends_at
- status

## SeasonMembership
- id
- user_id
- season_id
- status
- joined_at
- ended_at

## CreditAllocation
- id
- user_id
- season_id
- provider
- resource_type
- allocated_amount
- consumed_amount

## UsageEvent
- id
- user_id
- season_id
- provider
- resource_type
- quantity
- provider_cost
- created_at
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
Builder
Video Generator

Explore
  App Store
  CtrlAITube

Usage & Credits
Profile
```

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

A user's Claude subscription is NOT the same thing as the Ctrl AI application's Anthropic API access.

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
- provider usage must be attributable to a user and season
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

---

# 20. Development Phases

Do not build the whole platform at once.

## Phase 0 — Product Shell

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
- App Store mock page
- CtrlAITube mock page
- Usage & Credits mock page
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

Stop after Phase 0 and report.

## Phase 1 — Accounts + Seasons + Credits

Implement:
- username/password auth
- User
- Season
- SeasonMembership
- active/inactive/former behavior
- Usage & Credits
- admin member list
- admin seasonal enrollment
- admin credit allocation

Use development/mock providers initially.

## Phase 2 — Chat

Implement:
- backend Claude adapter
- chat conversations/messages
- general chat
- basic intent actions/links into Builder and Video Generator
- usage event recording
- credit checks

Do not create a complex AI agent router initially.
Simple explicit routing/actions are enough.

## Phase 3 — Builder MVP

Implement:
- Projects
- create project from prompt
- Claude generates/edits text project files
- project file browser
- simple text/code editor
- project history/save
- no arbitrary live code execution yet

## Phase 4 — GitHub Integration

Implement:
- GitHub App
- connect account/install app
- authorized repository selection
- create repository if permitted
- push/commit project
- sync repository metadata

## Phase 5 — App Store

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

Implement:
- Claude prompt/script assistance
- Higgsfield provider adapter
- generation request
- generation status
- final result
- Video record
- usage tracking / credit deduction

## Phase 7 — YouTube Integration

Implement:
- Google OAuth
- connect channel
- upload selected generated video
- title/description/privacy
- save YouTube ID
- embed in Ctrl AI

## Phase 8 — CtrlAITube

Implement:
- community video feed
- YouTube embeds
- creator attribution
- Ctrl AI reactions
- Ctrl AI comments
- threaded replies
- optionally show YouTube comments in a separate labeled area

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
5. inspect relevant project files
6. explain the next small milestone
7. implement incrementally
8. run tests/build
9. summarize:
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

# 22. FIRST TASK FOR CLAUDE

If the repository is still in the bootstrap/planning stage:

> Read README.md and CLAUDE.md completely, then inspect the repository. Bootstrap only Phase 0. Ctrl AI is a beginner-friendly AI creation community and the default/opening page must be Chat. Build the local product shell using Next.js + TypeScript for the frontend, FastAPI for the backend, and PostgreSQL via Docker Compose. Create the main navigation: Chat, Builder, Video Generator, App Store, CtrlAITube, Usage & Credits, and Profile, with Admin visible as a placeholder admin-only area. The Chat page must be the default landing page and should contain a main chat UI plus beginner-friendly shortcut actions such as Build an App, Make a Video, Browse Apps, and Watch CtrlAITube. Builder should be a mock workspace showing the intended future layout of Claude assistance, file/code editing, preview, and GitHub push. Video Generator should show the intended prompt -> Improve with Claude -> Generate with Higgsfield -> Publish to YouTube flow using mock/disabled controls. App Store and CtrlAITube should use attractive mock cards and detail routes so the community concept is visible. Usage & Credits should show mock per-provider balances. Profile should show mock season/member status and connected account placeholders. Do not implement real authentication, provider APIs, GitHub integration, Google OAuth, billing, or arbitrary code execution yet. Add `/api/health`, `.env.example`, `.gitignore`, startup instructions, basic backend tests, and verify the frontend build. Stop after Phase 0 and report exactly what changed.
