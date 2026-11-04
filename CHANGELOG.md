# Changelog

Releases of CTRL+AI, newest first. Every merged item, with its date and
branch, is in [`docs/archive/done.md`](docs/archive/done.md); this file
records what a release means for members and the club.

## 1.0.0 — 2026-11-04

**The first release: CTRL+AI opens to its members.** The invite-only beta
ran on [ctrlai.my](https://ctrlai.my) from 2026-10-13; on 2026-11-03 the
owner invited the club's ordinary members and the first meeting (1차 모임)
introduced the site. 1.0.0 is that launch — the code the members signed up
on: more than 1,000 commits and 190 merged items since 2026-09-23.

### What members get

- **Chat** — Claude (Sonnet / Haiku) with files, charts, tables, web use
  and live HTML previews opened beside the conversation; 이미지 만들기
  cards; replies that keep going after you leave; pinned and folded
  conversations; export (Markdown, PDF, code as ZIP). Chat is also the
  way into every other feature.
- **Project Builder** — say what you want and Claude plans, writes and
  checks the files while you watch; versions with undo/redo, reference
  pictures, 32 Korean fonts, background runs, one-click 게시.
- **Member apps (CTRL+AI 기능 상자)** — published apps run on
  `apps.ctrlai.my` in a trusted shell around a sandboxed frame, with
  storage, sign-in, a per-app database, maps and outside services, and AI
  paid by the visitor (데모만 or 전체 기능, the maker's choice). Four
  showcase apps: 문서 챗봇 (근로기준법 · 위키백과), 동아리 게시판, 여행 일정
  메이커, 출장·여행 준비 도우미.
- **CtrlAIApps and CtrlAITube** — the club's gallery with real
  thumbnails, reactions, comments and 신고; CtrlAITube holds the club's own
  video.
- **Usage** — one 동아리 지원 wallet per member per quarter (80,000원 by
  default), in won; an estimate before every paid action and the spend
  shown as it happens.
- **Accounts** — sign-up through Google with an invite code, a password
  chosen at setup, sign-in either way, 비밀번호를 잊었어요 through Google;
  privacy policy and terms (v2).

### What the club's admins get

- **Admin** in six sections — Dashboard (처리할 일, alerts), Members (the
  member panel with every action, 사용 내역 and 지운 작업), Quarters (분기,
  예산, 사용 분석, a Concur CSV, 분기 마감), Models (Chat · Video · Image,
  limits, calibration), Community (신고, 의견 with screenshots, apps),
  System (status, audit log, site banner).
- Money that moves only by rows: wallet adjustments, credit purchases and
  every charge are recorded and audited; the audit log is append-only.

### Running it

- One Google Cloud VM in Seoul (`ctrlai-server`) with Caddy, web, api,
  PostgreSQL 16 and the `thumbs` worker; daily backups copied to Cloud
  Storage; Cloud Monitoring mail on errors and downtime.
- **The push to `main` is the deploy** — GitHub Actions builds the
  images after the tests pass, and the server deploys them by itself
  within about 20 minutes, without a gap.

### Not in 1.0.0

- **Video** runs in 테스트 모드 (mock Higgsfield, placeholder clips), and
  **image generation** stays locked until the club buys a billed Gemini
  key.
- GitHub (Phase 4) and YouTube (Phase 7) are not started; CtrlAITube's
  YouTube feed waits for them.
- Five findings from the first meeting are open — Chat preview maps, a
  Builder app's AI button, an app-AI charge missing from Usage, Usage
  dates (UTC vs KST) and the post-login page after switching accounts:
  [`docs/first-meeting/README.md`](docs/first-meeting/README.md) › Found
  while recording.
