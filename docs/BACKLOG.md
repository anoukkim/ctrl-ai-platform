# Ctrl AI — Backlog

The single ordered queue of upcoming work.

Read this at the start of every session. Work only on the item the
developer names, or the top of **Next** if they say *"next item"*. New UI
requests mentioned mid-phase go to **UI requests** and are not built in the
current branch unless the developer says *"do it now"*. When an item is
merged, add its row to [`archive/done.md`](archive/done.md) and move its
full spec to [`archive/done-specs.md`](archive/done-specs.md). See section
22 of [`CLAUDE.md`](../CLAUDE.md).

Milestones and their status are in [`ROADMAP.md`](ROADMAP.md); the phases
in section 20 of `CLAUDE.md` are feature names. **This file is the
authority on order** — each item in **Next** names its milestone.

---

## Now

**Overnight batch of 2026-10-14 in progress** — the owner's instruction
(recorded in the run log): finish `admin-and-nav-cleanup` (merged
2026-10-14), then **fix-beta-blockers** and **personal-topup-off** (batch
items, specs go straight to the archive when they merge), then
`token-guard` → `live-cost-display` → `chat-plus-tools` (moved into Next,
mock tools only), a `docs-cleanup` branch that **waits for the owner**,
an `audit-caching-and-distribution` branch (PART F), and — only when
PART A and B are merged and main is green — a deploy of `main` to
`ctrlai-server` (pre-approved for this batch only). Board and details:
[`progress/RUN-2026-10-13.md`](progress/RUN-2026-10-13.md) › "Run of
2026-10-14".

**Unattended run of 2026-10-13** — build every item in Next that needs no
domain, real key or cloud change, merging each after the full loop.
`invite-only-signup` (merged 2026-10-13) is deployed to `ctrlai-server`
with `prep-beta-launch`, on mock providers; caddy waits for the A record.

**Working order set by the developer (2026-10-08)** — complete:
single-wallet and `ui-friendly-motion` merged 2026-10-13,
`deepseek-research` merged 2026-10-14 (owner approved, with
admin-and-nav-cleanup).

**Money wording in older notes.** Since `single-wallet` (2026-10-08)
every paid feature spends from one 동아리 지원 wallet per member per
quarter. Notes below that say a feature "charges Build" or "the Video
budget" record what was true when they were written; read them as "the
wallet", with the provider on the usage event.

**Earlier working order (2026-10-07)** — superseded by the owner's order
of 2026-10-13 at the top of **Next**.

Decisions from **chat-model-choice** (merged 2026-10-07) that later items
inherit:

- **Chat models are a catalogue, `chat_models`** (provider + model,
  Korean label and description, prices, `members` / `admin` / `disabled`,
  one default that must stay open to members), edited in Admin › Claude
  Models and audited (`chat_model.created`, `chat_model.updated`). It
  replaced `claude_model_prices` (migration `b2f7e4c81d36`). Another
  provider is a new adapter plus rows — `services/chat_models.py`
  (`require_adapter`) is the seam.
- **The model is per conversation** (`conversations.chat_model_id`, NULL =
  the default). Each reply and usage event records the model that wrote
  it — **the chosen model's id under the mock too**, no longer `"mock"`.
- **The video prompt helper uses the default model.**
- **`ANTHROPIC_MODEL` is only the fallback for an empty catalogue**, priced
  at the list prices in `chat_models.DEFAULT_CATALOGUE`; it is no longer
  required at startup.
- **"답장 1회 약 N원"** is 3,000 input + 800 output tokens
  (`pricing.TYPICAL_*`); Haiku 10원, Sonnet 20원, Opus 40원 at 1,400원/$.

Decisions from **ui-polish** (merged 2026-10-07) that later items inherit:

- **Two themes, dark by default.** Every colour, size and spacing is a
  token in `globals.css`; the light block redefines only the colours. A
  screen that writes a raw value will not follow the theme.
- **Pretendard Variable 1.3.9** comes from the npm package `pretendard`
  (dynamic subset, imported in `app/layout.tsx`).
- **`PageHeader`** (`app/components/PageHeader.tsx`) is the one list-page
  header: eyebrow, title, subtitle, action, divider. New list screens use it.
- **Project status as members see it:** only "작성 중" (was "Draft" until ui-friendly-motion) and "게시됨", with
  "생성 중…" while building or generating (`projectBadge()` in
  `lib/projects.ts`). There is no archived status (migration `7c1d5e93a4b2`).
- **The sidebar collapses** to an icon rail, remembered per browser
  (`ctrlai.sidebar-collapsed`).

**Open check carried from Phase 2 — Chat: point 10 has not been run.**
One short real message with the owner's key (`CLAUDE_PROVIDER=anthropic`;
the model now comes from the catalogue (`chat-model-choice`) —
send one message on the default Sonnet 5.5 and one on Haiku 4.5) — confirm
the reply streams, the usage event and deduction are right, and a wrong
key shows the Korean message with no charge. **It must be done before `prep-beta-launch`**,
whose one real feature is this chat; the request shape has so far only
been checked against a fake transport.

Decisions from **Phase 2 — Chat** (merged 2026-10-07) that later items
inherit — owner-approved defaults, with two changes by the owner:

- **Model: `ANTHROPIC_MODEL=claude-sonnet-5-5`** — the owner chose Sonnet
  over Opus because the club starts on a small budget. Opus 5.5 and Haiku
  4.5 are in the price table, so switching is a `.env` change only.
  *Superseded by `chat-model-choice`: the model is chosen per conversation
  from a catalogue (Sonnet 5.5 the default); `ANTHROPIC_MODEL` is only the
  fallback for an empty catalogue.*
- **Thinking: off where the model allows it, otherwise low effort**, as a
  setting either way (`CHAT_THINKING=off`, `CHAT_EFFORT=low`). Sonnet 5.5
  turns it off with `thinking: between_tools`; Opus 5.5 cannot turn it off
  and runs adaptive at low effort; Haiku 4.5 gets neither field.
- Max output 4,096 tokens; history up to 16,000 estimated tokens, oldest
  dropped first; 10 messages per member per minute, counted from saved
  messages; USD→KRW 1,400 to start.
- **Prices and the rate are admin-editable** (Admin › System, audited).
  Seeded: Sonnet 5.5 $2/$10, Opus 5.5 $4/$20, Haiku 4.5 $1/$5 per million
  input/output tokens. The rate keeps its history as rows.
- **KRW is rounded up**, minimum 1원 for any call that used a token.
- **Budget check before the call uses the worst case**; if a concurrent
  charge wins the race anyway, the charge takes what is left and still
  records the full dollar cost (`charge(cap_to_available=True)`).
- **A stopped reply is saved and charged for the tokens used**; only an
  error is free. A refusal is saved and charged.
- **Inactive members can read** their conversations; sending, creating,
  renaming and deleting need participation.
- **Deleting a conversation is a real delete**; its usage events stay with
  `conversation_id` set to NULL.
- **The video prompt helper is priced by the token too**;
  `VIDEO_PROMPT_HELP_CHARGE_KRW` is gone.
- **Settings are `CHAT_*`, not `CLAUDE_*`** — Claude Code sets
  `CLAUDE_EFFORT` in its terminals and a backend started from one would
  pick it up.

**Anthropic credit (owner, 2026-10-07).** The club starts with a small
prepaid Anthropic credit — the free sign-up credit if there is one,
otherwise about $5–10 — with **auto-reload OFF** and a **monthly spend
limit** set in the Anthropic Console. Recorded in `docs/deployment.md`.

Decisions from **video-higgsfield-only** (merged 2026-10-07) that later
items inherit:

- **Seed prices are placeholders** — Kling 3.0 Pro 720p 700원/s, 1080p
  1,000원/s; Seedance 2.0 480p 300원/s, 720p 500원/s; Wan 3.0 720p 400원/s.
  `prices_are_examples` marks them, Admin shows 예시, and saving a model
  clears it.
- **Edit and extend use the same per-second rate** — edit: source length
  × price at the source resolution; extend: added length × that price.
- **The prompt helper is a minimal mock Claude provider** with a flat
  `VIDEO_PROMPT_HELP_CHARGE_KRW` (default 10원) from Build, feature tag
  `video_prompt`. Phase 2 extends `app/services/claude_provider.py` and
  replaces the flat amount with token pricing.

- **A chosen final version makes a Draft or Generating project Ready**,
  and clearing it returns Ready to Draft; Published and Archived are left
  alone. `VideoProject.apply_final_version_rule` runs on every update.

Two things Phase 2 inherits from it:

- **`UsageEvent.feature` and `video_version_id` already exist.** Phase 2
  adds its token, USD and rate columns next to them.
- **`usage.ensure_affordable()` and `charge(commit=False)`** exist so a
  provider is never called for a member who cannot pay, and a row created
  by the call lands in the same transaction as the charge.

Two decisions from **account-withdrawal** (merged 2026-10-07) that later
items inherit:

- **The scheduled job is a CLI, not an in-process scheduler** —
  `python -m app.jobs.anonymise_withdrawn` (with `--dry-run`), run by hand
  or cron now and by Cloud Scheduler in Phase 9. No new dependency.
  `app/jobs/` is where later jobs go; each must be idempotent.
- **Anonymisation leaves the audit log untouched.** It stays strictly
  append-only; the anonymisation row itself carries no personal data.

`main` holds Phase 1, UI batch 1, membership-access-fix,
admin-restructure, ui-naming, fix-video-workspace-hang, ui-tube-watch,
ui-apps-detail, project-video-management, account-withdrawal and
**video-higgsfield-only** (all three merged 2026-10-07).

**Three components are now shared between Project Builder and Video
Generator**, which is where a later change should go rather than into
one product: `app/components/WorkspaceTitle.tsx` (the workspace title,
its ▾ menu, inline rename), `app/components/LibraryCard.tsx` (the list
card and its ⋯ menu), and `app/components/ConfirmDialog.tsx`, which moved
out of `app/admin/components/` and is now the only confirmation window in
the product — a member deleting a project and an admin closing an account
ask the same question and should not ask it in two different sets of
words.

**The comment section is now shared code.** `ui-apps-detail` lifted
reactions, tabs and the whole comment column out of CtrlAITube's
`WatchPanel.tsx` into `app/components/CommentSection.tsx`. Any later
screen that needs comments uses that, and a change to it changes both
community screens — which is the point.

Two things from ui-tube-watch worth carrying forward:

- **The breakpoint is a container query, not a media query.** Measuring
  the *screen* is wrong on this page: at 1280px the sidebar and padding
  leave only ~990px of content, so a `@media (min-width: 64rem)` rule is
  true on a screen where the two columns do not actually fit the way the
  spec describes. `.frame` carries `container-type: inline-size` and the
  rule is `@container (min-width: 54rem)`. Any later screen that splits
  into columns inside the main content area has the same problem.
- **`lib/aspect.ts` now holds the ratio constants.** Video Generator's
  `VideoSettings.tsx` re-exports them so its imports did not change. The
  watch page needed the same ratio→CSS map, and a second copy is the kind
  that drifts.

The **Next** order was rewritten again on 2026-10-01, and this is the
final order. **Phase 2 — Chat** moves from last place to 2 and
**prep-beta-launch** to 3: the goal is an invite-only beta on a real
domain whose one working AI feature is Claude chat, with everything else
labelled as test mode. Both specs were replaced wholesale, and
`video-higgsfield-only`'s Length slider section was replaced by
model-driven settings.

Two consequences of Phase 2 moving first are recorded in its spec: it now
owns the `UsageEvent` migration that `budget-by-provider` and
`usage-analytics` were each going to add, and it charges the `build`
category because the Claude/Higgsfield rename comes later.

**invite-only-signup** was then inserted at position 2 on 2026-10-01,
between Phase 2 and `prep-beta-launch`. It takes the invite codes out of
`prep-beta-launch`'s beta list and makes the code required in every
environment: the repository is public, so the site address will be, and an
invite code is what keeps the community members-only.

**Then, later the same day, the queue was reordered again.** The three
launch items moved to the end and the six build-out items came first.
`ui-tube-watch` and `ui-apps-detail` were built under that order and
merged on 2026-10-02.

**The queue was reordered once more on 2026-10-02, and that is the order
now in force.** `budget-by-provider` and `usage-analytics` left **Next**
entirely for a new section, **After the prototype (needs discussion)** —
the cost model behind them is still being decided, and an item whose
shape is unsettled should not sit at the head of a queue blocking four
items that are ready. Everything below them moved up, so **Next** now
started at `project-video-management` and ended, as before, with the
three launch items.

**The numbered list under "Next" is the authority on order** — the
numbers written into the spec sections are a snapshot and go stale at
every reorder.

Deferring those two undid the dependencies that had been written on the
assumption they came first. Four notes were rewritten to match:

- **Phase 2 — Chat charges the existing Build (Claude) budget** through
  the current budget service, rather than the renamed per-provider
  structures. It still records every field the two deferred items will
  need, so neither of them has to backfill.
- **`account-withdrawal` releases the member's remaining allocation**
  for the quarter instead of returning it to a club reserve. There is no
  reserve until `budget-by-provider` builds one; the release is written
  to the audit log, and connecting it to the reserve is that item's work.
- **`video-higgsfield-only` charges the existing Video budget**, again
  through the current budget service, and records the per-event fields.
- **`budget-by-provider` no longer owns the `UsageEvent` migration.**
  Phase 2 adds the columns it needs when it writes them; the deferred
  item extends that shape rather than introducing it.

---

## Operator notes

→ Moved to [`development.md` › Operator notes](development.md#operator-notes).

---

## Next (in order)

**Order set by the owner on 2026-10-13:** `invite-only-signup` first,
`test-database-isolation` second, `google-login` third, then everything
else in the order it already had. single-wallet, prompt-caching,
cost-calibration and chat-builder-starter merged on 2026-10-13 (through
`feat-chat-builder-starter`) and moved to Done. token-guard,
live-cost-display, chat-thinking-view, builder-python and
anonymous-feedback-board were added by the owner on 2026-10-13 as specs.
`invite-only-signup`, first in that order, merged the same day.
privacy-and-terms, offsite-backups and monitoring were put at the top by
the owner on 2026-10-14.

Earlier: the developer's order of 2026-10-07 (`docs-chat-plus`) put Chat
first — the beta's one real feature — so the `chat-plus-*` items come
before the post-beta work, which is specced under **After the beta**.

1. **privacy-and-terms** · M1 · branch `feat-privacy-and-terms`
   Added by the owner on 2026-10-14, at the top of Next. 개인정보
   처리방침 and 이용약관 pages in Korean for a club; consent checkbox at
   sign-up (Google and password); links on the sign-up screen and the
   sidebar footer. **Before members are invited, and the owner must
   review the text** — not part of the pre-approved overnight batch.
   Spec below.

2. **offsite-backups** · M1 · branch `chore-offsite-backups` · 💳
   Added by the owner on 2026-10-14. The daily `pg_dump` also copied to
   a Cloud Storage bucket in `asia-northeast3` with a 30-day lifecycle;
   a monthly restore test in `docs/deployment.md`. The owner creates the
   bucket — the item lists the console steps. Spec below.

3. **monitoring** · M1 · branch `chore-monitoring` · 💳 if any
   Added by the owner on 2026-10-14. An uptime check on
   https://ctrlai.my and error alerts to the club's email, the cheapest
   option; the owner does the console steps. Spec below.

4. **chat-plus-files** · M1 · branch `feat-chat-plus-files`
   Images, PDF, CSV and text attached to a message through the storage
   interface, with limits, an estimated cost before sending and Korean
   errors. Spec below.

5. **chat-plus-artifacts** · M1 · branch `feat-chat-plus-artifacts`
   HTML, SVG and chart previews in a sandboxed iframe (srcdoc,
   `allow-scripts` only, no same-origin, no network), with 코드 보기,
   다운로드 and Builder로 보내기. Spec below.

6. **anonymous-feedback-board** · M1 · branch `feat-feedback-board`
   Added by the owner on 2026-10-13, revised the same day and again on
   2026-10-14 (admin-and-nav-cleanup): **no menu item and no `/issues`**
   — the member board is a page of its own, reached from a "다른 의견
   보기" link inside the 의견 보내기 dialog. Members write notes there
   and read every public note with no names; Admin can hide a note,
   export notes as Markdown ("Claude용으로 내보내기"), and send chosen
   public notes to GitHub as issues that Claude groups and drafts
   ("GitHub로 보내기", `FEEDBACK_ISSUES_PROVIDER=mock|github`, never
   automatic). **Depends on:** `prep-beta-launch` and
   `invite-only-signup` (both merged). Spec below, with the owner's
   revisions.

7. **chat-plus-tools** · M2 · branch `feat-chat-plus-tools`
   Moved from *After the beta* into Next by the owner on 2026-10-14
   (part of the overnight batch). Web search, web fetch and code
   execution in Chat as Anthropic server tools — **mock tools only for
   now**: plausible results, no real API call, no real search fee. Each
   tool switched on per catalogue model by an admin and per conversation
   by the member, off by default, with its extra cost shown first.
   **Depends on:** `token-guard` and `live-cost-display` (the cap
   includes tool fees; the receipt shows them) — built after them. Spec
   below, with the owner's 2026-10-14 rules.

8. **chat-thinking-view** · M1 · branch `feat-chat-thinking-view`
   Added by the owner on 2026-10-13. A per-conversation toggle 생각 과정
   보기: Claude's summarized thinking as numbered steps under the reply,
   off by default, with its cost shown before it is turned on. **Depends
   on:** `chat-model-choice` and `cost-calibration` (merged), and
   `live-cost-display` (the receipt shows the thinking part). Spec below.

9. **builder-python** · M2 · branch `feat-builder-python`
   Added by the owner on 2026-10-13. Small Python apps from Project
   Builder, with a working example, running **in the visitor's browser
   only** through Pyodide. **Depends on:** `chat-builder-starter`
   (merged) and **`builder-static-runtime`** (M2, *After the beta*):
   Pyodide cannot load inside today's network-blocked `srcdoc` preview,
   so this cannot start before that item's Half 2. Spec below.

---

## After the beta (specced, not in Next)

Added 2026-10-07 (`docs-chat-plus`). Specced now so the beta's design
leaves room for them; **none starts before `prep-beta-launch` has
shipped**, and each has a milestone in [`ROADMAP.md`](ROADMAP.md). Full
specs are at the end of this file; the research behind them is in
[`research/chat-plus-research.md`](research/chat-plus-research.md).

- **builder-static-runtime** · M2 — Phase 3's generation (Claude writes
  the project's files) plus static member apps served from a separate,
  sandboxed origin. Absorbs the Builder MVP [3].
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

### privacy-and-terms — full spec

Branch `feat-privacy-and-terms`. M1, top of Next. Added by the owner on
2026-10-14. **The owner reviews the text before it ships.** Saved exactly
as written:

> privacy-and-terms: 개인정보 처리방침 and 이용약관 pages in Korean for a club (collected data — Google email/name, username, chats, files, usage; why; retention; withdrawal and anonymisation after 30 days; stored in Google Cloud Seoul; contact ctrlai.platform@gmail.com). Consent checkbox at sign-up (Google and password); links on the sign-up screen and sidebar footer. Before members are invited; I must review the text.

### offsite-backups — full spec

Branch `chore-offsite-backups`. M1 · 💳. Added by the owner on
2026-10-14. Saved exactly as written:

> offsite-backups: daily pg_dump also copied to a Cloud Storage bucket in asia-northeast3, 30-day lifecycle; monthly restore test in deployment.md. 💳; I create the bucket — list the console steps.

### monitoring — full spec

Branch `chore-monitoring`. M1 · 💳 if any. Added by the owner on
2026-10-14. Saved exactly as written:

> monitoring: uptime check on https://ctrlai.my and error alerts to ctrlai.platform@gmail.com, cheapest option; 💳 if any; I do the console steps.

### chat-plus-files — full spec

Branch `feat-chat-plus-files`. M1. Effort: **M–L** (4–6 days). One
migration (`chat_attachments`, plus the cache columns in point 5).

1. **What can be attached**, per message, up to **5 files**:

   | Kind | Formats | Upload limit | Sent to Claude as |
   | ---- | ------- | ------------ | ----------------- |
   | Image | JPEG, PNG, WebP, GIF (first frame) | 10 MB | `image` block, **re-encoded server-side to a long edge of at most 1,568 px** |
   | PDF | PDF, not encrypted | 10 MB and **30 pages** | `document` block (base64) |
   | Table | CSV | 1 MB | text, in a `document` block |
   | Text | TXT, MD | 1 MB | text, in a `document` block |

   The type is decided from the bytes (magic numbers; `pypdf` opening
   the PDF), never from the extension. CSV and text are decoded as UTF-8,
   falling back to **CP949** — Korean Excel exports are CP949, and a
   garbled summary is a support question. A file over a limit is
   **refused, never truncated**: a silently cut table gives a confident
   wrong answer.
2. **Storage.** Through the existing storage interface
   (`app/services/storage.py`), key
   `chat/<user_id>/<conversation_id>/<attachment_id>`. A new
   `ChatAttachment` row: owner, conversation, message, kind, original
   name, stored size, page count or pixel size, estimated tokens,
   created. **Re-encoding images strips EXIF** — phone photos carry GPS.
   Per member: **200 MB** of attachments. On the beta VM: the upload
   route refuses once the attachment folder passes **5 GB** of the VM's
   30 GB disk, and the Admin dashboard shows the figure. Both are
   settings (`CHAT_ATTACHMENT_*`).
3. **Deleting.** Deleting a conversation (a real delete, Phase 2) deletes
   its attachments' bytes and rows. Withdrawal anonymisation
   (`app/jobs/anonymise_withdrawn`) deletes them too. Usage events stay,
   as now.
4. **Estimated cost before sending.** As soon as a file is attached, the
   composer shows "첨부 포함 답장 1회 약 N원" for the conversation's
   model — and, because the history is resent every turn, "이 대화에서
   이어지는 답장마다 약 M원씩 더 듭니다" while the file stays in the
   context. The token estimate is the same in the browser and in the
   budget pre-check:
   - image: `ceil(w/28) × ceil(h/28)` after the resize (1,568 px → at
     most about 2,350 tokens for 4:3): ≈ 3원 Haiku, 7원 Sonnet, 13원 Opus;
   - PDF: pages × 3,000 (text) + pages × 1,600 (page image) — the upper
     end of the documented range until real Korean PDFs are measured with
     the token-counting endpoint; a 10-page PDF ≈ 46,000 tokens ≈ 64원 /
     129원 / 258원 on Haiku / Sonnet / Opus;
   - CSV and text: characters (the existing 1 token per character).
5. **Prompt caching** — *done by `prompt-caching` (2026-10-13)*; this
   item only has to keep attachments inside the cached prefix. Original
   text: turns on with this item, because a file resent on
   every turn is where the money goes (a 35k-token PDF over five turns:
   ≈ 490원 → 162원 on Sonnet). Automatic caching (`cache_control` at the
   top level). The ledger must then price **cache writes at 1.25×** and
   **cache reads at 0.1×** the input price (Opus 5.5: 0.05×) instead of
   adding them to input at full price, as the adapter does today: two new
   catalogue columns (`cache_write_usd_per_mtok`,
   `cache_read_usd_per_mtok`) and two new `UsageEvent` columns for the
   split. Haiku 4.5 caches nothing under 4,096 tokens — short Haiku chats
   see no saving, and that is correct.
6. **Korean errors**, each tested: 지원하지 않는 형식입니다 (JPEG, PNG,
   WebP, GIF, PDF, CSV, TXT, MD만 올릴 수 있습니다) · 파일이 너무 큽니다
   (최대 10MB) · PDF가 너무 깁니다 (최대 30쪽) · 암호가 걸린 PDF는 읽을 수
   없습니다 · 한 번에 5개까지 올릴 수 있습니다 · 첨부 공간이 가득 찼습니다
   (지난 대화를 지우면 공간이 생깁니다) · 지원금이 부족합니다 (with the
   estimate) · and the existing Claude error set for a provider rejection.
7. **Screens.** A 📎 button and drag-and-drop on the composer; chips with
   name, size and ✕; an uploading state; image thumbnails in the member's
   bubble; PDFs and tables as a chip that downloads the stored copy.
   Members not participating this quarter can still read and download
   what they attached.

**Charged:** the wallet, by the token, with the cache split above. Uploading
and storing cost nothing in won (the VM disk is the limit, not money).
The 파일 요약 welcome card now opens the attach dialog.

**Tests:** each format accepted by its bytes and refused under a renamed
extension; size, page-count, count and quota limits refused with the
exact Korean message and **nothing stored**; images re-encoded under
1,568 px with EXIF gone; a CP949 CSV decoded; the estimate equals the
pre-check's figure; a turn with an attachment charges the mock's
reported tokens; cache reads and writes priced at their multipliers;
another member's attachment is 404; deleting a conversation removes the
bytes; an attachment is never sent as a Files API id.

**Risks:** cost — files are resent each turn (caching and the visible
estimate are the mitigation; a later option drops a file from the context
after N turns, with a notice). VM disk and memory — Pillow on a 1 GB VM
handles one 12 MP image at a time (decode with a pixel cap, process
uploads one by one). Malicious files — nothing but Pillow and pypdf ever
opens a file, both under size limits, and nothing is executed. Personal
data — members may upload documents with personal information: the attach
dialog says files are sent to Anthropic for the reply and kept until the
conversation is deleted.

### chat-plus-artifacts — full spec

Branch `feat-chat-plus-artifacts`. M1. Effort: **M** (3–4 days). No
migration (`builder_project_files` exists since `f3b8d41c9e27`; at most
one Builder route to write a file).

1. **What becomes a preview.** A fenced block tagged `html` or `svg` in a
   finished reply — not while it is streaming — gets a **미리보기** card
   under the code. The system prompt tells Claude: a web page or a chart
   is one self-contained `html` block (inline CSS and JS, inline SVG for
   charts, **no external scripts, fonts or images** — they would not
   load). Charts are inline SVG or a few lines of plain JS on a canvas;
   no chart library from a CDN.
2. **The sandbox — non-negotiable, and tested exactly:**
   - an `<iframe srcdoc=…>` with **`sandbox="allow-scripts"` and nothing
     else** — never `allow-same-origin` (together with `allow-scripts` it
     lets the frame remove its own sandbox), never `allow-forms`,
     `allow-popups`, `allow-top-navigation`, `allow-modals` or
     `allow-downloads`;
   - the frame therefore has an **opaque origin**: no access to CTRL+AI's
     cookies, storage or `/api`;
   - **no network**: the srcdoc starts with a CSP meta tag —
     `default-src 'none'; script-src 'unsafe-inline'; style-src
     'unsafe-inline'; img-src data: blob:; font-src data:` — so `fetch`,
     external images and beacons fail;
   - **SVG is never put into the page** with `innerHTML` or
     `dangerouslySetInnerHTML`; it goes into the same sandboxed frame (an
     SVG can carry `<script>` and event handlers);
   - the preview runs **only after a click on 미리보기 열기** (a runaway
     loop in a generated page can freeze the tab; a click makes that the
     member's choice and keeps long conversations light), and has 새로
     고침 and 닫기;
   - a fixed label over the frame: "Claude가 만든 미리보기입니다. 여기에
     비밀번호나 개인 정보를 입력하지 마세요." — a generated page can draw
     a convincing fake login form.

   Blocks over **200 KB** show code only.
3. **코드 보기** toggles the source (the `chat-plus-rendering` code block,
   with 복사). **다운로드** saves `ctrlai-<conversation>-<n>.html` or
   `.svg`, built as a Blob by CTRL+AI's page, not by the frame (which has
   no download permission).
4. **Builder로 보내기** (HTML only) creates a Project Builder project —
   name from the conversation title, description from the member's
   message — with the block as `index.html`, then opens it. Through the
   Builder routes and `require_active_member`, like creating a project
   from the library. Free (no Claude call).
5. **Output length.** A one-page site in Korean can exceed 4,096 output
   tokens and arrive cut off. This item proposes
   `CHAT_MAX_OUTPUT_TOKENS=8192` — **the owner decides**, because the
   worst-case pre-check roughly doubles (Sonnet: about 60원 → 115원 per
   message before the real, usually far smaller, charge). A cut-off block
   shows "답장이 길어 미리보기를 만들 수 없습니다 — \"계속\"이라고 보내
   주세요" instead of a broken page.

**Charged:** the wallet, by the token, as any reply. Previews, downloads and
Builder로 보내기 cost nothing.

**Tests:** the iframe's `sandbox` attribute is exactly `allow-scripts`;
the srcdoc begins with the CSP above; no SVG reaches the DOM outside an
iframe; nothing runs before 미리보기 열기; over 200 KB shows code only; a
cut-off reply shows the notice; 다운로드 builds the right file name and
type; Builder로 보내기 creates one project with one `index.html` and is
refused for a member not participating; the mock's HTML and SVG replies
produce previews.

**Risks:** artifact security is the whole item — the sandbox list above
is the mitigation, and every attribute is asserted by a test so a later
"small fix" cannot widen it unnoticed. Phishing inside a preview (the
label; no forms). Tab freezes (click to run). The cost of long pages (the
output-limit decision). Nothing generated runs on the backend: the
preview runs in the member's own browser, in a frame with no origin.

---

→ **prep-beta-launch — full spec (merged 2026-10-13)** moved to [`archive/done-specs.md`](archive/done-specs.md#prep-beta-launch--full-spec-merged-2026-10-13), with its Launch data rules and **Hosting decisions — 2026-10-13**.

---

→ **ui-tube-watch — full spec (merged 2026-10-02)** moved to [`archive/done-specs.md`](archive/done-specs.md#ui-tube-watch--full-spec-merged-2026-10-02).

→ **ui-apps-detail — full spec** moved to [`archive/done-specs.md`](archive/done-specs.md#ui-apps-detail--full-spec).

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

## chat-thinking-view — full spec

Branch `feat-chat-thinking-view`. Added by the owner on 2026-10-13. Saved
exactly as written:

> chat-thinking-view: a per-conversation toggle "생각 과정 보기". Off by default because it costs more; the estimate is shown before turning it on. When on, show Claude's summarized thinking as simple numbered steps a beginner can follow, collapsed under the reply. Check the current Anthropic docs for how thinking works on each catalogue model and price it in the ledger.

**Depends on:** `chat-model-choice` and `cost-calibration` (merged);
`live-cost-display` (the receipt).

**How thinking works on the catalogue models** (checked 2026-10-13
against the Claude API reference bundled with Claude Code; check again at
build time):

| Model | Today in Chat (`CHAT_THINKING=off`) | 생각 과정 보기 on | Extra cost of turning it on |
| --- | --- | --- | --- |
| Sonnet 5.5 ($2 / $10 per MTok) | `thinking: {type: "between_tools"}`, i.e. no thinking (`disabled` is a 400 on this model) | `thinking: {type: "adaptive", display: "summarized"}` at the conversation's effort (`low`) | **Yes**: thinking tokens, billed as output |
| Opus 5.5 ($4 / $20) | Thinking cannot be turned off; it already runs adaptive at `low` effort, with `display` defaulting to `"omitted"` (empty text) | The same request plus `display: "summarized"` | **No**: `display` changes visibility only, and the thinking is already billed |
| Haiku 4.5 ($1 / $5) | No thinking unless asked | `thinking: {type: "enabled", budget_tokens: N}`, at least 1,024 and below `max_tokens`; adaptive is not available on this model | **Yes**, up to the budget (1,024 tokens ≈ 7원 at 1,400원/$) |

- **Billing:** thinking tokens are output tokens and arrive in
  `usage.output_tokens`; a summary is billed as the full thinking, not by
  its length. So the ledger is already right by construction. The usage
  event adds `thinking_shown: bool` so Admin and cost-calibration can
  tell the two kinds of reply apart, and calibration keeps a separate
  "typical reply" figure for replies with thinking shown.
- **The estimate before turning it on** comes from that calibration once
  there is data, and from a configured starting figure per model until
  then (Opus: +0원).
- **Thinking blocks are not sent back.** Sonnet 5.5 and Opus 5.5 bind
  thinking blocks to the model and the conversation ("preserved
  thinking"), and accounts created on or after 2026-08-31 get a 400 when
  history containing them is edited, which Chat's history trimming does.
  Store the summary text for display only and keep sending history as
  text, as today; a model switch mid-conversation (`chat-model-choice`)
  then needs nothing special. Confirm this against the reference's model
  migration guide before building.

1. **A toggle per conversation**, `conversations.show_thinking` (default
   false), beside the model picker: 생각 과정 보기, showing "답장 1회 약
   +N원" (or "추가 비용 없음" on Opus) before it is switched on. Changing it
   is a write, so inactive members cannot.
2. **Display:** collapsed under the reply as "생각 과정 (N단계)";
   expanded, the summary split into short numbered steps (by paragraph),
   as plain text. If the summary is empty (a reply that did not think),
   nothing is shown.
3. **Language:** the summary may come back in English even when the
   reply is in Korean. The build checks what each model actually returns;
   if it stays English, the collapsed header says "영어로 표시될 수
   있어요".
4. **Tests:** the request body per model (between_tools vs adaptive and
   summarized on Sonnet; display only on Opus; a budget on Haiku); no
   thinking block is ever sent back in history; `thinking_shown` on the
   usage event; the estimate shown before enabling; inactive members
   refused.

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

## chat-plus-tools — full spec

Next (item 7) · M2 · branch `feat-chat-plus-tools`. Effort: **M**
(3–5 days). Added 2026-10-07; **moved into Next by the owner on
2026-10-14** as part of the overnight batch, with these rules, which win
over the points below where they differ:

> - Mock tools only: plausible search results, page text and code output; no real API call, no real search fee.
> - Each tool is switched on per catalogue model by an admin and per conversation by the member, off by default. Turning one on shows its extra cost first (search ≈ 14원 each plus result tokens).
> - token-guard's per-reply cap includes tool fees and result tokens; the live cost and receipt show them; usage events record server_tool_use and the fees.
> - "검색 중… / 페이지 읽는 중… / 코드 실행 중…" while a tool runs; sources shown under the reply as links.
> - Code execution runs only on Anthropic's side; nothing runs on our server.
> - List in docs/deployment.md what changes when CLAUDE_PROVIDER=anthropic (real fees).
> - Depends on token-guard and live-cost-display; if either is not merged yet, build it after them.

1. **Three Anthropic server tools**, each switched on per catalogue model
   by an admin (new catalogue columns), and per conversation by the
   member with a toggle next to the model picker — per conversation, not
   per message, because changing the tool list breaks the prompt cache:
   - **웹 검색** — `web_search_20260209` on Sonnet 5.5 and Opus 5.5;
     `web_search_20250305` on Haiku 4.5 (no dynamic filtering there).
     `max_uses` 3, `user_location` Korea. **$10 per 1,000 searches (≈ 14원
     each) plus the result tokens**, which stay in the history and are
     billed again on later turns.
   - **웹 페이지 읽기** — `web_fetch_20260209`; only URLs already in the
     conversation. No fee beyond tokens, so `max_content_tokens` 20,000
     and `max_uses` 2 — one fetched 500 KB PDF would otherwise be about
     125k tokens (≈ 350원 on Sonnet).
   - **코드 실행** — `code_execution_20260521`; free when web search or
     fetch `_20260209` is in the request, otherwise inside the
     organisation's 1,550 free container-hours a month (then $0.05 an
     hour, 5-minute minimum). Files it creates come back through the
     Files API; the backend copies them into the storage interface at once
     and serves them as chat attachments. **File ids from a member are
     never accepted** — they are workspace-wide.
2. **The ledger.** `UsageEvent` records the response's `server_tool_use`
   counts (searches, fetches). KRW = tokens as now + searches × the
   per-search price (a catalogue value, `web_search_usd_per_call`, seeded
   $0.01) × the rate. The worst-case pre-check adds `max_uses` × the
   search price and the fetch cap.
3. **Screens.** "검색 중… / 페이지 읽는 중… / 코드 실행 중…" while a tool
   runs; sources under the reply as numbered links showing their domain
   (web search answers carry citations); code output — text, an image, a
   file — as an attachment chip. The picker's estimate gains "+ 검색 1회당
   약 14원".

**Charged:** the wallet, by the token plus per search. A typical question with
two searches: ≈ 50원 Haiku / 73원 Sonnet / 118원 Opus (research doc; the
result-token size is an estimate this item measures).

**Tests:** a tool is sent only when both the model and the conversation
allow it; Haiku gets the basic search version; searches are charged at
the catalogue price; the pre-check includes `max_uses`; a member-supplied
file id is refused; a tool error (HTTP 200 with an error block) shows
Korean and charges only tokens; mock replies cover search, fetch and code
output.

**Risks:** cost — the per-search fee and re-billed results (caps, the
visible estimate). Untrusted web content in the context (prompt
injection): there are no client tools, so a page can only steer the
text, and links in replies show their domain. The member's query goes to
the search provider (said in the toggle's tooltip). Code execution is not
ZDR-eligible and runs on Anthropic's servers, never ours.

## builder-static-runtime — full spec

After the beta · M2 · branch `feat-builder-static-runtime`. Effort:
**L–XL** (2–3 weeks, in two halves). Added 2026-10-07. **Absorbs the
Builder MVP [3]** of `CLAUDE.md` section 20.

**Half 1 — generation (Phase 3).** Claude writes and edits the project's
files: "만들어 줘" creates `index.html`, `style.css`, `app.js` (static
only — HTML, CSS, browser JS); "버튼 색을 바꿔 줘" edits them. Through the
existing `BuilderProject` / `BuilderProjectFile` models and the
workspace's file tree and editor. Claude returns whole files through one
tool, `write_file`, with `strict: true`; the backend checks names (the
storage key rules), sizes (≤ 200 KB a file, ≤ 30 files, ≤ 2 MB a
project) and types (text only). Every generation is a saved version the
member can go back to. Charged to the wallet by the token; a generation may
write up to 16,000 output tokens, so the worst-case pre-check (≈ 230원 on
Sonnet) is shown before the member presses 만들기.

**Half 2 — the static runtime.** The preview pane and, later, the
CtrlAIApps launch button serve a project's files from **a separate
origin**:

- **A separate registrable domain, not `apps.ctrlai.my`.** A subdomain
  is *same-site* with `ctrlai.my`: `SameSite` cookies are sent on
  requests from it, and a cookie set with `Domain=ctrlai.my` would reach
  it. A different domain (in the manner of `googleusercontent.com`, e.g.
  `ctrlai-apps.net`) makes member apps cross-site to CTRL+AI. ⚠ **Buying
  it costs money — ask the owner first.** If the owner prefers
  `apps.ctrlai.my` anyway, the conditions are: CTRL+AI's session cookie
  stays host-only (no `Domain` attribute), and every state-changing route
  keeps requiring a JSON body, which a cross-origin page cannot send
  without a CORS preflight the API refuses.
- **One path per app** to start (`/<app-slug>/`), served by Caddy from a
  read-only volume the backend writes when the member presses 미리보기
  갱신 or 게시. Apps share that origin, so one app can read another's
  `localStorage`: acceptable for a club beta and written down; one
  subdomain per app (wildcard certificate, DNS challenge) is the later
  step.
- **Headers on every response:** `Content-Security-Policy: default-src
  'self'; script-src 'self' 'unsafe-inline'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; connect-src 'self';
  frame-ancestors https://ctrlai.my` (only CTRL+AI may frame it),
  `X-Content-Type-Options: nosniff`, and never a `Set-Cookie`.
- **The workspace preview** frames that origin with `sandbox="allow-scripts
  allow-forms"`.
- **Nothing runs on the backend.** Static files execute in visitors'
  browsers only; server code (Python, Node) is refused when written. This
  is the line `CLAUDE.md` section 20 draws before the **Secure App
  Runtime**, which stays *Later*.
- **Storage:** 2 MB per project; all apps together ≤ 2 GB of the VM disk
  (a setting), checked before writing.

**Charged:** the wallet for generation (tokens). Hosting costs nothing per app;
the separate domain is a yearly cost for the club.

**Tests:** generated files land as `BuilderProjectFile` rows within the
limits; a server-side file type is refused; the static origin's responses
carry the headers above and no `Set-Cookie`; a project's path serves only
that project; the preview frame's sandbox list is exact; a deleted
project stops being served (the `deleted_at` rule in section 20).

**Risks:** runtime security (separate site, CSP, no cookies, no server
code). A member app used for phishing under the club's name (a report
button on CtrlAIApps; an admin can unpublish from Content). Cost —
generations are the most expensive calls in the product, so the
pre-check figure is shown before each one. VM disk (the caps above).

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
