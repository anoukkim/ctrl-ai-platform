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

**Nothing is in progress.** `prep-beta-launch` merged 2026-10-13; next is
`invite-only-signup`. Branch the next item from an up-to-date
`main`.

**Working order set by the developer (2026-10-08)** — three items ahead
of everything else, one branch each, stopping after each for the
developer to check and merge:

1. `single-wallet` — branch `feat-single-wallet`
2. `ui-friendly-motion` — branch `feat-ui-friendly-motion`, **after
   single-wallet is merged**
3. `deepseek-research` — branch `docs-deepseek`, research only; can run
   any time

Mock providers only, never a real API call; the developer's database
untouched (pytest with `DATABASE_URL` at an unreachable port until
`test-database-isolation` lands); no cloud resources; no merging.

**Money wording in older notes.** Since `single-wallet` (2026-10-08)
every paid feature spends from one 동아리 지원 wallet per member per
quarter. Notes below that say a feature "charges Build" or "the Video
budget" record what was true when they were written; read them as "the
wallet", with the provider on the usage event.

**Earlier working order (2026-10-07)** — now after the three above,
one branch each,
stopping after each for the developer to check and merge:

1. `invite-only-signup`
2. `chat-plus-rendering`
3. `test-database-isolation`
4. ~~`prep-beta-launch`~~ — **merged 2026-10-13**; spec and Hosting
   decisions in [`archive/done-specs.md`](archive/done-specs.md)

`chat-plus-files` and `chat-plus-artifacts` keep their specs and are not
in this run. Mock providers only, no real API call, the developer's
database untouched, no cloud resource created.

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
- **Project status as members see it:** only "Draft" and "게시됨", with
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

Order set by the developer on 2026-10-07 (`docs-chat-plus`): the beta's
one real feature is Chat, and members have never used Claude, so Chat
should show what Claude can do before the site goes public. Three
`chat-plus-*` items come in ahead of the launch work; the post-beta
items are specced under **After the beta** below and are not in this
list. `chat-model-choice`, added at the top the same day, has merged
and left it.

**Items 1–6 were put at the top by the developer** (1, 5 and 6 on
2026-10-08; 2, 3 and 4 on 2026-10-13). Everything below them moved down
six places.

1. **single-wallet** · M1 · branch `feat-single-wallet`
   Members no longer split their quarter support. One 동아리 지원 wallet
   per member per quarter (80,000원 by default, admin-editable per
   quarter) pays for Chat, video and every other paid feature. Replaces
   the Build/Video buckets with a migration that keeps the totals.
   Spec saved verbatim below.
   **Built on `feat-single-wallet`, waiting for the developer's check** —
   see *Decisions taken while implementing* under its spec.

2. **prompt-caching** · M1 · branch `feat-prompt-caching` (from
   `feat-single-wallet`)
   Added by the developer on 2026-10-13, mid-run: Anthropic prompt caching
   in Chat, priced correctly in the ledger, and nothing that calls the API
   more than it must. Takes over `chat-plus-files` point 5. Built on
   single-wallet's ledger, so it merges after it. Spec below.

3. **cost-calibration** · M1 · branch `feat-cost-calibration` (from
   `feat-prompt-caching`)
   Added by the developer on 2026-10-13: the cost estimates learn from the
   real token counts the API reports — "답장 1회 약 N원", the pre-check's
   input estimate, and an Admin view comparing estimate and reality.
   Spec below.

4. **chat-builder-starter** · M1 (a first slice of M2's
   builder-static-runtime) · branch `feat-chat-builder-starter` (from
   `feat-cost-calibration`)
   Added by the developer on 2026-10-13: when a member asks Chat for an
   app, Project Builder makes a small working example app (static HTML /
   CSS / JS) and shows it in a sandboxed preview. Spec below.

5. **ui-friendly-motion** · M1 · branch `feat-ui-friendly-motion`
   Friendlier, less developer-like screens with short, tasteful motion
   (the `motion` library), plain-Korean copy, empty states and a
   first-visit guide. **Starts after single-wallet is merged.** Spec saved
   verbatim below.

6. **deepseek-research** · M3 (research for more-chat-providers) · branch
   `docs-deepseek`
   Research only, no code: can DeepSeek join the chat model catalogue —
   its own API, and hosts that serve DeepSeek models outside China. Writes
   `docs/research/` and a note under `more-chat-providers`. Can run any
   time. Spec saved verbatim below.

7. **invite-only-signup** · M1 · branch `feat-invite-only-signup`
   An invite code is required to sign up, in every environment — the site
   address is public, the community is not. Adds the `InviteCode` table
   and an invite-code section to Admin › Members. Spec saved verbatim
   below. **`prep-beta-launch` no longer defines its own invite codes**;
   it reuses this.

8. **chat-plus-rendering** · M1 · branch `feat-chat-plus-rendering`
   Replies render Markdown — tables, code blocks with a copy button — and
   the four Chat welcome cards become **기능 둘러보기**, example prompts
   (표 만들기, 파일 요약, 차트 그리기, 웹페이지 만들기). Spec below.

9. **chat-plus-files** · M1 · branch `feat-chat-plus-files`
   Images, PDF, CSV and text attached to a message through the storage
   interface, with limits, an estimated cost before sending and Korean
   errors. Spec below.

10. **chat-plus-artifacts** · M1 · branch `feat-chat-plus-artifacts`
   HTML, SVG and chart previews in a sandboxed iframe (srcdoc,
   `allow-scripts` only, no same-origin, no network), with 코드 보기,
   다운로드 and Builder로 보내기. Spec below.

11. **test-database-isolation** · M1 · branch `fix-test-database-isolation`
   ⚠ **Must be done before `prep-beta-launch`, not after.** Spec below.
   The test suite writes to the database named by `DATABASE_URL` — the
   one the developer runs the product on. Found on 2026-10-07, after it
   put a branch's table into the development database and left
   `alembic upgrade head` unable to run.

   **Open check before the beta opens to members — Phase 2's point 10
   (real key).** One short real message with the owner's key; see
   **Now**. Not a branch. `prep-beta-launch` merged on 2026-10-13; the
   site does not open to members until this, item 7 and item 11 are done.

### Merge order

1. `feat-single-wallet` — built, waiting for the developer's check.
2. `docs-deepseek` — research only, waiting; touches different sections
   of this file, so it merges cleanly in either order.
3. `feat-ui-friendly-motion` — starts after `feat-single-wallet` merges.

---

## After the beta (specced, not in Next)

Added 2026-10-07 (`docs-chat-plus`). Specced now so the beta's design
leaves room for them; **none starts before `prep-beta-launch` has
shipped**, and each has a milestone in [`ROADMAP.md`](ROADMAP.md). Full
specs are at the end of this file; the research behind them is in
[`research/chat-plus-research.md`](research/chat-plus-research.md).

- **chat-plus-tools** · M2 — web search, web fetch and code execution in
  Chat (Anthropic server tools), with per-search fees in the ledger.
- **builder-static-runtime** · M2 — Phase 3's generation (Claude writes
  the project's files) plus static member apps served from a separate,
  sandboxed origin. Absorbs the Builder MVP [3].
- **image-generation** · M2 — raster images through an
  `ImageGenerationProvider` (mock first; Gemini image models the first
  real candidate). Waits on the budget-by-provider decision.
- **more-chat-providers** (optional) · M3 — Gemini, Grok or an
  aggregator as further catalogue providers, on the seam
  `chat-model-choice` left.

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

## single-wallet — full spec

Branch `feat-single-wallet`. M1. Added 2026-10-08 at position 1. Saved
exactly as written by the developer.

**It settles the member side of the cost model.** `budget-by-provider`
and `usage-analytics` (*After the prototype*) assumed two budgets per
member, named by provider; this item replaces both buckets with one
wallet, and its last bullet rewrites those two specs to match. The club
still buys credit per provider — that part of the cost-model discussion
is unchanged, and is now forecast from usage by provider.

> ITEM 1 — single-wallet (branch feat-single-wallet)
> Decision: members no longer split their quarter support by percentage. Each participating member gets one 동아리 지원 wallet per quarter, 80,000원 by default (admin-editable per quarter), and Chat, video and every other paid feature spend from that one balance.
> - Data: replace build_budget_krw / video_budget_krw with one budget in QuarterAllocation, with an Alembic migration that sums existing allocations and usage correctly, and a downgrade. FundingSource: one community value instead of community_build / community_video (migrate existing rows). Usage events keep provider, feature, model and native units, so we still know what was spent on Anthropic vs Higgsfield.
> - Application: no split, no presets. "이번 분기 참여" applies for the quarter's fixed amount.
> - Member UI: a wallet card ("이번 분기 지원금 80,000원 중 52,300원 남음") in the sidebar and on Usage, with a breakdown of what was spent on 채팅 / 영상 / 기타 as information only. Estimated costs next to buttons compare against the one balance.
> - Admin: per-quarter amount, each member's balance, and quarter totals by provider so the club leader can decide how much credit to buy from each provider. Audited as before.
> - Personal top-ups stay a separate balance (still off in the beta); say in the UI which balance is spent first and keep the current rule unless it conflicts.
> - Update budget-by-provider and usage-analytics specs (After the prototype) and docs/product.md so nothing still describes the two-bucket split. Note in Funding model that the club still buys per provider, forecast from usage by provider.
> Tests: migration preserves totals; Chat and video both draw from one balance; pre-check refuses when the single balance is short; application has no split; admin per-quarter amount; per-provider totals match usage.

### Decisions taken while implementing — 2026-10-08

Built on `feat-single-wallet`, not merged.

- **Data.** `quarter_allocations` has `budget_krw` and `consumed_krw`
  (renamed from `community_total_budget_krw`; the six per-bucket columns
  are gone). `quarter_applications` has only `requested_budget_krw`.
  `usage_events.category` is **dropped** — what a charge was for is
  `provider` + `feature`; the downgrade rebuilds it (video features and
  Higgsfield → video, everything else → build). `FundingSource` is
  `community | personal`.
- **Migration `e8a4c2f6b1d7`** sums each wallet (`budget = build + video`,
  `consumed = build consumed + video consumed`) and keeps the original
  split in `pricing_snapshot.split_before_single_wallet`, so the downgrade
  restores it exactly; a wallet whose total changed after the upgrade gets
  Video = what Video spent and the rest Build, so neither starts overdrawn.
  Withdrawal reversals become one `amount`. A bucket an admin had lowered
  below its spend is absorbed by the other — the wallet's remaining figure
  is the true total. Checked on SQLite (tests) and round-tripped on a
  throwaway PostgreSQL 16 container (upgrade → downgrade → upgrade, plus
  `alembic check`), never on the developer's database.
- **The amount.** `Quarter.subsidy_limit_krw` (unchanged column name) is the
  quarter's per-member amount, labelled **1인 지원금** in Admin; the
  default `QUARTERLY_SUBSIDY_LIMIT_KRW` is now **80,000**. Existing quarters
  keep the amount they were created with. Changing a quarter's amount does
  not move wallets already approved (audited as before); one member's
  wallet is adjusted in member detail.
- **Application.** `POST /api/quarters/{id}/apply` takes no body; anything
  sent is ignored. Admin approval stays as it is (auto-approval is
  `budget-by-provider`'s).
- **Breakdown.** 채팅 = `chat`; 영상 = `video_generate`, `video_edit`,
  `video_extend` **and `video_prompt`** (the member was making a video,
  although it is Claude spend); 기타 = everything else. Counts wallet
  money only, so the three lines add up to "used"; personal money has its
  own card.
- **Personal money — current rule kept:** the wallet first; personal money
  only with 개인 사용 on and enough for the whole charge; never split.
  Usage and Profile now say so in one sentence (`SPENDING_ORDER_NOTE`).
- **Admin › Budget is on** (`GET /api/admin/quarters/{id}/budget`): every
  wallet, and per provider the KRW charged (wallet / personal), provider
  cost per currency, native units, share, and the wallet total × that share
  as a reference figure. Personal-money spend is included because it uses
  the same purchased credit.
- **Estimates vs the wallet.** `WalletCheck` under Chat's model picker and
  next to 생성 / 수정 / 이어서: "남은 지원금 N원", or "지원금이 부족합니다"
  when the estimate exceeds it (or "개인 잔액에서 결제" when overage covers
  it). Chat now refreshes the sidebar wallet after every reply.
- **Dev simulator** records a provider and feature instead of a category.

## prompt-caching — full spec

Branch `feat-prompt-caching`, from `feat-single-wallet`. M1. Added
2026-10-13 by the developer, mid-run, in two messages saved exactly as
written:

> add API key sk-ant-usr-…(redacted here) and add prompt cashing

> very strong enhanced prompt cashing and dont overuse api

(The key went into the git-ignored `.env` only; it is not repeated in
this file. `CLAUDE_PROVIDER` stays `mock`, so nothing calls Anthropic until
the developer switches it — see Phase 2's open check, point 10.)

**Takes over `chat-plus-files` point 5** (automatic caching and pricing
cache writes and reads at their own prices). What this item does:

1. **Two cache breakpoints on every Chat request** — an explicit one on the
   system prompt (the part every conversation shares) and Anthropic's
   automatic top-level `cache_control` for the growing conversation, so
   each turn re-reads the previous turns at the cache-read price instead of
   paying full input price again. TTL is a setting (`CHAT_CACHE_TTL`,
   default `5m`; `1h` doubles the write price and only pays off when a
   member pauses 5–60 minutes between messages).
2. **A stable prefix.** History is trimmed at fixed cut points counted from
   the start of the conversation, not by sliding one message at a time —
   a sliding window changes the first message every turn and rewrites the
   whole cache on every reply once a conversation is long.
3. **The ledger prices what was really billed:** uncached input at the
   input price, cache writes at 1.25× (5m) or 2× (1h) the input price,
   cache reads at the model's cache-read price (a new catalogue column,
   edited in Admin › Claude Models; Opus 5.5 0.05×, the others 0.1×).
   Two new `UsageEvent` columns record the write and read tokens. The
   pre-check's worst case prices the whole input at the write price, so it
   stays a true worst case.
4. **Not overusing the API:** no cache pre-warming calls, no token-counting
   calls, one retry at most (as before), the per-minute limit unchanged,
   the prompt helper left uncached (its short, one-off prompts would only
   pay the write premium). The mock simulates caching, so all of this is
   built and tested with no key.
5. **Admin can see it working:** Admin › Budget shows cache reads and
   writes per provider and the share of input served from cache; Admin ›
   System shows the cache settings.

## cost-calibration — full spec

Branch `feat-cost-calibration`, from `feat-prompt-caching`. M1. Added
2026-10-13. The developer's request, saved exactly as written (the second
half is `chat-builder-starter`), and the answer to the one question asked:

> add calibrastion and connect the chatting prompt with the builder ex. when i want to make an app it makes a initial example app. also tell me what features are not avilabe in chat currenly (ex. creating graphs uploading/downoading files etc) and list

> Q: "Calibration"은 어떤 뜻인가요? — A: **비용 보정** (실제 API가 알려 준 토큰 수로 우리 쪽 어림값 — 1글자=1토큰, "답장 1회 약 N원", 보내기 전 최악의 경우 금액 — 을 자동으로 맞춥니다)

1. Every Chat usage event records the **input estimate** made before the
   call (a new column), next to the tokens the API actually reported.
2. Per model, from the most recent real replies: the ratio of real prompt
   tokens to the estimate, the typical output length, and the median cost
   of a reply (caching included).
3. **"답장 1회 약 N원"** uses that median once a model has enough replies
   (10), and says so ("최근 N회 기준"); before that, the formula as today.
4. **The pre-check** prices the input at the calibrated ratio plus a
   safety margin instead of one token per character — never above the old
   figure, and the output side stays the full worst case, so a member is
   still never let through who cannot pay.
5. **Admin › Claude Models › 비용 보정**: per model, replies counted,
   estimate vs real input, average output, average and median cost, cache
   hit rate — the numbers to compare with the Anthropic Console.
6. History trimming is **not** calibrated: changing its limit with the
   ratio would move the cut and break the prompt cache.

## chat-builder-starter — full spec

Branch `feat-chat-builder-starter`, from `feat-cost-calibration`. Added
2026-10-13 (request above), answer to the question asked:

> Q: Chat에서 '앱 만들어 줘'라고 하면 예시 앱을 어디까지 만들어 줄까요? — A: **생성 + 미리보기** ('Project Builder에서 시작'을 누르면 Claude가 index.html/style.css/app.js로 된 작은 예시 앱을 만들고, 작업 공간에서 바로 보고 고칠 수 있게 합니다. 미리보기는 네트워크와 쿠키가 막힌 샌드박스 iframe입니다. 만들기 전에 예상 비용을 보여 주고, 지원금에서 차감합니다.)

A first slice of `builder-static-runtime` Half 1 (M2), pulled forward.
Static files only; nothing runs on the backend (CLAUDE.md section 20).

1. **From Chat:** the builder action button opens the new-project form
   with the idea filled in, as today, plus **예시 앱까지 만들기** (on by
   default) showing the estimate before anything is spent.
2. **Generation:** `POST /api/builder/projects/{id}/starter` — Claude (the
   catalogue default model, through the provider interface, mock by
   default) returns the files as structured JSON; the backend checks every
   path and size (`index.html` required; html/css/js/json/svg/md/txt
   only; at most 10 files, 100 KB each, 300 KB together; no `..`, no
   hidden files) and stores them as `BuilderProjectFile` rows in the same
   transaction as the charge. Wallet pre-check against the worst case
   first; a failed call is free.
3. **Workspace:** the file tree and the code view show the project's real
   files (read-only for now); the preview runs `index.html` with its CSS
   and JS inlined in an `<iframe srcdoc>` with `sandbox="allow-scripts"`
   only and a CSP that blocks all network, behind a label saying it is a
   safe preview. A project with no files can ask for a starter there too.
4. **Not in this item:** editing files by chatting with Claude (the
   workspace's Claude panel), saving edits, server code, publishing.

## ui-friendly-motion — full spec

Branch `feat-ui-friendly-motion`. M1. Added 2026-10-08 at position 2.
**Starts after single-wallet is merged** — its wallet card and the
animated wallet number build on that item's screens. Saved exactly as
written by the developer.

> ITEM 2 — ui-friendly-motion (branch feat-ui-friendly-motion), after Item 1 is merged
> Goal: friendlier, less developer-like, with tasteful motion, inspired by https://www.easyui.site/ (animated React components). Our members are beginners.
> - Motion: add the `motion` library (ask me before adding any other dependency; no Tailwind). Card hover lift, button press feedback, page and panel transitions, sidebar collapse animation, skeleton loaders instead of "불러오는 중", toast notifications for saves/deletes/downloads, a typing indicator while Chat streams, an animated wallet number when the balance changes, and gentle success states. Respect prefers-reduced-motion (no motion at all), keep animations short (150–300 ms), and never block input.
> - Friendlier copy: replace developer terms members see with plain Korean (e.g. Draft → 작성 중, Build/Video budget wording → the single wallet, provider/model jargon → simple descriptions). Keep the English menu names unless you think a change clearly helps; propose, don't decide.
> - Empty states with a short explanation and one clear action on every list; a short first-visit guide (3–4 steps, dismissible, remembered per browser) that shows Chat, Builder, Video and the wallet.
> - Keep design tokens in globals.css, Pretendard, dark default, and the existing accessibility rules. Check at 1280px, 1920px and a phone width; send me screenshots (or a short screen recording) of Chat, Builder, Video, Usage and Admin.
> Tests: reduced-motion disables animations; the guide shows once and can be reopened; empty states render; existing tests still pass.

## deepseek-research — full spec

Branch `docs-deepseek`. Research only — nothing is built. Added
2026-10-08 at position 3; can run any time. Its findings go to
`docs/research/` and into **more-chat-providers** (*After the beta*).
Saved exactly as written by the developer.

> ITEM 3 — research only (branch docs-deepseek), can run any time
> Can we add DeepSeek to the chat model catalogue? Using current docs, report: DeepSeek's own API (pricing, OpenAI-compatible API, streaming, file/image input, where data is stored and the privacy terms, billing and receipts for Concur), and alternatives that host DeepSeek models elsewhere (via OpenRouter with a provider/region choice, or US-hosted providers), with price differences. Recommend whether and how, noting that our company may restrict sending data to servers in China. Write it into docs/research/ and add a "more-chat-providers" note in BACKLOG. Don't build.

---

## invite-only-signup — full spec

Branch `feat-invite-only-signup`. Added 2026-10-01, and at position 5
since the 2026-10-02 reorder — still directly after Phase 2 and ahead of
`prep-beta-launch`. Saved exactly as written by the developer.

**It takes the invite codes out of `prep-beta-launch`.** That item's point 2
carried "Signup requires an invite code; Admin can create and revoke invite
codes, written to the audit log" as one line of its `APP_ENV=beta` list.
This item owns that instead, and widens it: the code is required in **every**
environment, not only the beta. `prep-beta-launch` keeps the rest of its
beta list and inherits a working invite system rather than building one.

**The audit log already exists.** Point 3's create, deactivate and
reactivate entries go into the append-only `AuditLog` from Phase 1c, which
already has its read-only admin view — so they are new entry kinds, not new
machinery.

**Point 3 is a panel on the existing Members page, not a new Admin
section.** `frontend/app/admin/sections.ts` and
`__tests__/admin-sections.test.ts` should not need an entry; a new nav
section would.

> Context: the site address will be public (the repository is public), but CTRL+AI is for club members only. Signing up requires an invite code in every environment, not only the beta. There is no admin approval queue.
> 1. Signup form gets a required "초대 코드" field. Without a valid code the account is not created, with a clear Korean message ("초대 코드가 필요합니다" / "사용할 수 없는 초대 코드입니다"). The message does not reveal whether a code exists but is expired or full, to avoid guessing.
> 2. InviteCode table with an Alembic migration: code, label (e.g. "2026 Q4 공지용"), max uses (1 for single-use, or a number), uses so far, expiry date (optional), active flag, created by, created at. Each signup records which code it used.
> 3. Admin › Members gets an "초대 코드" section:
>    - Create a code: auto-generated readable code or a custom one, label, max uses, expiry. Korean confirmation.
>    - List of codes with label, uses / max, expiry, status (사용 가능 / 만료 / 소진 / 중지), and who signed up with each code.
>    - Deactivate (사용 중지) and reactivate, with confirmation.
>    - Copy button for the code and for a signup link with the code pre-filled (/signup?code=...).
>    - Every create, deactivate and reactivate action is written to the audit log.
> 4. Codes are case-insensitive and trimmed. Uses are counted safely so two people cannot both take the last use of a code.
> 5. Accounts created with a code can use the site immediately; joining a quarter still requires the normal quarter application.
> 6. If a code leaks, deactivating it stops new signups but does not affect accounts already created; the admin can still mark those accounts inactive or former as usual.
> 7. Safety: signup is rate-limited per IP, failed code attempts are rate-limited too, duplicate usernames and emails are rejected.
> 8. Existing accounts are unaffected by the migration.
>
> Tests: signup without a code or with an invalid, expired, exhausted or deactivated code is refused with the same message; a valid code creates the account and increments its uses; the last use cannot be taken twice concurrently; the pre-filled signup link works; admin actions are audited; code management is admin-only.

---

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

### chat-plus-rendering — full spec

Branch `feat-chat-plus-rendering`. M1. Effort: **S** (1–2 days). No
migration.

1. **Replies render Markdown.** Headings, lists, bold, links, tables
   (GitHub-flavoured) and fenced code blocks. One renderer —
   `react-markdown` with `remark-gfm`, new dependencies — and **no raw
   HTML**: an HTML tag in a reply shows as text. Links open in a new tab
   with `rel="noopener noreferrer"`, and only `http(s)` and `mailto`
   survive. Wide tables scroll inside their own box; the page never
   scrolls sideways.
2. **Code blocks** show the language and a **복사** button ("복사됨" for
   two seconds). Monospace from the existing `--mono` token. No syntax
   highlighting in this item (it is another dependency and a colour set
   for both themes; a later UI batch can add it).
3. **The system prompt changes** from "Write plain text. The screen does
   not render Markdown" to: Markdown is rendered; use a table when the
   member asks to compare or organise, a fenced block for code, and keep
   headings to a minimum. Still Korean, still beginner-level.
4. **기능 둘러보기 replaces the four welcome cards.** Same grid and
   tokens, new content: four example prompts that **fill the composer**
   (the member presses 보내기 — they see the model and its estimated cost
   first; a click on a card sends nothing):
   - **표 만들기** — "서울 여행 2박 3일 일정을 표로 정리해 줘"
   - **파일 요약** — until `chat-plus-files` lands: "아래 글을 세 줄로
     요약해 줘:" plus a line break for pasting; after it, the card opens
     the attach dialog.
   - **차트 그리기** — until `chat-plus-artifacts` lands: a table plus a
     one-line reading of it; after it, an SVG bar chart preview.
   - **웹페이지 만들기** — "동아리 소개 한 장짜리 웹페이지를 만들어 줘";
     a code block now, a live preview after `chat-plus-artifacts`.

   The card list lives in one file (`lib/chat-examples.ts`), not in
   `mock-data.ts`: it is product content, not mock data. The old cards'
   destinations (Builder, Video, CtrlAIApps, CtrlAITube) stay reachable
   from the sidebar and from the reply action buttons.
5. **Streaming stays smooth.** Markdown is re-rendered as pieces arrive;
   an unfinished table or code fence must not flash raw pipes or
   backticks (render an open fence as a code block until it closes).

**Charged:** unchanged — the wallet, by the token. Tables and code are longer
than prose, so the average reply grows; the picker's "답장 1회 약 N원"
(3,000 in / 800 out) stays a fair guide. `CHAT_MAX_OUTPUT_TOKENS` stays
4,096 here.

**Tests:** a table, a code block and a list render as elements, not
text; `<script>` and `<img onerror>` in a reply render as text; a
`javascript:` link is dropped; 복사 writes the block's exact text to the
clipboard (mocked); a half-streamed fence renders as code; each example
card fills the composer and sends nothing; the system prompt no longer
says "does not render Markdown" (backend unit test).

**Risks:** XSS through Markdown — no raw HTML and a link allow-list,
both tested. Bundle size (two packages) on the Chat page only.

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

## test-database-isolation — full spec

Branch `fix-test-database-isolation`. **Must land before
`prep-beta-launch`.** Raised 2026-10-07.

> **The problem.** `tests/test_usage.py` proves the budget row lock, and
> SQLite ignores `SELECT ... FOR UPDATE`, so that one test needs real
> PostgreSQL. It gets it by calling `get_settings().database_url` — the
> developer's own database — and then runs
> `Base.metadata.create_all(bind=engine)` against it.
>
> Two consequences, both seen for real on 2026-10-07:
>
> 1. Running the suite on a branch **creates that branch's new tables in
>    the development database**, without recording anything in
>    `alembic_version`. The result is a database holding part of a
>    branch's schema and none of its migrations, which is exactly the
>    state in which `alembic upgrade head` later fails with
>    `relation "builder_project_files" already exists`.
> 2. The test writes rows (members, quarters, allocations) into the
>    database the developer is looking at while they work.
>
> **What to build.**
>
> - A dedicated test database, from its own setting — `TEST_DATABASE_URL`,
>   defaulting to something obviously separate such as
>   `postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai_test`.
> - **Refuse to run if it resolves to the same database as
>   `DATABASE_URL`.** Compare the parsed database name and host, not the
>   raw string: the same database can be written two ways. A test that
>   silently falls back to the developer's database is the bug being
>   fixed, so the failure must be loud and must name both URLs.
> - Skip politely, as today, when no test database is reachable — the
>   suite must still run with Docker down.
> - Create the schema from **migrations** (`alembic upgrade head`) rather
>   than `create_all`, so what the tests run against is what production
>   runs against. `create_all` is what let the schemas drift apart in the
>   first place.
> - Drop or truncate what the test created afterwards.
>
> Tests: the suite leaves `DATABASE_URL`'s database untouched (compare
> the table list and `alembic_version` before and after a full run); the
> guard refuses when both URLs name the same database, including when
> they are spelled differently; the row-lock test still proves
> overspending is impossible.

---

→ **account-withdrawal — full spec (merged 2026-10-07)** moved to [`archive/done-specs.md`](archive/done-specs.md#account-withdrawal--full-spec-merged-2026-10-07).

→ **video-higgsfield-only — full spec (merged 2026-10-07)** moved to [`archive/done-specs.md`](archive/done-specs.md#video-higgsfield-only--full-spec-merged-2026-10-07).

→ **Archived specs** moved to [`archive/done-specs.md`](archive/done-specs.md#archived-specs).

## chat-plus-tools — full spec

After the beta · M2 · branch `feat-chat-plus-tools`. Effort: **M**
(3–5 days). Added 2026-10-07.

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
