# Roadmap

Milestones, and what is done in each. **Order within a milestone is set
by [`BACKLOG.md`](BACKLOG.md) › Next (in order)**, not here. Old phase
numbers from the phase plan (`archive/phases.md`) are in brackets; phases are now
feature names, not the plan.

| | Milestone | Status |
| - | --------- | ------ |
| M0 | Foundation | ✅ done |
| **M1** | **Beta launch** | **in progress — the item list below has the ticks** |
| M2 | Real creation | not started (chat-plus-tools being built mock-first in the 2026-10-14 batch) |
| M3 | Sharing | not started |
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
✅ live-cost-display · ✅ chat-plus-tools · ⬜ cost-clarity (2026-10-14
evening, first in Next) · ⬜ chat-plus-files · ⬜ chat-plus-artifacts ·
⬜ chat-thinking-view · ⬜ offsite-backups 💳 · ⬜ monitoring 💳 ·
⬜ anonymous-feedback-board · ✅ prep-beta-launch [9, beta subset] (merged 2026-10-13; deployed to
`ctrlai-server`, e2-medium in Seoul, on mock providers).
The three `chat-plus-*` items joined on 2026-10-07: members have never
used Claude, so Chat shows what it can do — tables, files, previews —
before the site opens.
Also shipped: ui-polish (themes, Pretendard, collapsible sidebar,
Draft / 게시됨 status).

**M2 Real creation** — members make real videos and real projects.
⬜ real Higgsfield adapter [6] · ⬜ builder-python (after builder-static-runtime) ·
⬜ builder-static-runtime (the Builder
MVP [3] plus static member apps on `apps.ctrlai.my` — owner decision
2026-10-14; in Next) ·
⬜ chat-plus-tools (web search, web fetch, code execution in Chat —
**moved into Next on 2026-10-14**, mock tools only, after token-guard and
live-cost-display) ·
⬜ image-generation (waits on the budget-by-provider decision).

**M3 Sharing** — work leaves CTRL+AI and comes back as community posts.
⬜ GitHub [4] · ⬜ CtrlAIApps [5] (first slice: ctrlaiapps-publish and
example-apps, in Next) · ⬜ signup-google-first (after the beta) · ⬜ YouTube [7] · ⬜ CtrlAITube [8] ·
⬜ more-chat-providers (optional; Gemini, Grok, DeepSeek or an aggregator —
decided with budget-by-provider; `deepseek-research` reports on DeepSeek).

**M4 Running costs** — the club can buy, track and justify provider
credit. ⬜ budget-by-provider · ⬜ usage-analytics · ⬜ purchase records /
Concur evidence. Held in BACKLOG › *After the prototype* until the owner
confirms the cost model.

**Later** — ⬜ secure runtime for member apps (isolated containers,
resource limits).

The full go-live beyond the beta [9] — managed PostgreSQL, Secret Manager,
real OAuth callbacks — lands with the milestone that first needs it. The
earlier phase table is kept in
[`archive/phase-table.md`](archive/phase-table.md).
