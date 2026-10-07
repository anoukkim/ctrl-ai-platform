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

**Open check carried from Phase 2 — Chat: point 10 has not been run.**
One short real message with the owner's key (`CLAUDE_PROVIDER=anthropic`,
`ANTHROPIC_MODEL=claude-sonnet-5-5`) — confirm the reply streams, the
usage event and deduction are right, and a wrong key shows the Korean
message with no charge. **It must be done before `prep-beta-launch`**,
whose one real feature is this chat; the request shape has so far only
been checked against a fake transport.

Decisions from **Phase 2 — Chat** (merged 2026-10-07) that later items
inherit — owner-approved defaults, with two changes by the owner:

- **Model: `ANTHROPIC_MODEL=claude-sonnet-5-5`** — the owner chose Sonnet
  over Opus because the club starts on a small budget. Opus 5.5 and Haiku
  4.5 are in the price table, so switching is a `.env` change only.
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

Order settled 2026-10-02, with two changes since: `budget-by-provider`
and `usage-analytics` left for *After the prototype (needs discussion)*
below, and `test-database-isolation` was inserted ahead of
`prep-beta-launch` on 2026-10-07. `project-video-management`,
`account-withdrawal` and `video-higgsfield-only` merged that day and left
the list; Phase 2 — Chat merged later the same day, so it now starts
at `invite-only-signup`. The launch items stay at the end, in the order
settled on 2026-10-01.

1. **invite-only-signup** · M1 · branch `feat-invite-only-signup`
   An invite code is required to sign up, in every environment — the site
   address is public, the community is not. Adds the `InviteCode` table
   and an invite-code section to Admin › Members. Spec saved verbatim
   below. **`prep-beta-launch` no longer defines its own invite codes**;
   it reuses this.

2. **test-database-isolation** · M1 · branch `fix-test-database-isolation`
   ⚠ **Must be done before `prep-beta-launch`, not after.** Spec below.
   The test suite writes to the database named by `DATABASE_URL` — the
   one the developer runs the product on. Found on 2026-10-07, after it
   put a branch's table into the development database and left
   `alembic upgrade head` unable to run.

3. **prep-beta-launch** · M1 · no branch named yet
   The invite-only beta on a real domain. Spec saved verbatim below,
   keeping its **Launch data rules** section. ⚠ **Costs money** — the
   domain is already bought (`ctrlai.my`); the rest is one Google Cloud
   VM on the 90-day free trial, started only at the deploy step. See
   **Hosting decisions** in its spec; ask before creating anything.
   **Do not start before item 2.** Running the suite against a live
   database is a different order of mistake once the database holds
   members' work rather than one developer's test rows.
   **Also not before Phase 2's point 10** — the one real Claude message
   with the owner's key (see **Now**). It is still open.

### Merge order

Nothing is waiting. Branch the next item from an up-to-date `main`.

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

### ui-polish — final UI pass (branch `ui-polish`, 2026-10-07)

Raised 2026-10-07 and built on `ui-polish`, which also holds the earlier
design-handoff pass (light/dark themes, variant B shape, the restyle of
every route). **Not merged.** Saved exactly as written by the developer:

> Final UI pass on the current UI branch (same branch is fine). I've attached screenshots of the Claude Design mockup; match its look. If you need the design source, tell me and I'll export it from Claude Design.
>
> 1. Typography
>    - Match the mockup's typeface. Tell me which font it is before adding it. If it's Pretendard (not on Google Fonts), self-host it from the npm package or a local woff2. That's a new dependency, so ask me first.
>    - Keep Korean rules: Hangul-first font stack, word-break: keep-all, IME check before Enter.
>    - Use the mockup's type scale: page title, the small coloured eyebrow ("● Create"), card names, body and meta. Meta lines (dates) stay in the UI font unless the mockup clearly uses monospace.
>
> 2. Sidebar
>    - Wider, like the mockup, so "함께 만들고 함께 나누는 AI 창작 커뮤니티" fits on one line, with larger nav items and more spacing.
>    - Collapsible: a toggle button collapses it to an icon-only rail (tooltips with the item names) and expands it again. Remember the choice per browser in localStorage (wrapped in try/catch, default expanded). The narrow-screen menu button keeps working.
>    - The Admin item shows the count of items waiting (pending applications/top-ups) as a small badge, like the mockup's "2".
>
> 3. Page layout
>    - The mockup's page header: eyebrow, title, subtitle, primary button on the right, divider.
>    - A wider content area, and the mockup's card style: a thumbnail area on top (video: the version thumbnail; builder: a striped placeholder labelled 미리보기 썸네일 until Phase 3), larger padding and names, badge right after the name, ⋯ on the right.
>    - Apply it consistently to Chat, Project Builder, Video Generator, CtrlAIApps, CtrlAITube, Usage, Profile and Admin, not just the two libraries.
>
> 4. Status simplification (include in this branch)
>    - Remove ARCHIVED from BuilderProjectStatus and VideoProjectStatus with an Alembic migration (map existing archived rows to draft; the downgrade re-adds the value). Keep draft, building/generating, ready and published in the DB.
>    - Library filters become exactly 전체 / Draft / 게시됨 ("Draft" = draft + ready + building/generating; "게시됨" = published), backed by the list endpoint.
>    - Badges show only "Draft" or "게시됨"; while generating, a small "생성 중…" indicator instead. Video's final version stays as the "최종본 선택됨" meta line.
>
> 5. Design tokens: every new colour, size and spacing goes into globals.css as a token; no hard-coded values in components. Dark theme stays the default. If the mockup's light theme is easy to support through the same tokens, propose it but don't build it yet.
>
> 6. Record the decisions in BACKLOG (ui-library-cards items they complete, plus the status decision), saved verbatim.
>
> Tests: the existing card-overlay and sidebar tests still pass; add tests for the collapsed sidebar (state persists, nav still reachable, tooltips present), the three filters, and badges only ever showing Draft or 게시됨.
> Check it in a browser at 1280px and 1920px wide and on a narrow screen, and send me screenshots of Chat, Builder, Video and Admin.
>
> Mock providers only, don't touch my dev DB, don't merge. Tell me the alembic step to try it.

**Decisions taken with the owner (2026-10-07):**

- **Mockup source:** no screenshots came through; the owner chose the
  Claude Design HTML export already in the repo's working tree
  (`design_handoff_ui_polish/CTRL+AI Full Site.html`). Sizes were measured
  from it in the browser.
- **Font: Pretendard Variable 1.3.9**, the mockup's font, added as the npm
  dependency `pretendard` (SIL Open Font License) and loaded from its
  **dynamic-subset** CSS in `app/layout.tsx` — self-hosted, and a page
  downloads only the Hangul ranges it shows.
- **Light theme: kept as built** on this branch (the owner's choice), with
  dark still the default. New tokens follow the same scheme.
- **Meta dates stay monospace** on the library and community cards,
  because the mockup clearly sets them in `ui-monospace`.
- **Thumbnail on top for both libraries**, as the request says, although
  the mockup draws the video card's picture as a 72×128 tile at the left.

**Status decision (owner, 2026-10-07):** `archived` is gone from both
`BuilderProjectStatus` and `VideoProjectStatus` — migration
`7c1d5e93a4b2` turns archived rows into draft and rebuilds the CHECK
constraints; the downgrade restores the value. The database keeps draft,
building/generating, ready and published. Members see only **Draft**
(draft, building/generating, ready) and **게시됨** (published), with a
"생성 중…" note while building or generating; a chosen final version is
the "최종본 선택됨" meta line. The libraries' filters are exactly
전체 / Draft / 게시됨 and come from the list endpoint
(`?status=all|draft|published`).

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

## Done

→ The Done table moved to [`archive/done.md`](archive/done.md). When an
item merges, add its row there and move its full spec to
[`archive/done-specs.md`](archive/done-specs.md).
