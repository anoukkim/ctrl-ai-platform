# Roadmap

Milestones, and what is done in each. **Order within a milestone is set
by [`BACKLOG.md`](BACKLOG.md) › Next (in order)**, not here. Old phase
numbers from the phase plan (`archive/phases.md`) are in brackets; phases are now
feature names, not the plan.

| | Milestone | Status |
| - | --------- | ------ |
| M0 | Foundation | ✅ done |
| **M1** | **Beta launch** | **in progress — every item shipped except owner-polish point 12; the real-Claude check (BACKLOG › Now, point 10) waits for the owner** |
| M2 | Real creation | in progress — the Builder shipped; real Higgsfield, builder-python and image-generation open |
| M3 | Sharing | in progress — CtrlAIApps and the app platform (P1–P4b) shipped; GitHub, YouTube and app-platform P5 open |
| M4 | Running costs | needs discussion |
| Later | Secure runtime | not started |

**M0 Foundation** ✅ — a local product shell with accounts, quarters and
real money rules, nothing exposed.
✅ product shell [0] · ✅ auth [1a] · ✅ membership [1b] · ✅ usage ledger
and audit log [1c] · ✅ project-video-management · ✅ account-withdrawal.
Also shipped: UI batch 1, membership-access-fix, admin-restructure,
ui-naming, fix-video-workspace-hang, ui-tube-watch, ui-apps-detail.

**M1 Beta launch** — an invite-only beta on `ctrlai.my` with real Claude
chat, everything else labelled test mode.
✅ video-higgsfield-only [6, mock] · ✅ Phase 2 Chat [2] (real-key check still open) ·
✅ chat-model-choice · ✅ single-wallet · ✅ prompt-caching ·
✅ cost-calibration · ✅ chat-builder-starter · ✅ invite-only-signup ·
✅ test-database-isolation · ✅ google-login · ✅ ui-friendly-motion ·
✅ chat-plus-rendering · ✅ member-password-login ·
✅ admin-and-nav-cleanup (2026-10-14: Report Issue and Dev Tools gone,
AI Models by provider) · ✅ fix-beta-blockers · ✅ personal-topup-off ·
✅ privacy-and-terms (owner reviews the text) · ✅ token-guard ·
✅ live-cost-display · ✅ chat-plus-tools (web search, web fetch, code
execution in Chat; merged 2026-10-14) · ✅ cost-clarity · ✅ chat-plus-files ·
✅ chat-plus-artifacts · ✅ chat-thinking-view · ✅ offsite-backups 💳 ·
✅ monitoring 💳 · ✅ quality-tuning (Q0–Q3) · ✅ owner-polish-2026-10-16
(all but point 12, image provider research — the owner's decision) ·
✅ motion-modern · ✅ admin-consolidation (v3, four batches, 2026-10-17) ·
anonymous-feedback-board — not built: the owner chose admin-only feedback
with screenshots instead (✅ feedback-screenshots, 2026-10-16) ·
✅ prep-beta-launch [9, beta subset] (merged 2026-10-13; deployed to
`ctrlai-server`, e2-medium in Seoul, on mock providers) ·
⬜ Phase 2 point 10 — one real Claude message (owner's step).
The three `chat-plus-*` items joined on 2026-10-07: members have never
used Claude, so Chat shows what it can do — tables, files, previews —
before the site opens.
Also shipped: ui-polish (themes, Pretendard, collapsible sidebar,
Draft / 게시됨 status), fix-ui-polish-admin, feat-spend-feedback,
fix-quarter-form-autofill, ui-improvements A and B, feat-notifications,
chat-pins, chat-list-collapse, running-state-calm, chat-preview-fullscreen,
spend-toast-compact, logo A. Dates and merges in
[`archive/done.md`](archive/done.md).

**M2 Real creation** — members make real videos and real projects.
⬜ real Higgsfield adapter [6] · ⬜ builder-python (after builder-static-runtime) ·
✅ builder-static-runtime (the Builder
MVP [3] plus static member apps on `apps.ctrlai.my`; merged 2026-10-14) ·
⬜ image-generation (waits on the budget-by-provider decision).
Also shipped for the Builder: project-export-handoff, quality-tuning Q2
(generation in stages), publish-summary, app-fonts, builder-snapshots,
builder-images, thumbnail-render-worker (live 2026-10-17), background-runs,
chat-to-builder-carry, builder-first-build-running.
(chat-plus-tools shipped under M1 on 2026-10-14; the ⬜ entry that also
stood here is removed.)

**M3 Sharing** — work leaves CTRL+AI and comes back as community posts.
⬜ GitHub [4] · ✅ CtrlAIApps [5] (ctrlaiapps-publish and example-apps
2026-10-14, showcase-apps 2026-10-15, comments and reactions in
ctrlaiapps-reactions 2026-10-17) · ✅ app-platform P1–P4b ("CTRL+AI 기능
상자", 2026-10-15 → 2026-10-16) · ✅ app-ai-access · ⬜ app-platform P5
(`ctrlai.files`) · ⬜ quarter-end-apps · ⬜ app-remix · ⬜ app-libraries ·
⬜ dino-avatars · ⬜ signup-google-first (after the beta) · ⬜ YouTube [7] ·
◐ CtrlAITube [8] (first slice: promo-videos 2026-10-16 — the club's own
video with reactions and comments; the YouTube feed not started) ·
⬜ more-chat-providers (optional; Gemini, Grok, DeepSeek or an aggregator —
decided with budget-by-provider; `deepseek-research` reports on DeepSeek).

**M4 Running costs** — the club can buy, track and justify provider
credit. ⬜ budget-by-provider · ◐ usage-analytics (mostly delivered by
admin-consolidation batch 3 — Quarters › 사용 분석 and the member panel's
사용 내역; owner to close) · ◐ purchase records / Concur evidence
(`CreditPurchase` rows since cost-clarity; a Concur CSV in
admin-consolidation batch 3). Held in BACKLOG › *After the prototype* until the owner
confirms the cost model.

**Later** — ⬜ secure runtime for member apps (isolated containers,
resource limits).

The full go-live beyond the beta [9] — managed PostgreSQL, Secret Manager,
real OAuth callbacks — lands with the milestone that first needs it. The
earlier phase table is kept in
[`archive/phase-table.md`](archive/phase-table.md).
