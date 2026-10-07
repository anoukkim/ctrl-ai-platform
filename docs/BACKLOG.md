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

**Nothing is in progress.** Branch the next item from an up-to-date
`main`.

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

1. **invite-only-signup** · M1 · branch `feat-invite-only-signup`
   An invite code is required to sign up, in every environment — the site
   address is public, the community is not. Adds the `InviteCode` table
   and an invite-code section to Admin › Members. Spec saved verbatim
   below. **`prep-beta-launch` no longer defines its own invite codes**;
   it reuses this.

2. **chat-plus-rendering** · M1 · branch `feat-chat-plus-rendering`
   Replies render Markdown — tables, code blocks with a copy button — and
   the four Chat welcome cards become **기능 둘러보기**, example prompts
   (표 만들기, 파일 요약, 차트 그리기, 웹페이지 만들기). Spec below.

3. **chat-plus-files** · M1 · branch `feat-chat-plus-files`
   Images, PDF, CSV and text attached to a message through the storage
   interface, with limits, an estimated cost before sending and Korean
   errors. Spec below.

4. **chat-plus-artifacts** · M1 · branch `feat-chat-plus-artifacts`
   HTML, SVG and chart previews in a sandboxed iframe (srcdoc,
   `allow-scripts` only, no same-origin, no network), with 코드 보기,
   다운로드 and Builder로 보내기. Spec below.

5. **test-database-isolation** · M1 · branch `fix-test-database-isolation`
   ⚠ **Must be done before `prep-beta-launch`, not after.** Spec below.
   The test suite writes to the database named by `DATABASE_URL` — the
   one the developer runs the product on. Found on 2026-10-07, after it
   put a branch's table into the development database and left
   `alembic upgrade head` unable to run.

   **Open check before item 6 — Phase 2's point 10 (real key).** One
   short real message with the owner's key; see **Now**. Not a branch,
   but `prep-beta-launch` does not start until it has been run.

6. **prep-beta-launch** · M1 · no branch named yet
   The invite-only beta on a real domain. Spec saved verbatim below,
   keeping its **Launch data rules** section. ⚠ **Costs money** — the
   domain is already bought (`ctrlai.my`); the rest is one Google Cloud
   VM on the 90-day free trial, started only at the deploy step. See
   **Hosting decisions** in its spec; ask before creating anything.
   **Do not start before item 5**, nor before Phase 2's point 10.
   Running the suite against a live database is a different order of
   mistake once the database holds members' work rather than one
   developer's test rows. **Storage on the VM** now also holds chat
   attachments (`chat-plus-files`): its 30 GB disk budget is in that
   spec.

### Merge order

Nothing is waiting. Branch the next item from an up-to-date `main`.

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
  Two budgets per member per quarter named by provider, the club pool,
  the reserve and the quarter report. Full spec below, including
  **Application flow** and **Application and purchase model (decided)**.
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
  providers; and what the 팀장 needs from the app as Concur evidence —
  most likely point 6's quarter report (headcount, purchase per provider,
  usage), plus the purchase records in *Application and purchase model*
  point 3.
- **Expense filing stays out of scope.** The app records purchases; it
  does not talk to Concur.

The owner still confirms the decisions before `budget-by-provider` leaves
this section.

Three things to carry into **budget-by-provider**:

- **The Budget section already exists**, defined in
  `frontend/app/admin/sections.ts` with `hidden: true` and the route
  `/admin/budget`. Deleting that one line turns it on everywhere —
  sidebar, tabs, breadcrumbs, the dashboard card and the page heading.
  Its label is already English.
- **A section is named once.** All eleven names live in that same file,
  and screens read them through `sectionLabel(key)` rather than writing
  their own heading. A new section needs an entry there, not a string in
  a component. `__tests__/admin-sections.test.ts` asserts the visible
  list and that every name is English, so adding one touches that test.
- **The budget rename lands on 동아리 지원, not 공동체 지원.** Item 1 of
  the spec renames the Build budget to Claude; the pot it comes out of
  is called 동아리 지원 on screen, and `FUNDING_LABEL` in
  `frontend/lib/quarters.ts` is where that word is written. The
  `FundingSource` *values* are still `community_build` /
  `community_video` — ui-naming deliberately left the data alone, so a
  provider rename there is a real migration, not a label change.

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

- **Everything is charged to Build**, through the same `charge()` as a
  chat reply: tokens × the chosen model's catalogue price × the rate,
  rounded up. No new budget category, no flat fees. A failed call is free,
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

**Charged:** unchanged — Build, by the token. Tables and code are longer
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
5. **Prompt caching** turns on with this item, because a file resent on
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

**Charged:** Build, by the token, with the cache split above. Uploading
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

**Charged:** Build, by the token, as any reply. Previews, downloads and
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

## prep-beta-launch — full spec

No branch named yet. Rewritten on 2026-10-01: the item used to be only the
launch data rules, and now carries the full beta specification. Saved
exactly as written by the developer.

**Last in the queue: position 4 in Next as of 2026-10-07.** The
order is still deliberate: the beta is an invite-only launch whose one real
feature is Claude chat, so Phase 2 (position 1) and `invite-only-signup`
(position 2) both have to exist first, and `test-database-isolation`
(position 3) has to land before the suite can be pointed anywhere near a
live database. Everything else ships behind a test-mode label. Launching last still means every build-out item in
**Next** is done before anything is exposed on a public domain.

**The invite codes are no longer this item's work.**
`invite-only-signup` at position 2 owns them, and requires a code in every
environment rather than only in the beta — so by the time this item runs,
signup is already closed. Two parts of the spec below are therefore
already satisfied when it starts:

- **point 2's first bullet** ("Signup requires an invite code; Admin can
  create and revoke invite codes, written to the audit log") — verify it
  holds under `APP_ENV=beta` rather than build it; and
- **point 5's "invite-only signup" test**, which `invite-only-signup`
  writes.

The rest of point 2 — the beta banner, the test-mode labels, disabled
top-ups, dev tools unavailable, the feedback form — is untouched and is
still this item's work. The spec below is kept verbatim; this note records
what moved, not an edit to the developer's words.

**This is the item that costs money** — originally a domain, a frontend
host, a backend host and a managed PostgreSQL. **Superseded for the beta
by Hosting decisions below (2026-10-07):** the domain is bought, and
everything runs on one Google Cloud VM on the free trial. CLAUDE.md
section 21 rule 5 and section 20's Phase 9 both still apply: ask before
creating any paid cloud resource. Point 4 below says the same thing.

> Goal: an invite-only beta on my own domain, with real Claude chat and everything else clearly labelled as test mode.
>
> 1. Production readiness: backend Dockerfile (binds 0.0.0.0 and $PORT, runs alembic upgrade head as a documented step), all production settings from environment variables (backend URL for the Next.js /api rewrite, CORS origins, secure cookies, cookie domain, APP_ENV, DATABASE_URL), documented in .env.example with ctrlai.example as the placeholder domain.
> 2. APP_ENV=beta:
>    - Signup requires an invite code; Admin can create and revoke invite codes, written to the audit log.
>    - A visible Korean beta banner on every page.
>    - Features still on mock providers stay usable but are clearly labelled "테스트 모드 – 실제 AI 결과가 아닙니다".
>    - Personal top-ups and any real-money features are disabled.
>    - Development-only tools (simulator, sample data, dev seed) are unavailable.
>    - A feedback button on every page: a short form saved to the database and listed in Admin, next to the existing Report Issue page.
> 3. Domain layout: the frontend on the main domain (and www redirecting to it), the backend on an api subdomain; the browser only talks to the main domain through the /api rewrite.
> 4. docs/deployment.md for a beginner: step-by-step setup of the frontend host, the backend host and a managed PostgreSQL; the environment variables for each; the exact DNS records to add at my registrar; how HTTPS is issued; running migrations; taking a database backup before each update; how redeploys work after each merged item; and keeping Anthropic auto-reload OFF. Mark every step that costs money, and never create cloud resources without asking me.
> 5. Tests: invite-only signup, beta banner and test-mode labels, disabled top-ups, dev tools unavailable outside development, feedback saved, production refuses default admin passwords.

**`APP_ENV=beta` is a third environment**, alongside `development` and
production. `Settings.is_development` currently decides what is hidden
(the dev tools, the usage simulator's 404), and a beta instance is not
development — so point 2's list needs that distinction drawn explicitly
rather than inherited.

**Point 4 creates `docs/deployment.md`**, which does not exist today. Its
"keep Anthropic auto-reload OFF" line is the same operator note
`budget-by-provider` point 6 asks for; that item is deferred and this one
is in **Next**, so the file will already exist whenever it is picked up.

### Launch data rules

Added 2026-10-01. Saved exactly as written by the developer.

> - The production database starts empty: run migrations, then create only the admin account from ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD in the environment. No test members, sample projects, videos, usage or audit entries.
> - The development seed (dev, testmember, test accounts, sample data) must refuse to run unless APP_ENV=development, with a test proving it.
> - The app refuses to start in production if the admin password is a known default (devpassword, admin, password, or the .env.example placeholder).
> - Never copy the local database to production; the deployment guide says so explicitly.
> - Add a development-only "reset local test data" script that wipes and reseeds the local database, documented in the README.

### Hosting decisions — 2026-10-07

Decided by the owner. **Where these conflict with points 1, 3 and 4
above, or with Phase 9 in `CLAUDE.md`, these win for the beta.** Points 2
and 5 and the Launch data rules are unchanged.

**Point 1 changes in two details only; the rest of it stands:**

- **The domain is `ctrlai.my`**, not the `ctrlai.example` placeholder —
  in `.env.example` and everywhere else point 1 mentions a domain.
- **`BACKEND_ORIGIN` is a build argument, not a runtime environment
  variable.** Point 1 lists "backend URL for the Next.js /api rewrite"
  among the settings read from the environment, but Next.js compiles
  rewrites at build time, so the value has to be supplied when the image
  is built (see **Images are built off the VM** below). The other point 1
  settings — CORS origins, secure cookies, cookie domain, `APP_ENV`,
  `DATABASE_URL` — are runtime environment variables as written.

- **Domain: `ctrlai.my`, already bought.** Use it instead of
  `ctrlai.example` in `.env.example` and `docs/deployment.md`. DNS at the
  registrar: `@` A → the VM's static IP; `www` CNAME → `ctrlai.my`
  (Caddy redirects to the apex). Keep point 3's `api` subdomain only if
  it is useful; if it exists, FastAPI's `/docs` must not be public in
  `APP_ENV=beta`.
- **One host, not two hosts and a managed database.** A single Compute
  Engine **e2-micro** VM in `us-west1`, `us-central1` or `us-east1` (the
  Always Free regions), 30 GB *standard* persistent disk, a reserved
  static external IP, firewall open on 80 and 443 only. Docker Compose
  runs four services: `caddy` (80/443, automatic Let's Encrypt HTTPS),
  `web` (Next.js standalone output), `api` (FastAPI) and `db`
  (`postgres:16-alpine`, **no published port**, a named volume).
- **No Cloud SQL, Cloud Run or Secret Manager for the beta.** Cloud SQL
  has no free tier (the smallest instance is about $10 a month with
  storage). Secret Manager comes after the beta.
- **Production secrets live in a `.env` on the VM — a beta-only exception
  to `CLAUDE.md` section 17, decided by the owner.** It holds as long as
  every condition holds:
  - the file is readable only by the deploy user (`chmod 600`);
  - it is never committed and never baked into a Docker image — the
    compose file passes it at run time;
  - the Anthropic key has a **monthly spend limit** set in the Anthropic
    Console;
  - **every key is rotated** when the secrets move to Secret Manager
    after the beta.
- **Images are built off the VM.** 1 GB of RAM cannot run `next build`.
  GitHub Actions builds both images and pushes them to ghcr.io; the VM
  only pulls. Next.js rewrites are compiled at build time, so
  `BACKEND_ORIGIN` (`http://api:8000`) is a **build argument**, not a
  runtime variable. The VM gets a 2 GB swap file.
- **Billing: the Google Cloud 90-day / $300 free trial, activated at the
  deploy step — not before.** The trial clock starts at sign-up, so
  everything this item can do locally (including running the production
  compose file on a laptop) is finished first. Set a budget alert on day
  one. **Before day 90 the account must be upgraded to paid, or the VM
  stops;** after the upgrade an e2-micro in those regions stays free.
  `docs/deployment.md` says both, with the date to act.
- **The first background job runs from host cron:** once a day,
  `docker compose exec api python -m app.jobs.anonymise_withdrawn`.
- **Backups:** `pg_dump` from the `db` container before every update,
  kept off the VM.
- **Growing later is configuration, not a rewrite**, and
  `docs/deployment.md` lists the paths: resize the VM (e2-small or
  e2-medium, a few minutes of downtime); move PostgreSQL to Cloud SQL by
  dump and restore plus a new `DATABASE_URL`; move to the Seoul region by
  disk snapshot and a DNS change; or run the same images on Cloud Run.
  Each one ends the free tier for what it touches.

---

→ **ui-tube-watch — full spec (merged 2026-10-02)** moved to [`archive/done-specs.md`](archive/done-specs.md#ui-tube-watch--full-spec-merged-2026-10-02).

→ **ui-apps-detail — full spec** moved to [`archive/done-specs.md`](archive/done-specs.md#ui-apps-detail--full-spec).

## budget-by-provider — full spec

Branch `feat-budget-by-provider`. Saved exactly as written by the
developer.

**Deferred on 2026-10-02** to *After the prototype (needs discussion)*:
the cost model is still being decided, so do not start this until the
owner confirms. The spec below is unchanged. Two things it had been
promised no longer hold, because the items that promised them now run
first:

- **It no longer owns the `UsageEvent` migration.** Phase 2 — Chat adds
  the columns it writes, and `video-higgsfield-only` records its own
  fields; point 2 here extends that shape rather than creating it.
- **Point 4's reserve does not exist yet when `account-withdrawal`
  runs.** That item releases a withdrawing member's remaining allocation
  and audits it; routing the released amount into the reserve is a line
  this item adds once the reserve is real.

> Context: the club applies to the company each quarter for funding split by provider (Claude vs Higgsfield). The app must mirror that exactly.
>
> 1. Two budgets per member per quarter, named by provider: "Claude" and "Higgsfield". Rename the current Build budget to Claude everywhere (data, API, UI, docs) with an Alembic migration that keeps existing data. Chat, Project Builder and the Video prompt helper all charge Claude; video generation, editing and extension charge Higgsfield.
> 2. Every UsageEvent records: provider, feature tag (chat / build / video_prompt / video_generate / video_edit / video_extend), the native unit and amount (Claude input and output tokens; Higgsfield credits), the KRW amount, and the rate used for conversion. Conversion rates live in an admin-editable settings table with history, so past events keep the rate they were charged at.
> 3. Club pool per quarter and provider: the admin enters the company-approved amount for Claude and for Higgsfield. Member allocations plus reserve can never exceed the pool (enforced in the backend).
> 4. Reserve: by default 20% of each provider pool is held back as club reserve; the admin can change this percentage per quarter. Members can request extra budget from Usage with a short reason; admin approves or rejects in Admin, paid from the reserve, written to the audit log.
> 5. Admin pool dashboard per provider: approved pool, allocated to members, actually used, reserve remaining, usage by feature tag.
> 6. Quarter report: Admin can download a CSV (and an on-screen summary) per quarter with usage by provider and feature, native units and KRW, number of active members, and utilisation rate, for the next funding application.
> 7. Member side: Usage shows the two provider budgets, with usage broken down by feature. A one-time notice at 80% used. Before any Higgsfield action, show the estimated cost in KRW next to the button.
> 8. Members cannot move budget between providers.
>
> Tests: allocations plus reserve cannot exceed the pool, the default reserve is 20%, reserve requests deduct from the reserve, usage events store native units and the rate, rate changes do not alter past events, the CSV totals match the database, and every feature charges the correct provider.

### Application flow

Added 2026-10-01. Saved exactly as written by the developer.

**Point 4's approval path is superseded** by "Application and purchase
model (decided)" below: approval is automatic, and these tools serve
수동 승인 mode and exceptions. Everything else here still stands.

> Goal: member applications feed the club's funding application to the company.
>
> 1. Application form: presets 균형 50/50, Claude 중심 70/30, 영상 중심 30/70, or a custom split, within the quarter's per-member limit. Show a rough plain-language meaning of each budget (e.g. approximate video seconds at the default model's price).
> 2. 신청 합계 view in Admin: total requested per provider, number of applicants, list of members who have not applied yet with the deadline countdown, and a CSV export for the company application. Show the suggested company request = member totals + reserve (default 20%, on top of member totals, not taken out of them).
> 3. After the company decides, the admin enters the approved pool per provider. If the pool covers all requests plus reserve, approvals give members exactly what they asked for. If it is smaller, show a proportional cut preview per member before applying, then hold the reserve at the configured percentage of the approved pool.
> 4. Approving: single approve, approve with adjustment (changed split or amount, required reason, written to the audit log), bulk approve with one confirmation, reject with a reason the member sees on Profile.
> 5. Active status and budget go together: a member becomes active for a quarter through an approved application, or through admin enrolment that also sets an allocation. If an admin sets a member active without any allocation, show a warning in Admin, and the member's sidebar says clearly that no budget is approved yet. (Currently testmember2 shows 활동 회원 with "승인된 지원금이 없습니다".)
> 6. Tests: totals match applications; the suggested request includes the reserve on top; the proportional cut never exceeds the pool; adjustments and bulk approvals are audited; rejected members see the reason; active-without-allocation shows the warning.

### Application and purchase model (decided)

Added 2026-10-01. Saved exactly as written by the developer.

**This section wins where it conflicts with Application flow above.**
Auto-approval is the normal path: a member presses "이번 분기 참여" and the
allocation exists immediately, with no admin step in between. The approval
tools in Application flow point 4 — single approve, approve with
adjustment, bulk approve, reject with a reason — are all kept, but they
serve **수동 승인** mode and the exceptions named in point 1 below
(requests above the per-member limit, late applications, reserve
requests), not the ordinary case.

**Why this reshapes the item.** Both providers are prepaid. The money is
spent *before* any member uses it, and credits cannot be moved between
providers once bought — so the club must know the per-provider split in
time to buy. That turns the application period into a purchasing
deadline rather than a review queue, and it adds three things the
original spec has nowhere to put: purchase records, club-level provider
balance tracking, and carry-over between quarters.

**Still to settle:** Application flow point 3 assumes allocations are
created *after* the company decides, which is what makes its proportional
cut preview possible. Under auto-approval the allocations already exist by
then, so a pool smaller than the requests has to cut allocations that
members can already see. The cut preview itself is unaffected; when it
runs, and what a member is told when their approved budget drops, is not
decided here. **See *Funding model — 2026-10-07* above:** with credit
bought per headcount after applications close, this mostly no longer
arises.

**Point 6's operator note has a home again — the 2026-10-02 reorder
reversed this twice.** `docs/deployment.md` does not exist today, but
`prep-beta-launch` point 4 creates it, and that item is now in **Next**
while this one is deferred — so by the time this runs the file exists and
already carries the "keep Anthropic auto-reload OFF" line. Add the
manual-top-up guidance there rather than creating a second file. (If the
order moves again and this item lands first, write the same guidance into
a new `docs/operations.md` and have whichever lands second point at the
first, rather than duplicating it.)

> Context: Claude API and Higgsfield are both prepaid. Credits must be bought per provider before use and cannot be moved between providers afterwards, so the club needs each quarter's split before buying.
>
> 1. One-click application with auto-approval:
>    - During the application period, a member presses "이번 분기 참여". The split is pre-filled with a default (admin-set per quarter: 50/50, or last quarter's club-wide ratio) and the member may adjust it with the presets or a custom split, within the per-member limit.
>    - Applications are approved automatically. The admin can switch a quarter to "수동 승인" mode if needed; in that mode the existing 신청 승인 flow applies.
>    - Exceptions still reach the admin: requests above the limit, late applications, and reserve requests.
> 2. Purchase planning (Admin › 예산), after the application period closes:
>    - Suggested purchase per provider = member totals + reserve (default 20%, on top) − usable balance carried over from earlier purchases.
>    - Shows the KRW total and, for Claude, the USD equivalent at the current rate setting.
> 3. Purchase records: the admin records each actual purchase (provider, date, amount paid in KRW and original currency, credits received, expiry date). Claude credits expire one year after purchase; the app warns 30 days before any purchased credits expire.
> 4. Provider balance tracking: per provider, purchased − used = remaining club balance, shown on the 예산 page and the dashboard. If a provider's remaining club balance falls below the reserve, show a warning card.
> 5. Carry-over: unused, unexpired balance carries into the next quarter and reduces that quarter's suggested purchase.
> 6. Docs: add a short operator note to docs/deployment.md (or a new docs/operations.md): keep auto-reload OFF in the Anthropic Console and any Higgsfield equivalent, and top up manually from the reserve, because the club budget is fixed.
>
> Tests: auto-approval creates allocations immediately; manual mode routes to 신청 승인; the suggested purchase includes the reserve and subtracts carry-over; balances equal purchases minus usage; expiry warnings appear 30 days before.

---

## usage-analytics — full spec

Branch `feat-usage-analytics`. Added 2026-10-01. Saved exactly as written
by the developer.

**Deferred on 2026-10-02 along with `budget-by-provider`**, to *After the
prototype (needs discussion)*. The spec is unchanged.

**Why it must stay directly after budget-by-provider.** Every chart here
reads the `UsageEvent` fields that item adds — provider, feature tag,
native units and KRW. Point 1 below also says where the exact model goes:
into budget-by-provider if that item has not already recorded it,
otherwise into this one with its own migration. Phase 2 — Chat records
provider, feature tag, model, tokens, USD, rate and KRW when it lands, so
by the time these two are taken up some of that shape already exists.

> Depends on budget-by-provider (UsageEvent with provider, feature tag, native units and KRW).
>
> 1. Every UsageEvent also records the exact model used (e.g. the Claude model name, or the Higgsfield model ID from the 영상 모델 catalogue). Add this field in budget-by-provider if it is not already there, otherwise add it here with a migration.
> 2. Admin › 사용량 분석 (/admin/analytics), admin-only, added to the Admin tabs, sidebar sub-menu and dashboard cards:
>    - Time-series charts by day or week, within a quarter or a custom date range.
>    - Breakdown by provider and by model, with a toggle for the measure: KRW, native units (Claude tokens split into input/output; Higgsfield credits and video seconds), or request count.
>    - Filters: quarter, provider, model, feature tag (chat / build / video_prompt / video_generate / video_edit / video_extend), member.
>    - Summary cards: total KRW per provider, the most-used model per provider, average cost per request, and share of the pool used.
>    - Top members by usage, a data table matching the chart, and CSV download of exactly what is shown.
> 3. Member side: the Usage page gets a "내 사용량" chart of their own usage over the current quarter by provider and feature. Members never see other members' data.
> 4. Charts use one charting library consistent with the design tokens (dark theme, provider colours: Claude = build accent, Higgsfield = video accent), with Korean labels, tooltips with exact values, tabular numbers, and a Korean empty state.
> 5. Development data: extend the dev-only usage simulator to choose a provider, model and feature, and add a dev-only "샘플 사용 기록 생성" action that creates 30 days of realistic usage across members and models. Both are unavailable outside APP_ENV=development.
> 6. Performance: aggregate in the database (grouped queries), not in the browser.
>
> Tests: totals in the charts and the CSV match the database; filters change the results correctly; members cannot request other members' data; analytics routes are admin-only; sample-data tools return 404 outside development.

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

**Charged:** Build, by the token plus per search. A typical question with
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
member can go back to. Charged to Build by the token; a generation may
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

**Charged:** Build for generation (tokens). Hosting costs nothing per app;
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
   prompt (Build, tokens); the image provider generates (the image
   budget, per image); the result is stored through the storage interface
   as a chat attachment with 다운로드.
5. **Which budget — not decided here.** Google is a different prepaid
   provider; credit cannot move between Anthropic and Google. Options for
   the owner: (a) a third pot under budget-by-provider — the clean
   answer; (b) until then, charge Video, which already pays a non-Claude
   provider — simplest, but it blurs the per-provider purchase the 팀장
   files in Concur.
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
