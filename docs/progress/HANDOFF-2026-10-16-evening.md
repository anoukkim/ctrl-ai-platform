# Handoff — 2026-10-16 evening (coordinator session → new session)

Paste into the new session: "Read docs/progress/HANDOFF-2026-10-16-evening.md and continue as coordinator."

## State

- `main` = `de6bef7` (pushed). Contains auto-continue (merge `87f157f`, migration
  `a8c4e2f6b1d9`, re-parented onto `c4e8a2d6f0b3`; single head) and the CtrlAITube
  poster (merge `4b0bbf6`). Owner approved both in the desktop session ("yes, ship it", "Yes").
- **NOT YET DEPLOYED.** The GitHub Actions `images` build for `de6bef7` was running.
  Do not push to main until it is green (a push cancels it). Local main has unpushed
  docs commits (BACKLOG (c2) + this note) — push them right after the deploy.

## Step 1 — deploy (when `images` for de6bef7 is green)

Check: https://api.github.com/repos/anoukkim/ctrl-ai-platform/actions/runs?per_page=10
(head_sha `de6bef726b02fd1344ea13e9fd9ebf3993b7efdb`, name `images`, conclusion `success`).

```bash
/opt/homebrew/share/google-cloud-sdk/bin/gcloud compute ssh ctrlai-server --zone=asia-northeast3-c --command='sudo -iu ctrlai_platform bash -lc "cd ~/ctrl-ai-platform && ./deploy/update.sh"'
```

Has a migration (`a8c4e2f6b1d9`: `segment_event_ids`, `stop_note`); update.sh backs up first.
Then check: a long chat reply continues by itself and stops at the won ceiling / 8 calls;
CtrlAITube poster is the 0:08 frame. Add a "deployed" row to `docs/progress/RUN-2026-10-16.md`
and tell window 0c the deploy is done (it may then push).

## Step 2 — the running batch (pre-approved, BACKLOG "Owner, 2026-10-16 (evening…)")

- Window **ctrl-ai-platform-0c** (⌥⌘6) builds **owner-polish-3** on `fix-owner-polish-3`:
  (a) thumbnails (whole app scaled, captured on each 미리보기 load and at 게시, Admin › Apps
  "썸네일 만들기", name+colour cover, thumbnails on CtrlAIApps cards); (b) automatic USD→KRW
  (free/keyless, `FX_PROVIDER` mock default, >5% jump not applied, admin pin, audited, never
  blocks a charge; paid service → stop and ask); (c) notifications: no spending summaries,
  only approvals / 게시 완료 / 반응을 얻었어요 / 신고 처리, **opening the bell clears the badge**;
  (c2) no 알림 card on Profile, 지우기 deletes them (no history), sidebar footer redesigned (BACKLOG);
  (d) rewrite CtrlAIApps header "저장한 내용은 그 사람 기기에만 남아요".
- When 0c reports clean reviews + green tests: give it the merge slot, wait for `images`
  green, deploy as above, check.
- Then **motion-modern** (BACKLOG spec 8b), same rules, one window at a time.
- Serious money/security findings stop and wait for the owner.

## Rules

One window's heavy work at a time (vitest --maxWorkers=2, Playwright --workers=1).
Windows need the owner's words for merge approval — the pre-approval is in BACKLOG.
Other windows: ctrl-ai-platform-8c (⌥⌘2, main folder — now on `main`), ctrl-ai-platform-3e (⌥⌘5), idle.

## Waiting on the owner

chore-promo-videos remote branch (keep/delete); on hold: chat history at quarter end,
image generation, dino-avatars, guide step 3. Owner-only: GCP paid upgrade by 2027-01-04;
빌더 점검 on the server.
