# Ctrl AI — Backlog

The single ordered queue of upcoming work.

Read this at the start of every session. Work only on the item the
developer names, or the top of **Next** if they say *"next item"*. New UI
requests mentioned mid-phase go to **UI requests** and are not built in the
current branch unless the developer says *"do it now"*. When an item is
merged, add its row to [`archive/done.md`](archive/done.md) and move its
full spec to [`archive/done-specs.md`](archive/done-specs.md). See section
12 of [`CLAUDE.md`](../CLAUDE.md).

Milestones and their status are in [`ROADMAP.md`](ROADMAP.md); the phases
([`archive/phases.md`](archive/phases.md)) are feature names. **This file is the
authority on order** — each item in **Next** names its milestone.

---

## Now

**Run of 2026-10-14 (evening) — "RUN-2026-10-14b"** — the owner's batch
after the morning deploys, with merge **and deploy** pre-approved one item
at a time for exactly cost-clarity, chat-plus-files, chat-plus-artifacts,
chat-thinking-view, builder-static-runtime, ctrlaiapps-publish,
example-apps, offsite-backups and monitoring, plus the `set_password` CLI
and the `signup-google-first` backlog entry (CLAUDE.md §12, "written owner
instruction"). **Add-on (owner, same evening):** fix-quarter-form-autofill
and feat-spend-feedback, also pre-approved to merge and deploy, done right
after cost-clarity. anonymous-feedback-board and builder-python: branch,
test, report, WAIT. The board is
[`progress/RUN-2026-10-14b.md`](progress/RUN-2026-10-14b.md).

Owner answers recorded with this run (2026-10-14): the Google `.env`
change on the server was the owner's; no re-consent for existing accounts
(the only production account is the admin); sign-up stays as deployed for
the beta (`signup-google-first` is specced under *After the beta*);
members who forget a password ask the operator, who runs
`python -m app.db.set_password <아이디>` on the server
(`docs/deployment.md` §12); GitHub Pages, DNS and the sidebar footer are
the owner's, not this run's; **member apps are served from
`apps.ctrlai.my`** — no separate domain (CLAUDE.md §2).

**Money wording in older notes.** Since `single-wallet` (2026-10-08)
every paid feature spends from one 동아리 지원 wallet per member per
quarter. Notes below that say a feature "charges Build" or "the Video
budget" record what was true when they were written; read them as "the
wallet", with the provider on the usage event.

**Open check carried from Phase 2 — Chat: point 10 has not been run.**
One short real message with the owner's key (`CLAUDE_PROVIDER=anthropic`;
the model now comes from the catalogue (`chat-model-choice`) —
send one message on the default Sonnet 5.5 and one on Haiku 4.5) — confirm
the reply streams, the usage event and deduction are right, and a wrong
key shows the Korean message with no charge. The request shape has so far
only been checked against a fake transport. **Owner's step:** the
morning guide of the 2026-10-14 batch walks through it
(`progress/MORNING-2026-10-14.md`, section 5) — it is the first thing to
run after the real key goes into the server `.env`.

---

## Operator notes

→ Moved to [`development.md` › Operator notes](development.md#operator-notes).

---

## Next (in order)

**The numbered list below is the authority on order** — numbers written
inside spec sections are snapshots and go stale at every reorder. The
reorder history up to 2026-10-13 is archived in
[`archive/done-specs.md`](archive/done-specs.md#queue-history--how-next-was-reordered-2026-10-01--2026-10-13).
**Reordered by the owner on 2026-10-14 (evening)**: money clarity first,
then the three Chat items, then the Builder runtime and the first slice
of CtrlAIApps with example apps, then backups and monitoring. Items 1–9
are pre-approved to merge and deploy one at a time (see **Now**).

1. **app-platform** · M3 · branches `feat-app-platform-p1` … `p5`
   "CTRL+AI 기능 상자" for member apps: a trusted shell around each app on
   apps.ctrlai.my, an SDK (storage, sign-in, AI paid by the visitor, a
   per-app database, files later). **Starts after H1, H2 and H4 of
   RUN-2026-10-15 are deployed.** P1–P4 pre-approved to merge and deploy
   one at a time; P5 branch + tests + WAIT. Supersedes H3 (app-ai-bridge).
   Spec below, saved verbatim. **P1 merged 2026-10-15** (shell, SDK,
   ctrlai.storage; RUN-2026-10-15). **P2 merged 2026-10-15** (sign-in, consent,
   ctrlai.user, ctrlai.ai, kill switch). **When P1 lands:** update the H4 templates
   (`services/project_handoff.py` README / CLAUDE.md, and the showcase
   apps' hand-written guides) to mention `ctrlai.storage` / the SDK, and
   that outside CTRL+AI those calls need replacing — done in P1.
   **P3 merged 2026-10-16** (`739aacb`; `ctrlai.db` — collections as
   (name, kind) pairs after the security review, migration `1cc00c092902`;
   its first drafts were lost with the old computer and it was designed
   again, RUN-2026-10-16). **P4 is built in two halves** (owner,
   2026-10-16): **P4a** = the owner-declared lists (`ctrlai.json`), the
   Builder prompts knowing the SDK, the four templates, the 미리보기's own
   label — **merged 2026-10-16** (`d39d251`, branch `feat-app-platform-p4`); **P4b** — **merged 2026-10-16** (`77f816e`, branch `feat-app-platform-p4b`; RUN-2026-10-16) — = the three showcase apps in LIVE mode (an in-app
   toggle, the demo logic kept; an expensive call shows its maximum
   beside the button first and has a per-call cap), Admin › Apps as a new
   section (Content keeps 신고 and 게시 내리기), `/help/apps`. Each merged
   and deployed after its own report and approval. Decided with the
   split: (a) the security review's stronger recommendation is **in**
   (collections are the owner's to declare — `ctrlai.json`, or the
   owner's first save; `ctrlai.json` is served with the app, it holds
   names only); (b) `app-libraries` (item 8) is reviewed after P4, so the
   templates use no library; (c) AI templates work as a demo when
   `window.ctrlai` is missing or the visitor is signed out — the basis of
   app-ai-access.

2. **app-ai-access** · M3 · branch `feat-app-ai-access`
    *Not pre-approved — branch, test, report, WAIT.* Owner decision
    2026-10-16 (saved in their words below): when publishing an app that
    uses AI, the creator chooses **데모만** or **전체 기능** (changeable
    later); visitors switch between 데모 and 토큰 사용 any time; the
    관리자 can turn AI off per app (today's kill switch). Comes after
    app-platform P4.

3. **quarter-end-apps** · M3 · branch `feat-quarter-end-apps`
    *Not pre-approved — branch, test, report, WAIT.* Owner decision
    2026-10-16: at 분기 마감 every app goes demo-only (AI off) and is
    archived under its quarter; CtrlAIApps opens on this quarter with a
    지난 분기 selector. **Chat history at quarter end is ON HOLD** — the
    owner is asking members first (archive vs delete); do not build it.

4. **builder-python** · M2 · branch `feat-builder-python`
    *Not pre-approved — branch, test, report, WAIT.* Python apps running
    in the visitor's browser through Pyodide, on the static runtime
    (builder-static-runtime, merged). Spec below. Owner, 2026-10-16: wanted
    — "a tetris game", "a 사주 site", made in the Builder and usable on the
    apps origin during the quarter.

5. **app-remix** · M3 · branch `feat-app-remix`
    *Not pre-approved — order to be set by the owner.* From H4's optional
    point 4 (project-export-handoff), split out because it is not small: on
    a published CtrlAIApps listing the owner ticks "다른 회원이 이 앱으로
    시작하기 허용"; other members then get "내 프로젝트로 복사" — a fresh
    Builder project from the **published** version, credited "원작: <이름>".
    Needs a migration (`allow_remix` on the project; `remixed_from_project_id`
    + the credited name kept even if the original is deleted), the toggle in
    the publish dialog, a copy route behind `require_active_member` that
    refuses unpublished/deleted/not-allowed apps (404) and copies no
    HISTORY or requests of the original's owner, the credit on the new
    project and its listing, audit-free (it is a member action), and tests
    (allowed/not allowed, deleted original, own app, inactive member).

6. **owner-polish-2026-10-16** · M1 · one small branch per point
    *Not pre-approved — branch, test, report, WAIT.* The owner's nine
    points from a walk through production (2026-10-16), to start **only
    after the work in progress is done** ("지금 하는 작업 전부 완료 후에").
    Spec below ("owner-polish-2026-10-16"), with what the screenshots
    showed. Two are bugs (3, 8).
    **10 (added 2026-10-16, chat screenshot):** "모션 추가하고 싶다고 한게 …
    뭐 쓰면 그렇게 바로 바로 알림이 안 뜨는 것 같은데..? 약간 모션그래픽
    띠링 이런식으로 하고 싶었던거" — spend-feedback v2. Today
    (feat-spend-feedback) the toast appears only after a reply *finishes*,
    slides in softly (opacity + 10px), and the countdown sits in the
    sidebar's wallet card — which the expanded Admin menu pushes out of
    view. Wanted: a livelier "띠링" moment — a pop/bounce with a coin or
    sparkle, the "-N원" flying to the balance, maybe a short chime (off by
    default or a Profile switch; browsers allow sound only after a click),
    visible wherever the wallet card is. Still only on real `charged_krw`;
    reduced motion keeps a plain toast.

---

7. **ui-improvements** · M1 · branch `feat-ui-improvements`
    *Not pre-approved — promo-videos merged 2026-10-16; once it is deployed, show
    the plan first and WAIT.* Owner, 2026-10-16 (relayed from another
    session): fold **owner-polish 15** (app detail screen) and **owner-polish
    4·5** (thumbnails) together with the UI points below into one bundle.
    The thumbnail method is decided in the plan from 2–3 compared options
    (never running member code on the server, CLAUDE.md §8·§10). Do **not**
    touch owner-polish 6 (video lock) — another session has it. Owner's
    words, verbatim: "그거랑 같이 지금 검색도 이상함 뭔가 선도 끝에랑
    안맞고 (video에는 보면 사용자별 드랍다운이 있는데 여기엔 없어서 그런지
    뭔지 모르겠음) 모든 build, store, 빌드 영상 둘다 나중에 pin이랑 정렬
    (마지막 수정일 이름) 으로 할 수 있게 / 분기 신청기한도 늘릴 수 있게 /
    ai model budget 여기 화면 너무 복잡해 너무 줄줄이 길어 뭔가 차라리
    하나씩 토글해서 볼 수 있으면 나을 듯 / deleted items는 관리자가
    완전히 삭제할 수 있음. 그리고 분기 끝나면 관리자 안 삭제한거
    전체적으로 자동 삭제 (이건 확정) / system도 뭔가 너무 많음;; 걍
    연결상태를 전체적으로 health를 보고 싶은데 아래에 뭐가 저리 많음 /
    그거까지 해서 ui개선". The relaying session's reading of the
    screenshots, to confirm in the plan: (1) the search bar's right edge on
    CtrlAIApps does not line up with the card row (Video has the
    전체/작성 중/게시됨 filter beside it) — align the list screens' header
    rows (Builder, CtrlAIApps, Video, CtrlAITube) on one grid; (2) pin +
    sort (last modified / name, remembered) on the Builder, CtrlAIApps and
    Video lists — pins per member (CtrlAIApps: a member's own favourites),
    one migration if storage is needed; (3) Admin › Quarters: extend an
    application deadline later (within the quarter; audited; whether a
    closed quarter can reopen is proposed in the plan); (4) Admin › AI
    Models and Budget: sections collapsed to a summary, opened one at a
    time, state remembered; (5) Deleted Items: an admin's 완전히 삭제
    (confirm, reason, audit) **and**, at 분기 마감, everything not restored
    is purged automatically (owner's decision) — money rows (`UsageEvent`,
    wallets, audit) are never deleted, so the design must survive the
    project's removal (FKs, name snapshots), app folders and stored files
    go too, and the decision is recorded in CLAUDE.md §2/§4; (6) Admin ›
    System: an at-a-glance health row (server · DB · each provider,
    green/red) on top, the rest (exchange rate, chat limits, depth table,
    `.env` list, builder check) in collapsed sections; (7) owner-polish 15
    and 4·5 as written.

8. **app-libraries** · M3 · branch `feat-app-libraries`
    *Direction, not pre-approved — review after app-platform P4; order to
    be set by the owner.* (Renumbered as items joined and merged on
    2026-10-16.) Owner, 2026-10-16: **"회원이 만드는 앱의 수준을
    높인다."** Member apps have no network (CSP `connect-src 'none'`, no
    CDN), so a game or a chart today means hand-written code. Review a
    bundle of **approved libraries that CTRL+AI hosts itself** on the apps
    origin — `/_ctrlai/lib/<name>@<version>/…` — pinned versions, served
    with the same headers as the SDK, allowed by the member-file CSP
    (`script-src 'self'` already covers the apps origin): **Phaser**
    (2D games), **Three.js** (3D), **Chart.js** (charts), **Leaflet**
    (maps — tiles are a network call, so offline/embedded tiles or a
    CTRL+AI tile proxy would be part of the review), **Tone.js** (sound),
    **p5.js** (creative coding). The Builder's prompt learns the list and
    the `<script src="/_ctrlai/lib/…">` form; the handoff README names
    the CDN equivalents for outside CTRL+AI. Licences (all MIT/BSD),
    sizes and a load-time check belong to the review. **Example apps the
    owner wants:** 테트리스 (Phaser or plain canvas), 사주 (date maths +
    Chart.js/p5 for the chart) — the same two named under builder-python.

9. **dino-avatars** · M3 · branch `feat-dino-avatars`
    *Later item, order unchanged, not pre-approved.* Owner, 2026-10-16
    (decided in another session after four mock-ups; relayed): **"CTRL+AI
    공룡" profile avatars** replace the letter avatar. **No uploaded
    profile photos** — this instead. Decided:
    1. **Egg → dinosaur.** Sign-up gives an egg; the first activity (first
       chat or first project) hatches it into the member's dinosaur.
    2. **Choosing, in this order:** ① species, five — 아기 티라노,
       트리케라톱스, 브라키오, 스테고, 프테라 (the five on the owner's
       reference sheet); ② colour with a picker (saturation square + hue
       bar + hex + eyedropper via Chrome's `EyeDropper` + recent and
       suggested colours); the background colour has the same picker. No
       AI — recoloured in the browser: each drawing has three slots
       (light, dark, black outline); the chosen colour is the light slot
       and the dark slot is derived (HLS lightness ×0.72, saturation
       ×0.85, so deep pinks and reds do not turn harsh). If body and
       background are too close: "바탕과 비슷해서 작게 보면 잘 안 보여요 —
       그래도 할까요?".
    3. **The egg:** the owner's white egg (black outline, cross-shaped
       speckles + shadow, grey shading below); the speckles take the
       chosen body colour.
    4. **Art:** 브라키오 is the owner's own 24×24 pixel drawing (2×2 eyes +
       sparkle + blush read as cute). The other four species must be drawn
       new at 24×24 with the same three-slot colour rule — the reference
       sheet is stock art and is **not** to be used (owner/club members
       draw, or a licensed set). Each species also gets a small face-only
       drawing (about 12×12) for 20–32 px spots — a long-necked dinosaur
       cropped from the full drawing was too small.
    5. **Quarter titles**, decided at 분기 마감 and worn all next quarter,
       with a "지난 칭호" collection on Profile: **천사** (spent ≥ 80 % of
       the wallet **and** published ≥ 1 app or video — spending alone
       would reward waste), **왕** (the 2 members with the most published
       apps, counting only apps actually used, e.g. ≥ 10 visits),
       **팡파레** (the 2 with the most reactions — once app reactions
       exist), **쉬는 중** (not taking part this quarter; a sleeping
       dinosaur, Zzz), **화석** (탈퇴 회원; their apps stay under the fossil
       name). A title is a prop layered over the drawing (halo, crown,
       party hat + confetti, …).
    6. **Still the owner's call:** how often the colour may change — once
       at sign-up (a gift) / any time / once per quarter or title.
    The mock-ups live in the owner's desktop session; the owner shows them
    when the item starts.

## app-platform — full spec

Added by the owner on 2026-10-15. Saved verbatim:

APP-PLATFORM — "CTRL+AI 기능 상자" for member apps (owner decisions 2026-10-15). Supersedes H3 (app-ai-bridge spec). Start after H1, H2, H4 are deployed.
PRE-APPROVAL: merge + deploy for P1, P2, P3, P4 below, one at a time, same PART E rules (backup → update.sh → verify → roll back + STOP on failure). P5 = branch + tests + WAIT. Never call the real Claude API in tests; never touch .env, DNS, cloud resources or repo settings.

OWNER DECISIONS (record in CLAUDE.md §2 "Member app platform" and docs/architecture.md):
1. Who pays for AI inside an app: the VISITOR, from their own 동아리 지원 wallet, through usage.charge() (feature "app_ai", with app project id). Visitor must be an active member this quarter (require_active_member). Creator-pays is a later option, not now.
2. Non-members / signed-out visitors: can open apps and read PUBLIC app data only. AI, writes, files, ctrlai.user → require sign-in; show "CTRL+AI 회원만 쓸 수 있어요" + 로그인 button.
3. Addresses stay path-based (apps.ctrlai.my/<slug>/) for the beta. Isolation comes from a trusted shell + sandboxed iframe (below), not subdomains. Per-app subdomains = later item `app-subdomains` in BACKLOG (note: may need DNS moved to a provider Caddy can do DNS-01 with).

ARCHITECTURE (P1)
- apps.ctrlai.my/<slug>/ now serves OUR trusted shell page (from the backend/static, not member files). The shell embeds the member app in an <iframe sandbox="allow-scripts allow-forms allow-popups allow-modals?"> WITHOUT allow-same-origin (opaque origin), loading the member files from apps.ctrlai.my/<slug>/_app/… served with `Content-Security-Policy: sandbox allow-scripts allow-forms …` as well (defence in depth), CSP default-src 'self', connect-src 'none' for member files, never Set-Cookie. Decide allow-modals: keep alert/confirm blocked (consistent with Builder).
- The member app talks only to the shell via postMessage through the SDK (/_ctrlai/sdk.js, served to the app). The shell accepts messages ONLY where event.source === its own iframe's contentWindow; it knows its slug from its own URL; it makes all API calls same-origin to apps.ctrlai.my/_ctrlai/* (Caddy → api router `app_runtime`), with an app-scoped HttpOnly cookie `ctrlai_app_<slug>` (Path=/_ctrlai/, SameSite=Strict, Secure, host-only) + a required custom header. Member code (opaque origin) can never send those cookies or reach /_ctrlai/* with credentials — add browser tests (Playwright on the built stack) proving: app A cannot call /_ctrlai with credentials; app A cannot impersonate B via postMessage to B's shell; a page opening B's shell in a popup cannot drive it.
- The main site's rules stay: ctrlai.my session cookie host-only, no CORS on the main API, JSON bodies only. The /_ctrlai/* routes are a separate router with their own guard and never accept the main session cookie.
- ctrlai.storage.get/set/remove: per-app, per-visitor key-value kept by the shell in the shell origin's localStorage under a slug-prefixed key (works signed-out; ≤ 1 MB per app). Migrate the existing example/showcase apps and the Builder generation guide from localStorage to ctrlai.storage. Existing published apps keep working (shim: inject a localStorage-like object into the sandbox via the SDK, best-effort, documented).
- Builder preview uses the same shell in a "미리보기" mode.

P2 — sign-in, consent, ctrlai.user, ctrlai.ai
- Sign-in: SDK ctrlai.login() → shell opens top-level ctrlai.my/apps/connect?app=<slug> → if signed in on ctrlai.my, a consent screen: app name, owner display name, what it may do ("Claude 사용 · 1회 약 N원 (최대 200원) · 내 지원금에서 차감", "이 앱에 데이터 저장"), [허용] [거절] → one-time code (60 s, single use) → back to apps.ctrlai.my/<slug>/_ctrlai/callback → shell exchanges it for the app cookie. Consent rows (user, project, scopes, granted_at, revoked_at) + audit. Profile › "연결된 앱" lists and revokes.
- ctrlai.user → { displayName, appUserId } (appUserId = stable per-app pseudonymous id; never email/username/balance).
- ctrlai.ai.ask({ prompt, system?, images?, json?: schema, model?: "fast"|"smart", maxTokens? }) and ctrlai.ai.stream(...) (chunks via postMessage). Server: admin-allowed models only (map fast→Haiku, smart→Sonnet via the catalogue), wallet pre-check, the 200원 per-call cap, a per-visitor daily cap for app AI (new chat_limits setting, default 2,000원/day, audited, 0 = off), per-app rate limit, json schema validation with one automatic retry, our short safety preamble before the app's system prompt, images ≤ 5 MB. Every call = one UsageEvent (user, quarter, provider, app project id) and appears on Usage as "앱 · <앱 이름> · N원" and in the spend toast.
- First AI use in an app shows the consent if not granted. Kill switch: Admin can disable the SDK for an app (immediate 403 with a Korean message in the app).

P3 — ctrlai.db
- Collections per app, two kinds: "private" (each signed-in visitor sees only their own items) and "shared" (everyone can read, signed-in members can write). Items JSON ≤ 4 KB, per app ≤ 5 MB / 2,000 items, per visitor ≤ 30 writes/min. Owner of an item can update/delete it; app owner can delete any shared item; admin can hide/delete. Report button helper in the SDK (ctrlai.db.report) → admin queue. Public read for signed-out visitors on shared collections only.
- Queries: list(collection, { where: simple equality, orderBy: createdAt|field, limit ≤ 100, cursor }), get, save, update, remove, count. No raw SQL, no cross-app access, every query filters deleted projects/apps (CLAUDE.md §10 deleted_at rule).
- Alembic migration; tests for isolation between apps and between visitors, quotas, deleted app → 404.

P4 — make it usable
- Builder's generation/editing prompt knows the SDK (short reference + examples) and uses it when an idea needs AI, shared data or "who is this"; the Builder start screen offers 4 templates: AI 챗봇, 투표·설문, 랭킹 게임, 동아리 게시판 (each small, distinct look, uses the SDK correctly).
- Switch the 3 showcase apps (H2) to LIVE mode when the visitor is signed in (receipt image → ctrlai.ai with JSON schema; itinerary JSON with schema + retry, still restricted to the seeded places; document Q&A = in-browser BM25 → ctrlai.ai answer with sources, "문서에서 찾을 수 없어요" when unsupported), with a toggle back to 데모 데이터. Keep their honest badges ("실제 AI · 1회 약 N원" vs "데모").
- Builder preview: SDK works for the creator as the visitor (charged to the creator, labelled "미리보기 사용 · 내 지원금").
- Admin › Apps (unhide the Content section or add one, defined in sections.ts): per app — owner, published version, AI calls / won today and this quarter, consents, data size, reports; buttons: SDK 정지/재개, 공유 데이터 숨기기. All audited.
- docs/product.md "앱 기능 상자" for members (Korean, plain) + a member-facing help page /help/apps with SDK examples.

P5 — ctrlai.files (branch + WAIT): images/files per app on the VM disk with caps (5 MB each, 100 MB per app, 2 GB total setting), served from apps.ctrlai.my/<slug>/_files/… with nosniff and safe content types; plan for Cloud Storage later.

Everything Korean for members, light/dark, 390px. Progress in docs/progress/RUN-2026-10-15.md with "now on". Final report in Korean: per phase commit + backup, what I must test (with exact steps and test sentences), known risks, and the branch you are on.

---

## After the beta (specced, not in Next)

### app-subdomains

Owner decision 3 of app-platform (2026-10-15): one subdomain per member
app (`<slug>.apps.ctrlai.my`) instead of paths, so apps no longer share
one origin. Needs a wildcard certificate, which Caddy gets only through
a DNS-01 challenge — the DNS may have to move to a provider Caddy can
drive (a DNS change: ask first). Until then the trusted shell + sandboxed
frame (P1) is the isolation.

Added 2026-10-07 (`docs-chat-plus`). Specced now so the beta's design
leaves room for them; **none starts before `prep-beta-launch` has
shipped**, and each has a milestone in [`ROADMAP.md`](ROADMAP.md). Full
specs are at the end of this file; the research behind them is in
[`research/chat-plus-research.md`](research/chat-plus-research.md).

- **signup-google-first** · M3 — sign-up through Google only; the setup
  screen asks for invite code, username, display name, password and its
  confirmation, so every member has both sign-in methods; "비밀번호를
  잊었어요" becomes Google sign-in → set a new password within 10 minutes.
  Added by the owner on 2026-10-14. **Spec only — the beta keeps sign-up
  as deployed.** Spec below.
- **image-generation** · M2 — raster images through an
  `ImageGenerationProvider` (mock first; Gemini image models the first
  real candidate). Waits on the budget-by-provider decision.
- **more-chat-providers** (optional) · M3 — Gemini, Grok, DeepSeek
  (hosted outside China only) or an aggregator as further catalogue
  providers, on the seam `chat-model-choice` left.
- **personal-topup-ui** · M3 — bring personal top-ups back when real
  money may move: unhide Admin › Top-ups, the 개인 잔액 block on Usage
  and the sidebar, the overage opt-in and the top-up request flow
  (`PERSONAL_TOPUP_ENABLED=true`), and the 환불 대기 withdrawal path on
  the member screen. Added 2026-10-14 when `personal-topup-off` turned
  all of it off for the beta; the tables and backend logic were kept, so
  this is UI and a setting, not a rebuild.

**Refactors** (owner, 2026-10-14 — "PART D": backlog only, do not build
yet; each is its own branch; **never squash Alembic migrations**). The
owner's words, kept whole in each line:

- **chore-ruff** — ruff as the backend's linter and formatter, in CI and
  the loop.
- **refactor-charge-flow** — one price→check→call→charge helper for
  chat, the builder starter and video, instead of three hand-rolled
  copies.
- **refactor-session-cookie** — one session-cookie helper; `google_auth`
  stops importing private helpers; one Google-connection endpoint.
- **refactor-libraries** — one library component for Builder and Video,
  fix 프로젝트을, one modal, one `.card`, one fetch-error parser,
  AppGrid/VideoGrid.
- **chore-dead-code** — `MembershipRead`, `AUTO_MODEL_VALUE`,
  `providers.get_status`, `PersonalUsage`, routes no frontend calls,
  dead mock data, duplicated test fixtures into conftest, tests
  importing other tests.
- **chore-naming** — `admin.py` → `video_models`, `models/pricing.py` →
  `chat_models`, season CSS classes, the three `workspace.module.css`.

---

## After the prototype (needs discussion)

**Cost model still under discussion; do not start until the owner
confirms the decisions.**

Moved out of **Next** on 2026-10-02. Both specs below are unchanged — it
is their position that moved, not their content. They are held because
the money question underneath them (what the club buys, per provider,
and how a member's share is decided) is not settled, and four items that
*are* ready were queued behind them.

- **budget-by-provider** · M4 · branch `feat-budget-by-provider`
  The club side of the money: pool per provider, the reserve, purchase
  planning forecast from usage by provider, and the quarter report. Members
  already have one wallet (`single-wallet`); the spec below was rewritten
  for that on 2026-10-08, including **Application flow** and **Application
  and purchase model (decided)**.
- **usage-analytics** · M4 · branch `feat-usage-analytics`
  Admin and member usage charts. **Depends on budget-by-provider** and
  must stay behind it, whenever the two are taken up.

Nothing in **Next** waits on either. The items that would have leaned on
them now use the budgets that exist today, and record the fields these
two will want — so when the cost model is settled, neither has to go
back and fill in history. The three notes below were written for
`budget-by-provider` and still apply whenever it is picked up.

### Funding model — 2026-10-07

Stated by the owner; recorded here so the cost-model discussion starts
from it.

> CTRL+AI is a club and runs by quarter. Members apply before the quarter starts. The club leader (팀장) then buys provider credit for exactly that headcount with the company card and files the receipts in Concur. Expense handling happens outside the app.

What follows from that for the specs below:

- **The "pool smaller than requests" problem mostly disappears.**
  *Application and purchase model* left open what happens when
  auto-approved allocations exceed what the company approves. Here the
  purchase is sized to the applications, so allocations members can
  already see are not cut afterwards.
- **Still open:** what happens to a member who applies after the purchase
  (a second purchase, or the next quarter); the per-provider split has to
  be fixed before the purchase, because credit cannot move between
  providers — **since `single-wallet` (2026-10-08) that split is the
  club's forecast, not the members' choice** (see the next bullet); and what the 팀장 needs from the app as Concur evidence —
  most likely point 6's quarter report (headcount, purchase per provider,
  usage), plus the purchase records in *Application and purchase model*
  point 3.
- **The club still buys per provider, forecast from usage by provider**
  (`single-wallet`, 2026-10-08). Members have one 동아리 지원 wallet each
  and never choose a split; every usage event still records its provider,
  feature, model and native units, and Admin › Budget totals each
  quarter's spend by provider. The 팀장 sizes each provider's purchase from
  that: headcount × the quarter's amount, divided by last quarter's (or this
  quarter's to date) share of spend per provider, plus the reserve.
- **Expense filing stays out of scope.** The app records purchases; it
  does not talk to Concur.

The owner still confirms the decisions before `budget-by-provider` leaves
this section.

Three things to carry into **budget-by-provider**:

- **The Budget section is on** (`single-wallet` turned it on):
  `/admin/budget` lists every wallet and the quarter's spend by provider
  from `GET /api/admin/quarters/{id}/budget`
  (`backend/app/services/quarter_budget.py`). Pools, the reserve and
  purchase records extend that screen rather than adding a new one.
- **A section is named once.** All eleven names live in that same file,
  and screens read them through `sectionLabel(key)` rather than writing
  their own heading. A new section needs an entry there, not a string in
  a component. `__tests__/admin-sections.test.ts` asserts the visible
  list and that every name is English, so adding one touches that test.
- **There is no budget rename any more.** `single-wallet` replaced the
  Build/Video buckets with one wallet, called 동아리 지원 on screen
  (`FUNDING_LABEL` in `frontend/lib/quarters.ts`), and migrated
  `FundingSource` to `community | personal` (migration `e8a4c2f6b1d7`).
  Which provider a charge paid is `UsageEvent.provider`.

---

## UI requests (collected, not started)

New UI requests go here until they are folded into a UI batch.

- **profile-photo** — later. Members keep the **letter avatar** for now
  (owner, 2026-10-16: "letters okay for now", said while asking for
  feedback-screenshots). When it comes: the same upload path as the
  feedback screenshots (bytes checked, re-encoded, EXIF gone), one image
  per member, shown wherever the letter is today.

*(The two UI requests since UI batch 1, **admin-restructure** and
**ui-naming**, were each large enough to get their own item and branch in
**Next** rather than wait for a batch.)*

→ **ui-polish — full spec (merged 2026-10-07)** moved to [`archive/done-specs.md`](archive/done-specs.md#ui-polish--final-ui-pass-merged-2026-10-07). Its decisions that later work inherits are in **Now**.

### ui-library-cards

Raised 2026-10-07, while reviewing `project-video-management`. **Not in
Next** — it waits here until it is folded into a batch or given its own
item. Saved exactly as written by the developer.

> 1. Card header: name and status badge together on the left (name
>    truncates with an ellipsis); ⋯ alone on the right.
> 2. ⋯ discoverable: visible at rest, hit area at least 32×32px,
>    hover/focus state, tooltip "더보기".
> 3. Video cards show a thumbnail: the final version, else the latest, at
>    its real aspect ratio, letterboxed. No version yet → empty frame
>    "아직 만든 버전이 없습니다". Builder cards stay text-only.
> 4. A project with a chosen final version never shows "Draft"; decide
>    the rule in the backend, not only in the card.
> 5. One meta format on both libraries, "수정 18분 전" / "수정
>    2026.10.01", in the normal UI font, not monospace.
> 6. Keep the header "+ 새 영상 프로젝트" button; show the dashed
>    new-project card only as the empty state.
> 7. Video card ⋯ menu: "최종본 다운로드" when a final exists, otherwise
>    disabled with the tooltip "최종본을 먼저 고르세요", using the
>    workspace's download route.
>
> Tests: CSS-contract checks for badge placement and ⋯ size; thumbnail
> picks final over latest and falls back to the empty frame; no "Draft"
> when a final exists; one meta format.

**Status after `ui-polish` (2026-10-07, not merged):**

- ✅ **Item 2** — ⋯ is a 32px button, visible at rest, with hover and focus
  states and the title "더보기".
- ✅ **Item 3** — video cards show the final version, else the latest one
  with a file, at its real aspect ratio and letterboxed; no version →
  "아직 만든 버전이 없습니다". (Shown on top of the card, not as a side
  tile — see the ui-polish decisions above.)
- **Item 4 — superseded** by the ui-polish status decision: a project with
  a final version now shows the **Draft** badge (ready counts as Draft) plus
  the "최종본 선택됨" meta line. The backend rule (a final makes a project
  ready) is unchanged.
- **Item 5 — not done:** the date format is unchanged and stays monospace,
  because the mockup sets it in monospace.
- **Item 6 — not done:** the dashed new-project card is kept next to the
  cards, as the mockup shows it.

**Done on `feat-video-higgsfield-only` (2026-10-07), awaiting merge:**

- ✅ **Item 1** — name and badge together on the left (the name truncates
  with an ellipsis), ⋯ alone on the right. The card also needed
  `grid-template-columns: minmax(0, 1fr)`: without it a long name pushed
  the card into the next column instead of truncating.
- ✅ **Item 7** — "최종본 다운로드" in the video card's ⋯ menu when a final
  with a stored file exists, otherwise disabled with "최종본을 먼저
  고르세요". The list now carries `final_version_has_asset`.
- **Item 4 is settled by the same branch** in the backend: a final version
  makes a Draft (or Generating) project Ready; clearing it returns Ready
  to Draft; Published and Archived are untouched. Not marked done here
  because the developer did not ask for it to be — say so if it should be.

Two notes for whoever builds it, from the work that raised it:

- **Point 4 is a real backend question** (since answered — see above). `status` and `final_version_id`
  are independent columns today, so a project can honestly be `draft`
  with a final version chosen. Deciding it in the card would leave the
  API still saying `draft` to everything else that reads it.
- **Point 7's route already exists** —
  `GET /api/video/projects/{id}/versions/{version_id}/download`, open to
  a member who is not participating this quarter. The card needs the
  final version's id, which `VideoProject` already carries.

---

→ **admin-restructure — full spec (merged 2026-10-01)** moved to [`archive/done-specs.md`](archive/done-specs.md#admin-restructure--full-spec-merged-2026-10-01).

→ **ui-naming — full spec (merged 2026-10-01)** moved to [`archive/done-specs.md`](archive/done-specs.md#ui-naming--full-spec-merged-2026-10-01).

→ **fix-video-workspace-hang — full spec** moved to [`archive/done-specs.md`](archive/done-specs.md#fix-video-workspace-hang--full-spec).

→ **Phase 2 — Chat — full spec (merged 2026-10-07)** moved to [`archive/done-specs.md`](archive/done-specs.md#phase-2--chat--full-spec-merged-2026-10-07).

→ **chat-model-choice — full spec (merged 2026-10-07)** moved to [`archive/done-specs.md`](archive/done-specs.md#chat-model-choice--full-spec-merged-2026-10-07).

→ **single-wallet — full spec (merged 2026-10-13)** moved to [`archive/done-specs.md`](archive/done-specs.md#single-wallet--full-spec-merged-2026-10-13).

→ **prompt-caching — full spec (merged 2026-10-13)** moved to [`archive/done-specs.md`](archive/done-specs.md#prompt-caching--full-spec-merged-2026-10-13).

→ **cost-calibration — full spec (merged 2026-10-13)** moved to [`archive/done-specs.md`](archive/done-specs.md#cost-calibration--full-spec-merged-2026-10-13).

→ **chat-builder-starter — full spec (merged 2026-10-13)** moved to [`archive/done-specs.md`](archive/done-specs.md#chat-builder-starter--full-spec-merged-2026-10-13).

→ **ui-friendly-motion — full spec (merged 2026-10-13)** moved to [`archive/done-specs.md`](archive/done-specs.md#ui-friendly-motion--full-spec-merged-2026-10-13).

→ **deepseek-research — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#deepseek-research--full-spec-merged-2026-10-14).

---

→ **invite-only-signup — full spec (merged 2026-10-13)** moved to [`archive/done-specs.md`](archive/done-specs.md#invite-only-signup--full-spec-merged-2026-10-13).

---

→ **google-login — full spec (merged 2026-10-13)** moved to [`archive/done-specs.md`](archive/done-specs.md#google-login--full-spec-merged-2026-10-13).

## Chat+ — what the three M1 items share

Added 2026-10-07 (`docs-chat-plus`). Members have never used Claude; Chat
should let them try what it can do — read a table, summarise a file, draw
a chart, build a small web page — before the beta opens. Prices and
limits below come from
[`research/chat-plus-research.md`](research/chat-plus-research.md)
(Anthropic's docs, 2026-10-07; won at 1,400원/$).

Rules all three follow:

- **Everything is charged to the member's one wallet** (`single-wallet`;
  these specs said "Build" before 2026-10-08), through the same `charge()`
  as a chat reply, recorded as Claude spend: tokens × the chosen model's
  catalogue price × the rate, rounded up. No flat fees. A failed call is free,
  a stopped reply is charged for what was used — Phase 2's rules.
- **Every file and every preview is the member's own.** Scoped by owner
  like conversations: another member's attachment is a 404.
- **The provider stays behind the adapter.** Attachments travel as
  base64 content blocks, which every provider in the research accepts —
  not Anthropic's Files API, whose file ids are workspace-wide and whose
  uploads cannot be downloaded again (we keep our own copy either way).
- **Mock first.** The mock Claude provider gains canned replies with a
  table, a code block, an HTML page and an SVG chart, so each item is
  built and tested with no key. The mock reports image and PDF token
  counts from the same formulas the estimate uses.

→ **chat-plus-rendering — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#chat-plus-rendering--full-spec-merged-2026-10-14).

→ **member-password-login — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#member-password-login--full-spec-merged-2026-10-14).

→ **admin-and-nav-cleanup — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#admin-and-nav-cleanup--full-spec-merged-2026-10-14).

→ **privacy-and-terms — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#privacy-and-terms--full-spec-merged-2026-10-14).

→ **chat-plus-files — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#chat-plus-files--full-spec-merged-2026-10-14).

→ **chat-plus-artifacts — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#chat-plus-artifacts--full-spec-merged-2026-10-14).

→ **prep-beta-launch — full spec (merged 2026-10-13)** moved to [`archive/done-specs.md`](archive/done-specs.md#prep-beta-launch--full-spec-merged-2026-10-13), with its Launch data rules and **Hosting decisions — 2026-10-13**.

---

→ **ui-tube-watch — full spec (merged 2026-10-02)** moved to [`archive/done-specs.md`](archive/done-specs.md#ui-tube-watch--full-spec-merged-2026-10-02).

→ **ui-apps-detail — full spec** moved to [`archive/done-specs.md`](archive/done-specs.md#ui-apps-detail--full-spec).

→ **cost-clarity — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#cost-clarity--full-spec-merged-2026-10-14).

→ **fix-quarter-form-autofill — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#fix-quarter-form-autofill--full-spec-merged-2026-10-14).

→ **feat-spend-feedback — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#feat-spend-feedback--full-spec-merged-2026-10-14).

## signup-google-first — full spec

After the beta · M3 · branch `feat-signup-google-first`. Added by the
owner on 2026-10-14. **Spec only: sign-up stays as deployed for the beta**
(Google, or invite code + username + email + password). Saved as written:

> sign-up through Google only, setup screen requires invite code + username + display name + password + confirm; every member has both methods; "forgot password" = Google sign-in → set new password within 10 minutes.

Notes for whoever builds it:

- **Linking stays by Google's `sub`** (CLAUDE.md §5), never by email; the
  setup screen is the one `google-login` already shows after a first
  Google sign-in, with the password and confirmation added.
- **"Within 10 minutes"** means a short-lived, single-use grant created
  by a fresh Google sign-in (a row with an expiry, not a cookie flag),
  consumed by the set-password form; the existing password-change rules
  (Argon2id, attempt limiter, sessions ended) apply.
- **Existing username/password-only accounts** keep signing in as today
  and are asked to link Google from Profile; nothing is migrated.
- The operator's `set_password` CLI stays as the fallback for a member
  without access to their Google account.
- Update the terms' §3 sentence ("비밀번호를 잊으면 운영진에게 알려
  주세요") when this ships.

## budget-by-provider — full spec

Branch `feat-budget-by-provider`. **Rewritten on 2026-10-08 for
single-wallet**: the developer's original spec — two budgets per member,
named by provider — is archived word for word in
[`archive/done-specs.md`](archive/done-specs.md#superseded-by-single-wallet-2026-10-08).
What follows keeps every point that still applies to one wallet per member
and says what single-wallet already delivered. **Still deferred:** do not
start until the owner confirms the cost model.

**What single-wallet already did.** One 동아리 지원 wallet per member per
quarter (80,000원 default, per quarter, audited); Chat, video and the
prompt helper all spend from it; `FundingSource` is `community | personal`;
every `UsageEvent` records provider, feature tag, model, native units, USD
cost and the rate; Admin › Budget lists every wallet and the quarter's spend
**by provider** (wallet vs personal, provider cost, units, share, and the
wallet total divided by that share). Estimated costs beside Chat and video
buttons compare against the one balance.

**What is left — the club side.** Members no longer split anything, but the
club still buys credit **per provider** (Anthropic, Higgsfield), and credit
cannot move between providers once bought. So the per-provider split is now
the club's **forecast from usage by provider**, not the members' choice.

1. ~~Two budgets per member named by provider~~ — **replaced by
   single-wallet.** Nothing is renamed; members have one wallet.
2. **The ledger** — done, except Higgsfield's native unit: when the real
   Higgsfield adapter lands, record Higgsfield credits as the native unit
   (seconds today). Conversion rates already live in an admin-editable table
   with history (USD→KRW); add Higgsfield's credit→KRW rate there if its
   prices are in credits.
3. **Club pool per quarter and provider.** The admin enters the
   company-approved amount for Claude and for Higgsfield. The backend refuses
   to approve a wallet if **all wallets plus the reserve** would exceed the
   **total** pool (KRW, both providers together). Per provider, the pool is
   tracked against that provider's spend: a warning card when a provider's
   spend reaches 80% of its pool. *Open question for the owner:* when one
   provider's pool runs out while wallets still hold money, does the backend
   refuse that provider's features, or does the 팀장 top up that provider
   from the reserve?
4. **Reserve.** By default 20% of the total pool is held back; the admin can
   change the percentage per quarter. Members can request extra from Usage
   with a short reason; the admin approves or rejects in Admin; an approval
   **adds to that member's one wallet**, paid from the reserve, audited.
5. **Pool dashboard per provider** — extends Admin › Budget: approved pool,
   actually used, remaining, the reserve, usage by feature tag, and a
   **forecast** (spend so far ÷ days elapsed × days in the quarter).
6. **Quarter report.** A CSV (and on-screen summary) per quarter with usage
   by provider and feature, native units and KRW, active members, wallet
   utilisation, and each provider's share — the basis of the next funding
   application and purchase.
7. **Member side.** Usage shows the one wallet with its 채팅 / 영상 / 기타
   breakdown (done). Add a one-time notice at 80% of the wallet used.
   Estimated cost next to every paid action (done for Chat and video; every
   later paid action must do the same).
8. ~~Members cannot move budget between providers~~ — moot. Instead: **the
   club cannot move credit between providers**, so purchase planning
   (below) forecasts each provider from usage by provider.

Tests: wallets plus reserve cannot exceed the total pool; the default
reserve is 20%; reserve requests add to the member's wallet and deduct from
the reserve; usage events store native units and the rate; rate changes do
not alter past events; the CSV totals match the database; the per-provider
forecast matches the ledger.

### Application flow

Rewritten 2026-10-08 for single-wallet (original archived).

1. ~~Application form presets and splits~~ — **gone.** "이번 분기 참여"
   applies for the quarter's one amount (done in single-wallet).
2. **신청 합계 view** in Admin: number of applicants, total requested
   (applicants × the quarter's amount), list of members who have not applied
   with the deadline countdown, and a CSV export for the company
   application. Show the **suggested company request per provider** = total
   requested × each provider's forecast share (last quarter's usage by
   provider, or an admin-entered share for the first quarter) + reserve
   (default 20%, on top of member totals, not taken out of them).
3. After the company decides, the admin enters the approved pool per
   provider. If the total pool covers all wallets plus reserve, approvals
   give members the full amount. If it is smaller, show a proportional cut
   preview per member before applying, then hold the reserve at the
   configured percentage of the approved pool.
4. Approving: single approve, approve with adjustment (changed amount,
   required reason, audited), bulk approve with one confirmation, reject
   with a reason the member sees on Profile.
5. Active status and budget go together: a member becomes active for a
   quarter through an approved application, or through admin enrolment that
   also creates a wallet. Active without a wallet shows a warning in Admin,
   and the member's sidebar says clearly that no support is approved yet.
6. Tests: totals match applications; the suggested request per provider
   uses the forecast share and includes the reserve on top; the
   proportional cut never exceeds the pool; adjustments and bulk approvals
   are audited; rejected members see the reason; active-without-wallet
   shows the warning.

### Application and purchase model (decided)

Rewritten 2026-10-08 for single-wallet (original archived). **This section
wins where it conflicts with Application flow above.** Auto-approval is the
normal path: a member presses "이번 분기 참여" and the wallet exists
immediately. The approval tools in Application flow point 4 serve **수동
승인** mode and the exceptions in point 1.

**Point 6's operator note** goes to `docs/deployment.md`, which
`prep-beta-launch` creates; if this item lands first, write it into a new
`docs/operations.md` and have whichever lands second point at the first.

1. **One-click application with auto-approval.** During the application
   period a member presses "이번 분기 참여" and receives the quarter's
   amount — no split, nothing to adjust. The admin can switch a quarter to
   "수동 승인" mode; exceptions (late applications, reserve requests) still
   reach the admin.
2. **Purchase planning** (Admin › Budget), after the application period:
   suggested purchase per provider = member total × the provider's forecast
   share + reserve (default 20%, on top) − usable balance carried over from
   earlier purchases. KRW total and, for Claude, the USD equivalent at the
   current rate.
3. **Purchase records:** provider, date, amount paid in KRW and original
   currency, credits received, expiry. Claude credits expire one year after
   purchase; warn 30 days before any purchased credit expires.
4. **Provider balance tracking:** per provider, purchased − used = remaining
   club balance, on Admin › Budget and the dashboard; a warning card when a
   provider's remaining balance falls below its share of the reserve.
5. **Carry-over:** unused, unexpired balance carries into the next quarter
   and reduces that quarter's suggested purchase.
6. **Docs:** keep auto-reload OFF in the Anthropic Console and any
   Higgsfield equivalent, and top up manually from the reserve.

Tests: auto-approval creates the wallet immediately; manual mode routes to
신청 승인; the suggested purchase uses the forecast share, includes the
reserve and subtracts carry-over; balances equal purchases minus usage;
expiry warnings appear 30 days before.

---

## usage-analytics — full spec

Branch `feat-usage-analytics`. Added 2026-10-01; **updated 2026-10-08 for
single-wallet** (the original is archived with budget-by-provider's in
[`archive/done-specs.md`](archive/done-specs.md#superseded-by-single-wallet-2026-10-08)).
Still deferred with budget-by-provider; it reads that item's pools.

What changed: members have one wallet, so nothing here is "a member's
Claude budget" or "Video budget". Spend is broken down **by provider and
model** for the club (what to buy) and **by 채팅 / 영상 / 기타 and feature**
for the member (what they did). The `UsageEvent` fields it reads —
provider, feature tag, model, native units, KRW, rate — all exist since
Phase 2 / video-higgsfield-only / single-wallet, so point 1 is done.

1. ~~Record the exact model on every UsageEvent~~ — done (`model_id`).
2. Admin › 사용량 분석 (`/admin/analytics`), admin-only, added to the Admin
   tabs, sidebar sub-menu and dashboard cards:
   - Time-series charts by day or week, within a quarter or a custom range.
   - Breakdown by provider and by model, with a toggle for the measure: KRW,
     native units (Claude tokens split into input/output; Higgsfield credits
     and video seconds), or request count.
   - Filters: quarter, provider, model, feature tag (chat / build /
     video_prompt / video_generate / video_edit / video_extend), member.
   - Summary cards: total KRW per provider, the most-used model per
     provider, average cost per request, share of each provider's pool used,
     and wallet utilisation (consumed ÷ budget across all wallets).
   - Top members by usage, a data table matching the chart, and CSV
     download of exactly what is shown.
3. Member side: Usage gets a "내 사용량" chart of their own wallet over the
   current quarter by 채팅 / 영상 / 기타 (the existing breakdown) and
   feature. Members never see other members' data.
4. Charts use one charting library consistent with the design tokens (dark
   theme; provider colours Claude = build accent, Higgsfield = video
   accent), Korean labels, tooltips with exact values, tabular numbers, a
   Korean empty state.
5. Development data: the dev-only usage simulator already records provider
   and feature (single-wallet); add a model choice and a dev-only "샘플 사용
   기록 생성" that creates 30 days of realistic usage across members and
   models. Both unavailable outside `APP_ENV=development`.
6. Performance: aggregate in the database (grouped queries), not in the
   browser — as Admin › Budget already does.

Tests: totals in the charts and the CSV match the database; filters change
the results correctly; members cannot request other members' data;
analytics routes are admin-only; sample-data tools return 404 outside
development.

---

→ **project-video-management — full spec (merged 2026-10-07)** moved to [`archive/done-specs.md`](archive/done-specs.md#project-video-management--full-spec-merged-2026-10-07).

→ **test-database-isolation — full spec (merged 2026-10-13)** moved to [`archive/done-specs.md`](archive/done-specs.md#test-database-isolation--full-spec-merged-2026-10-13).

## owner-polish-2026-10-16 — owner's words and what production showed

Added by the owner on 2026-10-16 with screenshots of ctrlai.my (Chat,
Project Builder, Video Generator, CtrlAIApps, CtrlAITube, Admin ›
Dashboard / Members / System, Profile): "이것도 일단 백로그에만 추가 —
지금 하는 작업 전부 완료 후에." Saved as written, each with a note:

1. **"초대코드 수용인원 늘릴 수 있게"** — Admin › Members › 초대 코드: an
   existing code's 최대 가입 수 can be raised later (today it is set only
   at creation; the one code is 소진 1/1). Audited; never below the uses
   already made.
2. **"프로필 정리 뭔가 알림 같은 것도 추가하면 좋겠어. 게시가
   완료됐습니다 ! 사용이 차감됐습니다 etc"** — a tidier Profile and a
   member-facing notification list (게시 완료, 지원금 차감, 신청 승인, …).
   Today only the passing spend toast exists (feat-spend-feedback).
3. **"내가 만든 앱은 프로필에 안 뜸"** — bug: Profile › 내가 만든 앱 says
   "준비 중 · 아직 게시한 앱이 없어요" while the admin's 여행 일정 메이커 and
   the showcases are published. Read the member's published apps there.
4. **"게시할때 프로젝트 읽어서 압축해서 썸네일 만드는 기능"** — a
   thumbnail made at 게시 (render the published version, store a small
   image) for CtrlAIApps cards and the Builder list. Rendering must not
   run member code on the backend (CLAUDE.md §8, §10) — e.g. a headless
   browser in an isolated container, or a capture in the creator's
   browser at publish time.
5. **"draft도 저렇게 뭔가 썸네일 비슷하게"** — Builder project cards show
   a striped "미리보기 썸네일" placeholder today; drafts get a thumbnail too
   (same mechanism as 4, from the working copy).
6. **"영상은 다음다음분기에 시작할거임.. 그래서 일단 전체 화면에 락
   걸어두면 될 것 같아. 안보이게. 연결은 미리 해두러다로 이번 분기에는
   추가 안할거임"** — Video Generator starts two quarters from now: lock
   the whole Video area for members this quarter (hidden or a locked
   screen, behind a switch the 관리자 controls); keep the provider wiring;
   no new video work this quarter.
7. **"AITube는 홍보 영상 하나 있거든 그거 추가로 해서 지금 영상은
   준비단계이지만 홍보영상에는 댓글 달 수 있게 할 있기"** — CtrlAITube:
   add the club's one promo video (the owner supplies the URL); the page
   stays 준비 중, but the promo video takes real comments. The three
   current cards are sample data.
8. **"미신청에 유저가 왜 안뜨지"** — bug: Admin › Members shows **미신청
   1명** on the card, but filtering 참여 = 미참여 lists nobody (0개 / 전체
   2개) while both listed members are 활동 회원. Find which account the
   card counts (perhaps one the list hides) and make card and filter agree.
9. **"이름도 변경 가능하게? 아이디는 못바꾸지만 비번이랑 이름은 바꿀 수
   있게.. 가능하면 프사도 ? 사실 크게필요없긴 해"** — Profile › 계정 설정:
   display name editable (아이디 fixed); password change exists already
   (로그인 방법 › 바꾸기); a profile picture optional, low priority.

(Point 10, a livelier "띠링" spend notification, is in the Next entry
above.)

13. **Builder › Claude 판 — a project that has only imported versions
    shows the same content twice** (owner, 2026-10-16): when every version
    came from 예시 앱 / 가져오기 (no `BuilderGeneration` behind it), the
    conversation-style history (Q3) and the compact "모든 버전 (n)" list
    below it show the same rows. Show one or the other for such projects
    — e.g. hide the history until the first Claude-made version, or fold
    "모든 버전" when it would repeat the history.

15. **CtrlAIApps 앱 상세 — "뭔가 너무 화면이 비효율적"** (owner,
    2026-10-16, screenshot of '동아리 게시판' v5, relayed from another
    session). What the screenshot showed: the top half of the detail screen
    is a colour-gradient placeholder block repeating the app's name; the
    live app frame sits below it and needs a scroll; 앱 실행 duplicates the
    frame right under it. Proposal: a one-line head (small thumbnail or
    icon · name · maker · vN · description folded/unfolded · 새 창에서 열기 ·
    신고), the app frame taking most of the first screen (nearly the
    desktop height, visible at once at 390px), long descriptions below;
    once thumbnails exist (points 4–5) use them small in the list cards and
    the head and drop the big placeholder block. Also make the screen's
    honest note per app: when the app's `ctrlai.json` declares a shared
    list, say "이 앱의 공유 글은 다른 회원도 볼 수 있어요"; otherwise the
    plain sentence (P4b already replaced the pre-P3 wording with a general
    one that mentions login, AI and shared lists).

11. **"뭔가 한번 끊기면 비용 예측해서 ex 진짜 많이 쓰일 수도 있는데
    가겠냐고 물어보고 그냥 쭉 할 수 있게 (중단도 가능하니)"** (2026-10-16,
    after a 강아지 SVG on Opus · 보통 stopped twice at the 200원 cap) —
    when a reply stops at max_tokens or the per-reply cap, show the
    estimated cost to finish ("끝까지 쓰면 약 N원 · 최대 M원") and one
    question; on yes, continue **in one go** to the end with 중지 always
    available, charging the actual usage per call (each call still behind
    the wallet pre-check; a ceiling for the whole run that the member
    sees). Also: (a) the system prompt must not promise to "finish in one
    go" or restart from scratch at the cap — continue where it stopped, or
    suggest a cheaper model / higher depth; (b) the preview joins a code
    block split across 이어서 쓰기 replies.
12. **"이미지 생성 모델 쓸만한거 있을지 소량 api 혹은 구글서버니까 제미나이
    무료 해서 가져올 수 있는지까지"** — research only so far; a real
    provider is a paid resource (CLAUDE.md §10: ask first). Checked
    2026-10-16 on Google's pricing page (ai.google.dev/gemini-api/docs/pricing):
    **no free API tier for any image model**; paid per 1K image ≈ $0.034
    (Nano Banana 2 Lite `gemini-3.1-flash-lite-image`, Nano Banana 2.1),
    $0.067 (Nano Banana 2 `gemini-3.1-flash-image`), $0.134 (Nano Banana
    Pro); Batch half price; `gemini-2.5-flash-image` shut down 2026-10-02.
    Free use is only in the consumer Gemini app (not an API). Other
    options (third-party roundups, unverified): FLUX.2 [klein] ≈ $0.014,
    FLUX.2 [pro] ≈ $0.03, OpenAI gpt-image-2 ≈ $0.05–0.06 medium. At
    1,400원/$ a $0.034 image ≈ 48원. **Cheapest found ("싼 이미지 토큰 있는지",
    same day): Cloudflare Workers AI** (official pricing page,
    developers.cloudflare.com/workers-ai/platform/pricing): 10,000 neurons
    free per day, then $0.011 / 1,000 neurons; one 1024² image ≈ 58 neurons
    on FLUX.1 schnell (4 steps — step billing not fully stated) or ≈ 104 on
    FLUX.2 klein 4B (≈ $0.0011 ≈ 1.5원; ≈ 95 free images a day). Lower
    quality and weaker editing than Nano Banana; English prompts work best
    (Claude can write them, as the video prompt helper does). Possible
    plan: Cloudflare klein 4B as the default, Gemini as a 고품질 option. Whether the GCP free-trial credits
    cover Gemini through Vertex AI is **not checked**. If approved: an
    `IMAGE_PROVIDER` (mock default) behind the provider interface,
    charged through `usage.charge()` (feature `image`), images stored like
    chat attachments, a price shown before each image, and the chat
    routing "그려 줘" to it instead of SVG.
14. **"만드는중인데..? 이러면 🚫 커서에 이렇게만 뜸. 뭔가 생각을 하고
    있다는 UI를 만들었음 좋겠어. 채팅도 그럼.. 뭔가 도로록..."**
    (2026-10-16, screenshot of /builder/12 during 고치기) — a "working"
    UI with motion. Today: the disabled 고치기 button shows the browser's
    🚫 not-allowed cursor; the plan card's step circles stay empty until a
    whole file is done (20–60 s of nothing moving); Chat shows only "•••".
    Wanted: Builder — the button becomes "만드는 중…" with a spinner and
    `cursor: progress` (never 🚫), the current step's circle spins and the
    row says "index.html 작성 중…" with an elapsed timer, finished steps
    tick ✓ with a small pop, a thin progress bar (n / m 파일), and if
    feasible the file text streaming in a small "도로록" typing view
    (needs the run stream to send text deltas, not only file_start/done).
    Chat — "생각하는 중…" with a shimmer and elapsed seconds until the
    first words, then text that flows in smoothly with a caret at the end.
    Reduced motion: no animation, the text and timer stay. Pairs with
    point 10 (the 띠링 spend moment).

---

## app-ai-access, quarter-end-apps, feedback-screenshots — owner's words

Added by the owner on 2026-10-16 (this computer's first session after
RUN-2026-10-15). Saved as written, then the answers to three questions:

> i wanted the people to be able to 배포 their app on the server, if it
> uses AI, after they 배포 it, using the page they can use their tokens to
> use the app. also, if other users want to use it, they can check for
> demo / Token Use and if they select token they use their own tokens..?
> and the 관리자 can make it.
>
> so then, also for server issues, after a 분기 is finished, all apps are
> turned off from server, only accessible for demo version. also they are
> archived, the main 화면 is this quarter's you can select if you want to
> see prev quarters. the chat's history are also all reset. after a
> quarter is finished.
>
> anonymous-feedback-board: … no not this. no board only 관리자 can see
> it. and also be able to put in screenshots to their feedback
>
> builder-python: … i want to be able to create a platform so when a
> person is like oh i want to make a tetris game or oh i want to make a
> site that 사주 etc i can deploy it to the server and i can access it
> during the 분기

Answers (2026-10-16):

- **Who controls 데모 / 토큰 사용:** "when publishing to app, creator sees
  like: this app uses AI. are you going to open AI features (ex. xxxx) to
  other users? pick only demo, full features (can change later). users can
  turn off anytime and so can 관리자."
- **Chat history at quarter end:** on hold — "i need to ask with members
  before". (Note for whoever builds it: CLAUDE.md §4 says work never
  disappears; deleting chats would change that rule — archive is the
  version that keeps it.)
- **Order:** finish quality-tuning Q3 first, then app-platform, then these.

Already true before this (so not new work): a published app is served on
apps.ctrlai.my and listed in CtrlAIApps; AI inside an app is paid by the
signed-in visitor from their own 동아리 지원 wallet (app-platform P2); the
관리자 has a per-app kill switch. Member code still never runs on the
server (CLAUDE.md §8, §10) — apps, Python ones included, run in the
visitor's browser.

Open design points for app-ai-access: how "this app uses AI" is detected
(the published files call `ctrlai.ai`); what 데모 shows for an app that is
not a showcase (the Builder prompt writes a demo answer for every AI call,
P4 territory); where the visitor's switch lives (the shell, so every app
gets it the same way).

---

## anonymous-feedback-board — full spec

Branch `feat-feedback-board`. Added by the owner on 2026-10-13. Saved
exactly as written:

> anonymous-feedback-board (extends the feedback from prep-beta-launch): a member-facing page where everyone can read the improvement notes members sent, shown with no name. The author's user_id stays in the database, never shown to members, only for rate limits and abuse. Admin can hide a note. Admin gets "Claude용으로 내보내기": a Markdown file of the notes (date, page, body, no names) filtered by date range, so I can give it to Claude Code and ask for UI/system improvements.

**Depends on:** `prep-beta-launch` (the `feedback` table, merged
2026-10-13) and `invite-only-signup` (the board is for members only).

1. **The board.** A page every signed-in account can read (guard
   `get_current_user`: reading spends nothing, so participation is not
   needed). Newest first, paginated. Each note shows the body, the date,
   and the **screen section** it came from ("Video Generator", "Chat"),
   not the raw path: `/video/12` carries a project id that can point at
   its owner. The menu name follows the English-menu rule (section 15):
   proposed **Feedback**, under Account next to Report Issue.
2. **No name anywhere a member can see.** The member-facing schema has
   no `user_id`, username or display name, and a test asserts the JSON
   keys. The author's id stays in `feedback.user_id` for the hourly limit
   and abuse handling only. In a club of about 40, wording and timing can
   still give a person away, so the dialog says so.
3. **The promise already made.** Notes sent so far were sent under
   "운영진만 읽습니다" (the dialog's text since 2026-10-13). They **stay
   off the board**: a migration marks them not public. Only notes sent
   after the dialog's new text, "다른 회원에게 이름 없이 보입니다", appear.
   Decide at build time whether the dialog also offers "운영진만 보기" for
   a note the member does not want public (recommended: yes, default
   public).
4. **Admin hides a note**: `hidden_at`, `hidden_by`. A hidden note leaves
   the board at once and stays in Admin › Feedback, marked. Hiding and
   un-hiding are audited (`feedback.hidden`, `feedback.unhidden`).
5. **Claude용으로 내보내기.** In Admin › Feedback: a date range (from / to,
   KST days) and 숨긴 의견 포함 (off by default). Downloads
   `ctrlai-feedback-<from>_<to>.md`: a header with the range and count,
   then one block per note with date, full page path and body. **No
   names, no ids.** Markdown in bodies is escaped so a note cannot break
   the file's structure. `GET /api/admin/feedback/export?from=&to=&include_hidden=`,
   `require_admin`, audited (`feedback.exported`, with the range and count
   only).
6. **Tests:** members see no author fields; hidden notes are absent for
   members and present for admins; notes sent before the change are not
   shown; the export has no names or ids, honours the range and the
   hidden switch, and escapes Markdown; only admins can hide or export;
   the access table and `EXPECTED_GUARDS` gain the new routes.

**Risks:** de-anonymisation in a small club (point 2's copy, point 1's
section instead of path); abusive or personal notes visible until an
admin hides them (the hourly limit stays; hiding is immediate).

### Owner decision — 2026-10-13 (revises the spec above)

Decided by the owner on 2026-10-13; **where this conflicts with the
points above, this wins.** Saved exactly as written:

> - No new Feedback menu item: Report Issue (/issues) itself becomes the board. Members write a note there (no GitHub account needed) and read everyone's public notes with no names. Remove the "GitHub에서 신고하기" link for members.
> - Admin › Feedback: the admin selects notes and presses "GitHub로 보내기". Nothing is ever sent automatically. Only notes public on the board can be selected; notes sent under "운영진만 읽습니다" and any "운영진만 보기" note can never be sent.
> - Before sending, Claude (catalogue default model, through the provider interface, mock by default) groups similar notes and drafts one issue per group in Korean: 문제, 어디서 (screen section name only, never the raw path or any id), 재현 방법, 수정 제안, 완료 기준, labels (ui / bug / feature / cost). The admin can edit or drop each draft, then confirms. Show the cost estimate first. Record the Claude call in the ledger as club/admin usage without spending any member's wallet; if the ledger cannot do that cleanly, write the question in the progress file and build the rest.
> - Issues go through a new FeedbackIssues provider behind its own setting FEEDBACK_ISSUES_PROVIDER=mock|github (mock records what it would have sent). Separate from GITHUB_PROVIDER, which stays reserved for Phase 4's per-member GitHub App. Real mode uses one server-only token owned by the club operator (not a member; CLAUDE.md's no-member-PAT rule is unaffected) with Issues read/write on anoukkim/ctrl-ai-platform only, in the server .env, never shown in the UI or logs.
> - The repository is public: the issue body has no names, emails, user ids or project ids, and the confirm screen says so.
> - Each note remembers its issue (link in Admin; "반영 중" on the board). Sending a note twice is refused. Audited (feedback.sent_to_github).
> - Keep "Claude용으로 내보내기" (the Markdown file).
> - docs/deployment.md: how I create the fine-grained token (this repo only, Issues read/write) and the .env lines, as a later step.

What this changes in the points above:

- **Point 1's page and menu name are replaced:** the board is the Report
  Issue page (`/issues`), no new menu item. The 의견 보내기 button
  elsewhere (sidebar, beta banner) stays and writes to the same board.
- **Points 2–6 stand** (no names, the earlier staff-only notes kept off
  the board, the "운영진만 보기" choice, hiding, the Markdown export, the
  tests), plus the GitHub sending above and its tests: only public notes
  can be selected, a note is sent once, the issue body carries no names,
  emails, user ids or project ids, nothing is sent without the admin's
  confirmation, the token is never returned or logged, and the mock
  records what it would have sent.

### Owner decision — 2026-10-14 (admin-and-nav-cleanup; wins over both above)

Report Issue and `/issues` are gone (`/issues` redirects to Chat). **No
menu item, no `/issues`.** The **의견 보내기** button in the sidebar
footer stays the one way to send a note; the member board is a page of
its own, reached from a **"다른 의견 보기"** link inside the 의견 보내기
dialog (not from the menu). Everything else above stands.

→ **token-guard — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#token-guard--full-spec-merged-2026-10-14).

→ **live-cost-display — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#live-cost-display--full-spec-merged-2026-10-14).

→ **chat-thinking-view — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#chat-thinking-view--full-spec-merged-2026-10-14).

## builder-python — full spec

Branch `feat-builder-python`. M2. Added by the owner on 2026-10-13. Saved
exactly as written:

> builder-python (extends chat-builder-starter and builder-static-runtime): members can also make small Python apps from Builder, with a working example, and publish them. Python must run in the visitor's browser only (Pyodide or PyScript, loaded from a pinned version), never on our server — CLAUDE.md section 20's rule that member code never runs on the backend stays. Same file, size and sandbox rules as the static apps. Note the cost and load time of Pyodide in the spec.

**Depends on:** `chat-builder-starter` (merged) and **Half 2 of
`builder-static-runtime`** (the separate apps origin, *After the beta*).
Today's preview is an `<iframe srcdoc>` whose CSP blocks all network, so
Pyodide could not be fetched into it; the served apps origin is where it
can load.

1. **What a Python app is:** the same static project, `index.html` plus
   `.py` files, where the page loads Pyodide and runs the Python in the
   browser (WebAssembly). `.py` joins the allowed file types; the file
   count and the per-file and per-project size limits are the static
   app's. Nothing is ever executed by the backend, and a test asserts no
   route imports or runs member files.
2. **Pyodide, pinned and self-hosted.** One exact Pyodide version, chosen
   at build time from the current release, served from the apps origin
   itself (`/_runtime/pyodide/<version>/`) rather than a public CDN, so
   the apps' CSP can stay `script-src 'self'` and no third party sees
   visitors. The CSP adds `'wasm-unsafe-eval'`, which WebAssembly needs.
   Upgrading the version is a deliberate change, never automatic.
3. **Starter example:** "파이썬으로 만들어 줘" in Chat or Builder makes a
   small working example, such as a calculator or a word counter (HTML
   inputs, Python logic, output on the page). Same generation pipeline,
   pre-check and charge as the static starter.
4. **Publishing:** exactly as a static app on CtrlAIApps, with a "Python
   앱 — 처음 열 때 몇 초 걸려요" note on the listing.
5. **Packages:** only Pyodide's bundled standard library at first.
   `micropip` installs from the internet are blocked by the CSP
   (`connect-src 'self'`); adding chosen packages (numpy, pandas) later
   means self-hosting those wheels too.

**Cost and load time** (the owner asked for these; estimates, to be
measured):

- **Our cost:** no server CPU, because Python runs on the visitor's
  device. Claude generation costs the same as for a static app (tokens,
  pre-checked). Disk: one self-hosted Pyodide core is roughly 10–15 MB
  (the WebAssembly binary and the packed standard library), shared by
  every app; numpy or pandas add tens of MB each. Bandwidth: the first
  visit to any Python app downloads those ~10 MB (less compressed); the
  browser caches them, and every app on the same origin reuses the
  cache.
- **The visitor's load time:** a first open takes roughly 3–10 seconds on
  a laptop with broadband, longer on a phone on mobile data; later opens
  take a second or two (cached runtime, Python start-up). The page shows
  "파이썬을 준비하고 있어요…" while it loads. Measure on the beta VM and a
  phone before quoting figures to members.
- **Pyodide or PyScript:** PyScript is a friendlier layer on top of
  Pyodide (Python in HTML tags), at the price of one more pinned
  dependency. Recommended: plain Pyodide with a small loader the starter
  writes; decide at build time.

**Tests:** `.py` accepted within the limits and server-side files still
refused; the apps origin serves the pinned runtime with the CSP above
(`script-src 'self'`, `'wasm-unsafe-eval'`, `connect-src 'self'`) and no
`Set-Cookie`; no backend route executes member code; the starter produces
an `index.html` that loads the pinned runtime.

**Risks:** load time on phones; memory on low-end phones; a member app
that loops forever freezes only the visitor's tab (the sandbox, and a
멈추기 control in the preview); the pinned Pyodide version ageing (review
it yearly).

→ **account-withdrawal — full spec (merged 2026-10-07)** moved to [`archive/done-specs.md`](archive/done-specs.md#account-withdrawal--full-spec-merged-2026-10-07).

→ **video-higgsfield-only — full spec (merged 2026-10-07)** moved to [`archive/done-specs.md`](archive/done-specs.md#video-higgsfield-only--full-spec-merged-2026-10-07).

→ **Archived specs** moved to [`archive/done-specs.md`](archive/done-specs.md#archived-specs).

→ **chat-plus-tools — full spec (merged 2026-10-14)** moved to [`archive/done-specs.md`](archive/done-specs.md#chat-plus-tools--full-spec-merged-2026-10-14).

## image-generation — full spec

After the beta · M2 · branch `feat-image-generation`. Effort: **M** (3–5
days). Added 2026-10-07. **Waits on the budget-by-provider decision**
(see *After the prototype*).

1. **Claude cannot make raster images** (Anthropic's docs). What Chat can
   already do without this item: SVG, HTML and chart code, previewed by
   `chat-plus-artifacts` — token cost only (≈ 14–42원 Haiku, 28–84원
   Sonnet for a typical drawing).
2. **A provider interface with a mock**, as for video:
   `ImageGenerationProvider` behind `IMAGE_PROVIDER` (`mock` default |
   `gemini`), and an image model catalogue like Video Models (provider,
   model id, label, per-image price in won by size, visibility).
3. **First real candidate: Google's Gemini image models** — Nano Banana
   2.1 about **$0.034 (≈ 47원) per 1K image**, 2K ≈ 71원, 4K ≈ 158원;
   Gemini 3 Pro Image ≈ 188원. xAI's image models (≈ 28–70원) are the
   alternative. Imagen 4 is shut down. (Research doc.)
4. **In Chat:** 이미지 만들기 in the composer, or Claude offering it the
   way it offers the Builder and Video buttons. Claude may improve the
   prompt (tokens); the image provider generates (per image); both from
   the member's one wallet; the result is stored through the storage interface
   as a chat attachment with 다운로드.
5. **Which budget — settled by `single-wallet` (2026-10-08):** the
   member's one wallet, recorded with `provider="gemini"` (or whichever
   image provider) so Admin › Budget shows it as its own line. Google is a
   different prepaid provider and credit cannot move between Anthropic and
   Google, so it becomes a **third per-provider purchase** forecast from
   usage by provider under budget-by-provider — no third member pot.
6. **Data terms.** Gemini's *free* tier uses submitted content for
   training and lets humans read it — **member prompts must only ever go
   through a paid (billed) project**. A key on an unbilled project
   silently becomes free tier, so startup refuses `IMAGE_PROVIDER=gemini`
   unless `GEMINI_BILLING_CONFIRMED=true`, and `docs/deployment.md` says
   why. Gemini's terms require users to be 18 or over.

**Charged:** the image budget per image at the catalogue price (in won,
snapshotted like video prices); Build for Claude's prompt help.

**Tests:** mock generation end to end (budget check before, charge after,
nothing on failure); the price by size from the catalogue; hidden and
disabled image models refused; the billing-confirmation guard; the image
stored and downloadable by its owner only.

**Risks:** a new provider pot and receipt trail for Concur (whether
Gemini's prepaid purchases produce downloadable receipts is *unverified*
— check before buying). The data terms above. Content safety (provider
filters; a refusal shown in Korean and not charged). Generated images on
the VM disk count toward the member's attachment quota.

## more-chat-providers — full spec (optional)

After the beta · M3 · branch `feat-more-chat-providers`. Effort: **M per
provider**. Added 2026-10-07. Optional — the owner decides whether it is
wanted at all.

1. **The seam exists.** `chat-model-choice` made the catalogue *provider
   + model*; another provider is a new adapter (a `ChatProvider` with the
   same stream, usage and error events as `claude_provider.py`), chosen by
   the row's `provider`, plus rows. Screens do not change.
2. **Candidates** (research doc, 2026-10-07):

   | | API | Price $/MTok (in / out) | Billing | Data |
   | - | --- | ----------------------- | ------- | ---- |
   | Google Gemini (AI Studio) | own SDK; OpenAI-compatible layer | 3.1 Pro preview 2 / 12; 3.8 Flash 0.75 / 3.75 (doubles 2027-01-01); Flash-Lite from 0.10 / 0.40 | prepaid credit (default since 2026-03), expires after 12 months; at $0 every key on the account stops | free tier trains on data — paid tier only |
   | xAI Grok | OpenAI-compatible | grok-4.7 2 / 6; grok-4.3 1.25 / 2.50 | prepaid credit or monthly invoice; invoices in the console | no training without permission; 30-day retention |
   | OpenRouter (aggregator) | OpenAI-compatible | provider list price, no markup | one prepaid balance for every model; **5.5% card fee** | per upstream provider; free models may train |
   | DeepSeek V4.1 Flash via OpenRouter, US providers only ([research](research/deepseek-research.md), 2026-10-08) | OpenAI-compatible; images in, no PDF | 0.30 / 1.20 at Together (≈2.7원 a typical reply with the fee); 0.45 / 1.80 at `fireworks/us` | the OpenRouter balance above | `only` US allowlist + `data_collection: "deny"` + `zdr: true`, also set account-wide; never reaches China |
   | DeepSeek V4.1 Flash direct at a US host (Together; Fireworks US) | OpenAI-compatible | Together 0.30 / 1.20 (2.6원); Fireworks US 0.45 / 1.80 (3.9원) | prepaid ($5 minimum at Together) | Together: no training by default, zero retention as an org setting; Fireworks: nothing stored for open models |
   | ~~DeepSeek's own API~~ — not recommended | OpenAI- and Anthropic-compatible | `deepseek-flash` 0.30 / 1.20 peak, half off-peak (2.6원 / 1.3원) | prepaid, CNY or USD; Concur receipts unverified | **servers in China**, PRC law, inputs may be used for training, no zero retention |

3. **Effect on budget-by-provider and Concur.** A direct provider is one
   more prepaid pot and one more purchase per quarter (Gemini: on its own
   billing account, not the VM's). An aggregator collapses every model
   into **one pot at about 1.055× list price** with one Stripe receipt per
   top-up — simpler for the 팀장, but per-model attribution then comes
   from our own ledger only. Decide this together with
   `budget-by-provider`.
4. **File input and streaming** are supported by all three; Gemini reads
   PDFs at 258 tokens a page, far cheaper than Claude, which matters for
   `chat-plus-files`.

**DeepSeek (deepseek-research, 2026-10-08).** Full findings in
[`research/deepseek-research.md`](research/deepseek-research.md).
**Not DeepSeek's own API**: servers in China, PRC law, inputs may be
used for training, no zero retention, and Korea's PIPC found prompt
transfers in 2025. That conflicts with the company's possible China
restriction. The open-weight model (V4.1 Flash, MIT) is served by US
hosts at about 1–4원 a typical reply, against Haiku's 10원. If the
owner wants it, **first ask the company** whether the rule is "no China
servers" or "no DeepSeek". If it is the first, add one row through
**OpenRouter pinned to a US allowlist** (`only` + `data_collection:
"deny"` + `zdr: true`, also account-wide). If DeepSeek is the only extra
model, a **direct US host** (Together, or Fireworks' US region) is
another option. One more purchase line for the 팀장 either way. Korean
quality is unmeasured; low priority.

**Catalogue row already seeded (admin-and-nav-cleanup, 2026-10-14).**
`deepseek/deepseek-v4.1-flash` exists, closed (연결 준비 중), under
provider id `deepseek` — but `provider` elsewhere means "whose API serves
it", and the recommendation above is OpenRouter or a direct US host,
never DeepSeek's own API. When the adapter lands, either keep the key
`deepseek` and define it as "DeepSeek models through the US host chosen
by configuration", or migrate the row's provider to the real host
(`openrouter` / `together`) — decide then, so `UsageEvent.provider` and
Admin › Budget name the pot the club actually buys from.

**Charged:** each provider's own budget (or the aggregator's single one),
by the token at the catalogue price.

**Tests:** an adapter conformance suite — the stream, usage and error
cases `test_chat.py` runs for Claude, against each adapter's fake
transport; a row whose provider has no adapter is refused (already tested
by `chat-model-choice`).

**Risks:** data terms differ per provider (paid tiers only; Gemini users
18+). Another set of keys to keep and rotate. Korean quality is
unmeasured — compare on a handful of real club prompts before opening a
model to members.

---

## Done

→ The Done table moved to [`archive/done.md`](archive/done.md). When an
item merges, add its row there and move its full spec to
[`archive/done-specs.md`](archive/done-specs.md).
