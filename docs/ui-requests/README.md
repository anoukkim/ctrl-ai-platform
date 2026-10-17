# UI request screenshots and mock-ups

Images and static HTML mock-ups referenced by items in [`../BACKLOG.md`](../BACKLOG.md) — usually a
"before" screenshot attached to a UI request, kept so the item still makes
sense months later when the screen it describes has already changed.

Naming: `<backlog-item>-<what-it-shows>.png`, e.g. `admin-before.png`.

Keep them small. A screenshot is documentation, not an asset the product
loads, so a PNG at normal window width is enough — nothing here is served
to a member.

## What is here

The mock-ups of the items finished by 2026-10-17 moved to
[`../archive/ui-requests-2026-10/`](../archive/ui-requests-2026-10/) (docs tidy-up, 2026-10-17); the table
below names them where they now live. New mock-ups go in this folder again.

| File | Referenced by | Shows |
| ---- | ------------- | ----- |
| [`admin-before.png`](../archive/ui-requests-2026-10/admin-before.png) | `admin-restructure` | The single-page Admin screen before the restructure: ten sections on one route, mixed English and Korean labels, small inline action buttons. |
| [`running-state-calm-chat.html`](../archive/ui-requests-2026-10/running-state-calm-chat.html) | `running-state-calm` | Chat while a reply with a 미리보기 is being written: calm composer, stage chips, flowchart skeleton, faint aurora with an on/off switch. Open it in a browser; stages, time and cost are fake. |
| [`running-state-calm-builder.html`](../archive/ui-requests-2026-10/running-state-calm-builder.html) | `running-state-calm` | Project Builder while a version is built: preview pane and chat panel show the same stage, time and activity log. Fake values. |
| [`spend-toast-compact.html`](../archive/ui-requests-2026-10/spend-toast-compact.html) | `spend-toast-compact` | The 썼어요 toast today (big card, stars flying to the wallet) next to the proposal (one-line pill, stars only twinkling at the wallet); a 현재 / 제안 switch and 다시 보기. Fake amounts. |
| [`builder-first-build-running.html`](../archive/ui-requests-2026-10/builder-first-build-running.html) | `builder-first-build-running` | Project Builder's first build (empty project): the 만들 계획 kept, with the shared stage list, timer, sweep and a growing file list on the left, and the Claude panel narrating. Fake values. |
| [`publish-done-popup.html`](../archive/ui-requests-2026-10/publish-done-popup.html) | `publish-done-popup` | 게시 완료 today (full-screen letters and confetti) next to a popup card (A) and a one-line pill (B). Click a card to replay. |
| [`chat-preview-fullscreen.html`](../archive/ui-requests-2026-10/chat-preview-fullscreen.html) | `chat-preview-fullscreen` | Chat's 미리보기 card with the new 전체 화면 button and its overlay (새로고침, 폰/데스크톱, 닫기 / Esc). |
| [`admin-consolidation.html`](../archive/ui-requests-2026-10/admin-consolidation.html) | admin consolidation (proposal, [`admin-consolidation.md`](admin-consolidation.md)) | Admin cut from 13 sections to 6, in the real shell: Dashboard (처리할 일), Members (+ 사용률 열), Quarters (예산 + 사용 분석), Models, Community, System, plus the member detail 사용 내역. Static, fake figures. |
| [`admin-consolidation-v3.html`](../archive/ui-requests-2026-10/admin-consolidation-v3.html) | admin consolidation v3 (built in 4 batches) | The approved v3: header search, Dashboard alerts, the member panel, 돈의 흐름, the 분기 마감 stepper, 사용 분석, System's 공지 띠. |
| [`app-tab-icon-options.html`](../archive/ui-requests-2026-10/app-tab-icon-options.html) | `app-tab-icon` | Options for a published app's browser-tab icon. |
| [`logo-options.html`](../archive/ui-requests-2026-10/logo-options.html) | logo A + app icon | The CTRL+AI logo options (A chosen). |

HTML mock-ups are single files with no network access and no build step —
double-click to open. Like the screenshots, they are documentation, not
product code; rebuild from the real components rather than copying them.
