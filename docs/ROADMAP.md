# Roadmap

Milestones, and what is done in each. **Order within a milestone is set
by [`BACKLOG.md`](BACKLOG.md) › Next (in order)**, not here. Old phase
numbers from `CLAUDE.md` section 20 are in brackets; phases are now
feature names, not the plan.

| | Milestone | Status |
| - | --------- | ------ |
| M0 | Foundation | ✅ done |
| **M1** | **Beta launch** | **in progress — 3/9** |
| M2 | Real creation | not started |
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
✅ chat-model-choice · ⬜ invite-only-signup ·
⬜ chat-plus-rendering · ⬜ chat-plus-files · ⬜ chat-plus-artifacts ·
⬜ test-database-isolation · ⬜ prep-beta-launch [9, beta subset].
The three `chat-plus-*` items joined on 2026-10-07: members have never
used Claude, so Chat shows what it can do — tables, files, previews —
before the site opens.
Also shipped: ui-polish (themes, Pretendard, collapsible sidebar,
Draft / 게시됨 status).

**M2 Real creation** — members make real videos and real projects.
⬜ real Higgsfield adapter [6] · ⬜ builder-static-runtime (the Builder
MVP [3] plus static member apps on a separate, sandboxed origin) ·
⬜ chat-plus-tools (web search, web fetch, code execution in Chat) ·
⬜ image-generation (waits on the budget-by-provider decision).

**M3 Sharing** — work leaves CTRL+AI and comes back as community posts.
⬜ GitHub [4] · ⬜ CtrlAIApps [5] · ⬜ YouTube [7] · ⬜ CtrlAITube [8] ·
⬜ more-chat-providers (optional; Gemini, Grok or an aggregator — decided
with budget-by-provider).

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
