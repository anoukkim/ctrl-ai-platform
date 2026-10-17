# UI request screenshots and mock-ups

Images and static HTML mock-ups referenced by items in [`../BACKLOG.md`](../BACKLOG.md) — usually a
"before" screenshot attached to a UI request, kept so the item still makes
sense months later when the screen it describes has already changed.

Naming: `<backlog-item>-<what-it-shows>.png`, e.g. `admin-before.png`.

Keep them small. A screenshot is documentation, not an asset the product
loads, so a PNG at normal window width is enough — nothing here is served
to a member.

## What is here

| File | Referenced by | Shows |
| ---- | ------------- | ----- |
| `admin-before.png` | `admin-restructure` | The single-page Admin screen before the restructure: ten sections on one route, mixed English and Korean labels, small inline action buttons. |
| `running-state-calm-chat.html` | `running-state-calm` | Chat while a reply with a 미리보기 is being written: calm composer, stage chips, flowchart skeleton, faint aurora with an on/off switch. Open it in a browser; stages, time and cost are fake. |
| `running-state-calm-builder.html` | `running-state-calm` | Project Builder while a version is built: preview pane and chat panel show the same stage, time and activity log. Fake values. |
| `spend-toast-compact.html` | `spend-toast-compact` | The 썼어요 toast today (big card, stars flying to the wallet) next to the proposal (one-line pill, stars only twinkling at the wallet); a 현재 / 제안 switch and 다시 보기. Fake amounts. |
| `builder-first-build-running.html` | `builder-first-build-running` | Project Builder's first build (empty project): the 만들 계획 kept, with the shared stage list, timer, sweep and a growing file list on the left, and the Claude panel narrating. Fake values. |
| `publish-done-popup.html` | `publish-done-popup` | 게시 완료 today (full-screen letters and confetti) next to a popup card (A) and a one-line pill (B). Click a card to replay. |
| `chat-preview-fullscreen.html` | `chat-preview-fullscreen` | Chat's 미리보기 card with the new 전체 화면 button and its overlay (새로고침, 폰/데스크톱, 닫기 / Esc). |

HTML mock-ups are single files with no network access and no build step —
double-click to open. Like the screenshots, they are documentation, not
product code; rebuild from the real components rather than copying them.
