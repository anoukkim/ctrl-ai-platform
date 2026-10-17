# Done specs

Full specs of merged items, and the older archived specs, moved out of
[`../BACKLOG.md`](../BACKLOG.md) on 2026-10-07 so that file only holds
open work. Text unchanged; headings keep their original levels and
merge dates. The merge summaries are in [`done.md`](done.md).

## publish-summary — full spec (merged 2026-10-16)

Branch `feat-publish-summary`. Moved here from BACKLOG › Next on merge; text unchanged.

*Not pre-approved — branch, test, report, WAIT.* **Built 2026-10-16,
awaiting approval** (RUN-2026-10-16; has a migration). Decisions:
once per version, kept; the note joins every version since the
published one; wording "설명은 Claude가 미리 써 줘요 (무료) — 고쳐도
돼요". Owner, 2026-10-16
(relayed from another session, saved in their words): "지금은 매뉴얼로
작성하는데 설명 그리고 업데이트(일 때) 그냥 간단요약하게 쓰이게 해줘" /
"보일 설명은 그냥 하이쿠로 간단 요약하게". When the 게시 dialog opens,
Haiku reads the app's files (+ the project name) and pre-fills the
CtrlAIApps 설명 with a 1–2 sentence Korean summary; for 업데이트 게시 it
also pre-fills 업데이트 메모 with one line on what changed between the
published version and now (from the versions' requests and summaries).
Both are defaults the member can edit; "요약하는 중…" while it runs; on
failure the field stays empty and 게시 is never blocked. Cost: the
dialog promises "비용은 들지 않고", so the member's wallet is not
charged — 0원 to the member, recorded as club-absorbed; Haiku, a short
`max_tokens`; the real API never called in tests (mock). Tests: the
pre-fill (new / update), empty on failure, 0원 to the member + the club
row, the dialog's updated wording. **Two things the owner saw on the
way (both fixed in app-platform P4b):** the 설명 field held the last
고치기 request ("카카오톡처럼 보이게 해줘") — `builder_stages` /
`builder_edit` filled an empty description from *any* request, and a
template project started empty; now only a 만들기 request does. And the
dialog's note still said shared apps and logins cannot be made — the
note now says what the 기능 상자 does and points at /help/apps.

## quality-tuning — full spec (Q1–Q2 merged 2026-10-15, Q3 merged 2026-10-16)

Added by the owner on 2026-10-15 (during RUN-2026-10-15). Saved verbatim:

QUALITY-TUNING — from the first real beta feedback ("응답시간, 받는 토큰수 늘려주세요~ 앱이 안 만들어져요", received right after CLAUDE_PROVIDER=anthropic, before the 30 s proxy fix). Owner also finds replies a bit short, first-chat apps weak, and the Builder screen cluttered (owner screenshots of /builder/6, 2026-10-15).
Save this spec to docs/BACKLOG.md first (commit on main, push, return to your branch). Do it right AFTER the app-platform phase you are on now is deployed, BEFORE the next phase (P4 touches Builder prompts too — merge carefully). I pre-approve merge + deploy for Q1, Q2 and Q3 (same PART E rules). Never call the real API in tests; never touch .env (new settings go to .env.example with defaults, and admin-editable values go to Admin › System, audited).

Q0 — diagnose first (read-only on the server): usage events, chat_messages stop reasons and api logs since CLAUDE_PROVIDER=anthropic was set. Report in Korean: how many replies hit max_tokens / the per-reply cap / timeouts; every Builder 만들기/고치기 attempt and why each failed (proxy 30 s, BUILDER_TIMEOUT_SECONDS 180, JSON parse, max_tokens cut, file validation); average output tokens and seconds per reply on Sonnet. Use these numbers to set Q1/Q2 defaults and write them in the run log.

Q1 — fix-chat-depth (with a ChatGPT-style model + effort picker)
- Rewrite CHAT_SYSTEM_PROMPT's style rules: answer completely and with enough depth for the question — short for small talk, thorough (examples, steps, code) for how-to, comparison, study and planning questions; still beginner-friendly Korean. Remove "Prefer one clear next step over a long list"; keep tables/code/markdown rules. For html previews, allow a fuller page (remove "keep it short").
- Model + depth picker (ONE shared component, used by Chat AND the Builder 고치기/만들기 panel): a button "<모델 이름> · <깊이>" (e.g. "Sonnet 5.5 · 보통") opening one popover (bottom sheet at 390px) with:
  1. 모델: the catalogue models the admin opened, each with a one-line Korean description (빠른 답변 / 균형 / 최고 품질) and "1회 약 N원" at the current depth.
  2. 생각 깊이: a 3-step slider (낮음 · 보통 · 높음; add 최고 only for models whose API supports a max level — check current Anthropic docs), a one-line Korean hint per step ("짧은 질문에 빨라요" / "대부분의 질문에 알맞아요" / "어려운 문제, 긴 글, 코드에 좋아요"), and the live price "1회 약 N원 (최대 M원)" updating as it moves.
- Hide the slider (show "이 모델은 깊이 조절이 없어요") for models whose API has no effort parameter; never send unsupported params.
- Each depth maps server-side to effort + max_tokens + per-call cap, separately for chat and builder. Chat defaults (justify from Q0; admin-editable per level in Admin › System, audited): 낮음 = low / 4096 / 200원, 보통 = medium / 8192 / 200원, 높음 = high / 16000 / 400원. Builder keeps its own caps (today "약 275원 · 최대 443원" — keep the same per-level structure). The client sends only model id + level name; the server decides the numbers and never trusts client values.
- Chosen model + depth are remembered per conversation / per project, and as the member's default (Profile › 기본 모델). Works on the new-chat welcome screen too.
- 생각 과정 보기 stays a separate toggle in 도구 (it controls showing the summary, not the depth); if a model needs thinking on for 높음, say so in the hint.
- Other defaults (admin-editable, audited, justify from Q0): CHAT_CONTEXT_TOKENS 16000 → 64000 (caching keeps the re-read cheap — put the computed per-reply cost difference in the run log); CHAT_TIMEOUT_SECONDS 60 → 180.
- When a reply stops at max_tokens or the cap, show "이어서 쓰기" under it (continues the same answer, charged as a new reply, price shown). Receipt keeps the "상한에 도달" note and shows model · depth. Admin › Budget can break usage down by model × depth.
- Long replies must never be cut by the proxy: keepalive already exists — verify with a fake 4-minute stream test.
- Tests: level→params mapping per model (chat and builder), unsupported model hides the slider and sends no effort, price estimate matches the pre-check, server ignores tampered values, defaults remembered, 이어서 쓰기. Screenshots desktop + 390px.

Q2 — fix-builder-generation
- Generation in stages with live progress instead of one giant JSON: (1) plan: Claude lists files + short purpose (small call), shown to the member as "만들 계획" with a 시작 button; (2) files written one by one (write_file tool, streamed), the panel shows "index.html 작성 중… ✓ style.css ✓ app.js …"; (3) self-check: one short call that reviews the files for broken references/IDs/obvious JS errors and fixes them once. Each finished file is saved immediately, so a timeout keeps what was done and offers "이어서 만들기". Charge actual usage per call, as today; a failed call is still free. 고치기 uses the same streaming/progress (only changed files).
- Timeouts per call (not per whole generation): BUILDER_TIMEOUT_SECONDS 180 → 300, proxy for builder routes ≥ 600 s with keepalive; tests with a fake slow provider.
- Ambition: replace "about 300 lines" with "as complete as the idea needs, usually 300–1,200 lines across files; every button works; no placeholders". Keep the static/no-network/size-cap rules (raise caps only if Q0 shows apps hitting them). Keep it consistent with the app-platform SDK work (ctrlai.storage etc.) if that phase is already merged.
- Better start: before 만들기, a short guided form (or 2–3 questions from Claude in chat before it offers the Builder button): 누가 쓰나요 / 꼭 필요한 기능 3가지 / 원하는 분위기. Pre-filled from the chat idea; skippable.
- Clear Korean errors with a retry button; never a silent failure.
- Owner-run real evaluation (NOT in tests): `python -m app.tools.builder_eval --ideas 5 --max-krw 3000` run by me on the server, charged to my admin wallet, generating 5 fixed sample ideas and writing a Markdown report (success, seconds, won, files, self-check fixes) to Admin › System › 빌더 점검. Give me the exact command.

Q3 — fix-builder-layout (owner screenshots of /builder/6, 2026-10-15)
Header
- Hide "GitHub 미연결" and "GitHub에 저장" until Phase 4 exists (feature flag), don't show disabled dead buttons.
- Group 내려받기 + 내 Claude로 이어서 만들기 into one "내보내기 ▾" menu; 게시 취소 moves into a "⋯" menu (with its confirm); keep 업데이트 게시 as the single primary button.
- When draft == published ("게시됨 v2 · 작업 중 v2"), show "게시된 버전과 같아요" and make 업데이트 게시 inactive-looking with a tooltip, not clickable for nothing.
Tabs and preview
- REMOVE the 나란히 view. Two tabs only: 코드 / 미리보기. Default 미리보기 when the project has files; remember the last tab per project. Remove the duplicated project title at the right end of the tab row.
- 미리보기 uses the full middle width (the app must never wrap one Korean character per line). One compact toolbar row above it: version select (작업 중 vN / 게시된 vN), 새로 고침, 새 창에서 열기, 크게 보기 (icon buttons with tooltips; overflow into ⋯ when narrow). 미리보기 갱신 happens automatically after each 고치기 (keep a manual 새로 고침).
- The safety note becomes one short line with an ⓘ for the full text.
Code view
- Soft-wrap toggle (줄 바꿈, default ON for .md/.txt, OFF for code), a 복사 button per file, and line numbers that stay aligned when wrapped.
- .md files open rendered (headings, lists, code) with a "원문 보기" toggle — HANDOFF_PROMPT.md must be readable without horizontal scrolling.
File list (left)
- Collapsible: a « button hides it (remembered); when hidden a small 파일 icon button brings it back. At < 1100px it is a drawer by default.
- Group README.md, CLAUDE.md, HANDOFF_PROMPT.md, HISTORY.md, SPEC.md under a collapsed "안내 문서" folder, separate from the app files; the header count shows app files only ("파일 6개 · 안내 문서 5개"). These docs are NOT served on apps.ctrlai.my (only app files are published) — add a test.
Claude panel (right)
- Collapsible with » (remembered); collapsed → a "Claude" button in the preview toolbar reopens it. At < 1100px it becomes a bottom sheet.
- Use the shared model + 생각 깊이 picker from Q1 instead of the fixed "균형 잡힌 답변 (Sonnet 5.5)" label.
- Show the project's edit history as a conversation: each 고치기 request (member bubble) → Claude's short summary of what changed + "v3 · 파일 2개 바뀜 · 31원" (Claude bubble) with 이 버전 보기 / 되돌리기. Replaces the mostly empty panel; the old 버전 기록 list stays as a compact "모든 버전" link.
- Input placeholder rotates useful examples ("지도에 맛집 표시 추가해 줘", "다크 모드 버튼 만들어 줘"); Enter sends, Shift+Enter new line; price "약 N원 · 최대 M원" stays visible next to 고치기.
Download dialog
- Show the five 안내 문서 as a labelled group ("내 Claude용 안내 문서") above the app files, each with a one-line description on hover; remove the odd single "안내" badge on HISTORY.md.
General
- Screenshots before/after at 1440, 1280, 1024 and 390 px in the run log; light and dark; keyboard + screen reader for every new toggle.

Final report in Korean (Q0 numbers, what changed, new defaults and their cost impact per reply, what I must test with exact sentences/ideas), then continue the app-platform phases. End with the branch you are on.

---

## monitoring — full spec (merged 2026-10-14)

Branch `chore-monitoring`. M1 · 💳 if any. Added by the owner on
2026-10-14. Saved exactly as written:

> monitoring: uptime check on https://ctrlai.my and error alerts to ctrlai.platform@gmail.com, cheapest option; 💳 if any; I do the console steps.

**As built.** Cloud Monitoring, the only email path on this VM without
a new key (its scopes already include `logging.write` and
`monitoring.write`, checked 2026-10-14). Uptime: a 5-minute HTTPS check of
`/api/health` with content match `"database":{"status":"ok"` — down or
database lost both alert (1M executions/month free). Errors:
`deploy/error-watch.sh` (cron every 5 minutes) scans the api and web logs
since its last run for tracebacks, `ERROR:` lines, 5xx access-log lines
and Next.js errors, and writes one `ctrlai-app-errors` entry with the
count and the first line of up to three (200 characters each); a log
alert on that log name sends the email, at most every 30 minutes.
`--test` writes a test entry. Cost: alert conditions about $0.10 each per
month from May 2026 (two conditions ≈ $0.20). The owner's console steps
are in `docs/deployment.md` › 6-1.

## offsite-backups — full spec (merged 2026-10-14)

Branch `chore-offsite-backups`. M1 · 💳. Added by the owner on
2026-10-14. Saved exactly as written:

> offsite-backups: daily pg_dump also copied to a Cloud Storage bucket in asia-northeast3, 30-day lifecycle; monthly restore test in deployment.md. 💳; I create the bucket — list the console steps.

**As built.** `deploy/daily-jobs.sh` (cron, 04:15 KST) now takes a
daily `backup.sh`, copies it with `deploy/offsite-backup.sh` to
`gs://<bucket>/db/`, keeps the newest 14 locally, then anonymises as
before; a failure in one step does not skip the others but fails the
run. The upload uses a dedicated service account key (Storage Object
Creator + Viewer on that bucket only) because the VM's access scope is
`devstorage.read_only` (checked on the server 2026-10-14); it reads the
copy back and compares sizes; without `~/.ctrlai-offsite` it notes that
and exits 0. `deploy/restore-test.sh [bucket]` restores the newest
backup into a throwaway `postgres:16-alpine` container and compares
users / usage events / projects / schema with the live database. The
owner's console steps (bucket in asia-northeast3, uniform access,
public access prevention, 30-day delete rule, the service account and
key) and the monthly test are in `docs/deployment.md` › 8. Not covered:
the `api_storage` and `apps_data` volumes (chat attachments, member app
folders) — `pg_dump` holds the projects' files and versions, so apps can
be rewritten from the database; chat attachments are not backed up.

## example-apps — full spec (merged 2026-10-14)

Branch `feat-example-apps`. M3. Added by the owner on 2026-10-14. Saved
as written:

> - Write 3 small, polished Korean static example apps yourself as files under examples/apps/ (e.g. 동아리 출석 체크, 오늘의 할 일 + 타이머, 간단한 퀴즈 게임). Plain HTML/CSS/JS, no external network, within the size caps, mobile-friendly.
> - A server-only CLI: python -m app.db.import_example_apps <admin username> → creates Builder projects owned by that user from those files and publishes them (idempotent; second run changes nothing; audited). No API call, no wallet charge.
> - Give me the exact docker compose command to run it on the server.

**Depends on:** `builder-static-runtime` and `ctrlaiapps-publish`.

**As built.** The apps live in `backend/examples/apps/{attendance,
focus-todo,quiz}/` — under `backend/` because the api image is built
from that folder (Dockerfile `COPY examples ./examples`); each is
`index.html` + `style.css` + `app.js`, Korean, no network, no
alert/confirm/prompt (blocked in the sandboxed preview — the attendance
app removes a member with a second tap instead). Looks (F2): a lined
paper notebook with a serif title; a dark night-sky timer with a mint
progress ring; a bright arcade card with hard shadows and shuffled
questions and answers. `python -m app.db.import_example_apps <admin>`:
admin only, matched by name among the admin's live projects (existing →
left as is), first version "예시 앱 가져오기", published through the same
`app_publish.publish` as 게시, one audit row `example_apps.imported`
(actor 서버 운영자) only when something was imported. Server command in
`docs/deployment.md` › 문제가 생겼을 때 › 예시 앱 세 개를 CtrlAIApps에 올리기:
`dc exec api python -m app.db.import_example_apps <관리자 아이디>`. The
Builder prompts also gained "never use alert/confirm/prompt".

## ctrlaiapps-publish — full spec (merged 2026-10-14)

Branch `feat-ctrlaiapps-publish`. M3 — the first slice of Phase 5. Added
by the owner on 2026-10-14. Saved as written:

> - 게시 from a Builder project → a CtrlAIApps listing (title, Korean description, thumbnail/screenshot optional, author display name) opening apps.ctrlai.my/<slug>/. 게시 취소 by owner; admin can unpublish (audited).
> - REMOVE all mock/sample listings from CtrlAIApps (frontend and backend). An empty store shows a friendly Korean empty state.
> - Every listing query filters deleted_at (CLAUDE.md §10). Report button on a listing → admin sees it.
> - Report which other screens still show mock data (e.g. CtrlAITube) — list only, do not remove.

**Depends on:** `builder-static-runtime` (the served origin).

**Add-on F (owner, 2026-10-14 late evening), folded in.**

> F1. Edit → version → publish → keep updating (the Video Generator feel): each "이거 추가해 줘 / 이거 바꿔 줘" creates a new version with its request as the title; cost pre-check shown before each. 버전 저장: name/pin a version; 되돌리기 creates a new version. Published version is separate from the draft: CtrlAIApps and apps.ctrlai.my/<slug>/ serve the PUBLISHED version only; the header shows "게시됨 v3 · 작업 중 v5"; "업데이트 게시" (confirm old → new); 게시 취소 keeps all versions. Listing shows "v5 · 3일 전 업데이트" and an optional 업데이트 메모. Preview toggle 작업 중 버전 / 게시된 버전. Tests: publish v3, edit to v5 → public still v3; 업데이트 게시 → v5; rollback; deleted stops serving.
> F2. Apps must not all look the same: the generation prompt chooses a fitting visual style (local font stacks only), an optional 스타일 choice at 만들기 (깔끔한 · 귀여운 · 레트로 · 다크 · 신문 · 게임 or free text; default 아이디어에 맞게), "디자인 바꿔 줘" restyles without breaking behaviour; the example apps (item 7) each look clearly different.
> F3. Be honest about what an app can do: on the Builder start screen and before 게시 — browser-only, data stays on the visitor's device, no shared/multi-user apps yet; Claude says the same and suggests the closest thing.

**As built.** Two folders per project: `draft_slug` (working copy, the
Builder's preview, never listed) and `app_slug` (the published version
only). `builder_projects.published_version_id` / `published_at` /
`publish_note`; `builder_project_versions.label` / `pinned` (pinned and
published versions are never pruned); `app_reports`; migration
`d6a1f3c8e2b5` (an old "published" row without a version goes back to
ready). Routes: `POST …/publish`, `POST …/unpublish`
(`get_current_user` — taking your own app down works while inactive),
`PATCH …/versions/{n}`, `GET /api/apps`, `GET /api/apps/{slug}`,
`POST /api/apps/{slug}/report`, `GET/POST /api/admin/apps…`. Deleting a
project (member or admin) unpublishes it and removes both folders; a
withdrawal with "unpublish" removes the public folder and a restore
writes the same version back. Admin › Content became visible (twelve
sections). F2: `EDIT_SYSTEM` / `STARTER_SYSTEM` ask for a look that fits
(local font stacks, contrast), keep ids/classes/behaviour on a redesign;
`style` rides on the generate request; the mock varies its accent by
style word. F3: the Builder start screen, the publish dialog, the app
detail page and both system prompts state the limits.

## builder-static-runtime — full spec (merged 2026-10-14)

After the beta · M2 · branch `feat-builder-static-runtime`. Effort:
**L–XL** (2–3 weeks, in two halves). Added 2026-10-07. **Absorbs the
Builder MVP [3]** of the phase plan (`docs/archive/phases.md`).

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

- **Origin: `apps.ctrlai.my` — owner decision 2026-10-14** (CLAUDE.md
  §2; no separate domain is bought). The spec had recommended a separate
  registrable domain, because a subdomain is *same-site* with
  `ctrlai.my`: `SameSite` cookies are sent on requests from it, and a
  cookie set with `Domain=ctrlai.my` would reach it. The owner chose
  `apps.ctrlai.my` with the spec's stated conditions, each now a test:
  CTRL+AI's session cookie stays **host-only** (no `Domain` attribute);
  every state-changing route requires a **JSON body**, which a
  cross-origin page cannot send without a CORS preflight; and the API
  **refuses CORS** from `apps.ctrlai.my`. The Gabia A record
  `apps.ctrlai.my → 34.47.78.228` is the owner's; if it does not resolve
  yet at deploy time, the main site must be unaffected.
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
  is the line the phase plan (`docs/archive/phases.md`) draws before the **Secure App
  Runtime**, which stays *Later*.
- **Storage:** 2 MB per project; all apps together ≤ 2 GB of the VM disk
  (a setting), checked before writing.

**Charged:** the wallet for generation (tokens). Hosting costs nothing per app
(`apps.ctrlai.my` is a subdomain of the club's existing domain).

**Tests:** generated files land as `BuilderProjectFile` rows within the
limits; a server-side file type is refused; the static origin's responses
carry the headers above and no `Set-Cookie`; a project's path serves only
that project; the preview frame's sandbox list is exact; a deleted
project stops being served (the `deleted_at` rule, CLAUDE.md section 10).

**Risks:** runtime security (separate site, CSP, no cookies, no server
code). A member app used for phishing under the club's name (a report
button on CtrlAIApps; an admin can unpublish from Content). Cost —
generations are the most expensive calls in the product, so the
pre-check figure is shown before each one. VM disk (the caps above).

**As built (2026-10-14).** Both halves in one branch. Generation is
`POST /api/builder/projects/{id}/generate` (estimate at
`…/generate-estimate`); the real adapter sends one `strict` `write_file`
tool with `tool_choice` auto and acknowledges each round of calls with a
tool result, at most 4 rounds sharing the 16,000-token budget, every
round's usage added up. File rules in `services/builder_files.py`
(depth ≤ 3; server and build code refused by name, unpaid, club cost
recorded). Versions in `builder_project_versions` (last 30; 되돌리기 is
free and a new version; starter and Builder로 보내기 write one too; a
pre-existing project gets "처음 상태" before its first change). The runtime
writes after every change (and on 미리보기 갱신) through a hidden staging
folder swapped into place, with an in-memory `localStorage` stand-in
injected into each page — the preview frame has no `allow-same-origin`, so
storage would otherwise throw (the old srcdoc preview gets the same
stand-in). The owner's three conditions are enforced and tested:
`JsonOnlyMiddleware` (415 for a POST with a missing or simple type; the
frontend sends `{}` for bodiless POSTs), and startup refuses
`SESSION_COOKIE_DOMAIN` or the apps origin in `CORS_ALLOW_ORIGINS` on a
deployed server. Migration `b8d4f2a6c1e9`. Local stand-in: `python -m
app.dev_apps_server`. The Caddy block was checked in a local `caddy:2`
container (headers, 404 for `/`, hidden folders and dotfiles, 405 for
POST).

## chat-thinking-view — full spec (merged 2026-10-14)

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

## chat-plus-artifacts — full spec (merged 2026-10-14)

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

## chat-plus-files — full spec (merged 2026-10-14)

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

## feat-spend-feedback — full spec (merged 2026-10-14)

Branch `feat-spend-feedback`. M1. Added by the owner on 2026-10-14
(add-on B; merge and deploy pre-approved). Saved as written:

> Goal: whenever money comes off the member's 동아리 지원 wallet, they see it happen — friendly and a little playful, never annoying.
> 1. Source of truth: the charged_krw the backend returns for that action (chat `done` event, Builder generation, video, tools, files). Never a client-side estimate. No charge (failed/free call) → no animation.
> 2. Sidebar wallet (the Usage item / balance in the sidebar):
>    - the number counts down from old to new balance (~600 ms, eased)
>    - a small "-12원" chip floats up and fades next to it
>    - a brief colour pulse on the balance
> 3. Toast (bottom-right; top on mobile), Korean, short, e.g.:
>    - "12원을 사용했어요! 남은 지원금 79,988원"
>    - include what it was for when known: "채팅 · Sonnet", "빌더 · 앱 만들기", "영상 생성"
>    - several charges within 3 s are merged into one toast ("3번 · 합계 36원")
>    - auto-dismiss after 3 s, click → /usage
> 4. Game-like milestones (each shown once per quarter, stored server-side per member + quarter so it survives devices):
>    - 첫 사용: "첫 작품을 시작했어요 🎉"
>    - 25% / 50% / 75% of the wallet used: a slightly bigger card with a progress ring and the remaining amount
>    - 잔액 10,000원 이하: a calm warning (not celebratory), with a link to Usage
>    - 잔액 0: the existing Korean refusal message stays the authority; the card just points to it
> 5. Settings: Profile › 알림 → "사용 알림 표시" on/off (default on) and "움직임 줄이기" follows prefers-reduced-motion automatically (no count-up, no floating chip; toast only). Stored per user.
> 6. Never blocks input, never steals focus, screen readers get one polite aria-live line per toast. Light and dark themes.
> 7. Tests: animation fires only on a real charge; merge-within-3s; milestones fire once per quarter at the right thresholds (incl. a charge that jumps over two thresholds → only the higher one); setting off → no toast; reduced motion path.
> 8. Add a short note to docs/product.md (Usage section).

## fix-quarter-form-autofill — full spec (merged 2026-10-14)

Branch `fix-quarter-form-autofill`. M1. Added by the owner on 2026-10-14
(add-on A; merge and deploy pre-approved). Saved as written:

> Admin › Quarters › 새 분기 만들기:
> 1. 분기 코드 must match YYYY-Qn (n = 1–4); show a Korean error otherwise ("2026-Q4 꼴로 입력해 주세요"). Backend validates too.
> 2. When a valid code is typed, auto-fill:
>    - 화면에 보일 이름 → "2026 Q4"
>    - 분기 시작일 → first day of the quarter (Q4 → 2026-10-01)
>    - 분기 종료일 → last day of the quarter (Q4 → 2026-12-31)
>    - 신청 시작일 → today if today is before the quarter ends, else the quarter start
>    - 신청 마감일 → 분기 시작일 + 30 days (still editable)
>    Auto-filled values stay editable. A field the admin has edited by hand is not overwritten when the code changes again.
> 3. Date pickers enforce order with min/max:
>    - 분기 종료일 ≥ 분기 시작일
>    - 신청 마감일 ≥ 신청 시작일 (or ≥ 분기 시작일 when 신청 시작일 is empty); earlier dates are not pickable
>    - Backend refuses the same violations with Korean messages (never trust the form).
> 4. Duplicate code or a date range overlapping an existing quarter → Korean error from the backend.
> 5. Tests: code parsing for Q1–Q4 incl. month ends (2028-Q1 ends 03-31), autofill, hand-edited field not overwritten, min/max on pickers, backend refusals.

## cost-clarity — full spec (merged 2026-10-14)

Branch `feat-cost-clarity`. M1/M4. Added by the owner on 2026-10-14
(evening) as item 1 — "was club-accounting, plus caching made visible".
Goal, in the owner's words: *I (owner) and every member can see exactly
where money went, including what caching saved.* Saved as written:

> a) Accuracy audit first: every charge path through usage.charge(); per-event round-up; provider_cost vs charged_krw; cache write/read prices per model (incl. Haiku 4.5's 4,096-token minimum — a prompt below it is never billed as a cache read); web search/fetch/code-execution costs; failed/cut-off calls. Findings → docs/progress/audit-accounting.md; fix real bugs with tests.
> b) Members — receipt under each reply: 입력 / 캐시 쓰기 / 캐시 읽기 / 출력 / 도구 / 합계, plus "캐시로 아낀 금액 약 N원" (what the cached part would have cost uncached). A ⓘ explaining caching in two plain Korean sentences. Usage page: per-conversation and per-day totals with the same split, and "이번 분기 캐시로 아낀 금액".
> c) Admin › Budget:
>    - 동아리 크레딧 card per provider (Anthropic first): 구매 기록 (date, USD, KRW actually paid, memo; append-only + audit), 사용 (USD provider_cost and KRW), 남은 크레딧 (추정, "Anthropic 콘솔이 최종 기준").
>    - 지급 vs 사용: wallets granted this quarter, charged_krw total, unspent.
>    - Caching panel: per model per day — cache hit rate, tokens read/written, KRW saved.
>    - Per-member table: granted, spent by 채팅/빌더/영상/기타, cache saved.
> d) Admin › Members: adjust one member's current wallet (+/− KRW, required reason) as an audited adjustment row, never an overwrite.
> e) Quarter close: "분기 마감" → wallets frozen, unspent shown per member as 회수; per-quarter carry-over % (default 0) applied at next approval. Audited; nothing deleted.
> f) CSV exports (UTF-8 with BOM): per-member per-quarter, per-day, purchases, caching.
> g) Optional reconciliation: ANTHROPIC_ADMIN_API_KEY (in .env.example, empty, never required) + ANTHROPIC_ADMIN_PROVIDER=mock (default) → button compares our provider_cost to Anthropic's cost_report for a date range. Mock only in tests.
> h) docs/api-distribution.md: Korean section "비용 확인하는 법" (owner) and a short member-facing explanation reused in the ⓘ.

**Relation to budget-by-provider** (*After the prototype*): this item
delivers its purchase records and the per-provider balance; pools, the
reserve and purchase planning stay there, still waiting on the owner.

## admin-restructure — full spec (merged 2026-10-01)

Branch `ui-admin-restructure`, merged. Saved exactly as written by the
developer, and kept for reference: it is the clearest statement of why
the Admin screens are shaped the way they are.

**Before:** [`docs/archive/ui-requests-2026-10/admin-before.png`](ui-requests-2026-10/admin-before.png)
— the current single-page Admin screen this item replaces: ten sections
stacked on one route, from 회원 관리 down to 시스템.

> Problem: Admin is one very long page with ten unrelated sections, mixed English/Korean labels, and small inline action buttons that are easy to misclick.
>
> 1. Admin layout: a secondary Admin navigation (tabs at the top, or a sub-menu on wide screens) with these sections, each on its own route:
>    - 대시보드 /admin
>    - 회원 /admin/members, with member detail /admin/members/[id]
>    - 분기 · 신청 /admin/quarters
>    - 충전 신청 /admin/topups
>    - 영상 모델 /admin/video-models
>    - 감사 로그 /admin/audit
>    - 콘텐츠 /admin/content
>    - 시스템 /admin/system
>    - 개발 도구 /admin/dev (only when APP_ENV=development; holds the usage simulator)
>    Leave a clearly marked place for a future 예산 section (budget-by-provider).
> 2. 대시보드: cards for things needing action (pending quarter applications, pending top-up requests) that link to the right section; current quarter with its application period and status; member counts by status (활동 / 비활동 / 탈퇴); the last 10 audit entries.
> 3. 회원 list: search, filters (role, account status, membership status), sorting and pagination. Replace the small inline buttons with one "관리" menu per row, plus a link to the detail page.
> 4. 회원 detail: account info, role, membership per quarter (history), allocations and usage for the selected quarter, and that member's audit entries. All actions live here: change membership status, enrol in a quarter, change role, set allocations.
> 5. Safety: every status, role or allocation change opens a Korean confirmation dialog that states the effect (e.g. "탈퇴 처리하면 로그인할 수 없습니다"). After an action, show a short success or error message.
> 6. Consistency: all labels in Korean, keeping product and model names (Enabled → 사용 가능, Visible → 회원에게 공개, Hidden → 숨김, Video Models → 영상 모델); one badge style for statuses; one shared table component with sticky header, consistent alignment, tabular-nums amounts and a Korean empty state; existing design tokens; full width and narrow screens.
> 7. Backend: no changes to business rules. Small read-only, admin-only, tested endpoints are allowed if the dashboard needs counts.
>
> Tests: every Admin route is admin-only; dev tools are unavailable outside development; dashboard counts match the database; the confirmation dialog appears before status changes.

### Change requests after testing — 2026-10-01

Saved exactly as written by the developer, after testing the first build
of this branch. All seven are implemented and merged.

> 1. Split 분기 · 신청 into two Admin sections. Approving applications is the main job, but the quarter table sits on top and makes the page feel complicated, and the top-right "보고 있는 분기" selector already picks the quarter.
>    - 신청 승인 (/admin/applications), the main one: applications for the selected quarter only.
>    - 분기 설정 (/admin/quarters): the quarter list, opening and closing applications, and a new "새 분기 만들기" form (name, period, application period, per-member limit) with validation and a Korean confirmation. Remove the developer note about POST /api/admin/quarters.
>    - Update the Admin tabs, the sidebar sub-menu, breadcrumbs and dashboard links. The dashboard's "대기 중인 신청" card opens 신청 승인 filtered to pending.
>
> 2. 신청 승인 layout:
>    - Top: a one-line summary of the selected quarter (name · status · application deadline with D-day · per-member limit), linking to 분기 설정 for changes.
>    - Below it, a row of small stat cards for the selected quarter: 전체 신청 N명 · 승인 대기 N명 · 승인 N명 · 거절 N명 · 신청 금액 합계 N원. Clicking a card filters the list to that status.
>    - Status tabs with counts: 승인 대기 N / 승인됨 N / 거절됨 N, defaulting to 승인 대기. Keep the search box.
>    - Pending rows show 승인 and 거절 buttons directly in the row (거절 asks for a reason), each with the existing Korean confirmation. Processed rows are muted and show who processed them and when.
>    - When nothing is pending: a Korean empty state ("처리할 신청이 없습니다") with a link to the 승인됨 tab.
>    - Whole-row click still opens the member detail; the buttons do not trigger the row click.
>
> 3. 분기 설정: show per-quarter numbers in the quarter list, so quarters can be compared at a glance:
>    - New columns: 신청자 (total applications), 승인 대기, 참여 회원 (approved, active in that quarter), 실제 사용자 (members with at least one usage event in that quarter), and 사용률 (실제 사용자 ÷ 참여 회원, as %).
>    - Use tabular numbers; show "–" for quarters that have not started yet where a number does not apply.
>    - The dashboard's current-quarter card shows the same 참여 회원 and 실제 사용자 numbers.
>
> 4. 회원: a row of small stat cards above the member list:
>    - 전체 회원 N명 (all accounts except former), 활동 회원 N명 (active in the selected quarter), 비활동 N명, 미신청 N명 (no application for the selected quarter), 탈퇴 N명, 관리자 N명.
>    - Clicking a card applies the matching filter to the list; the active filter is highlighted, with a way to clear it.
>    - The numbers follow the "보고 있는 분기" selector where they depend on the quarter.
>    - The dashboard's member card uses the same numbers.
>
> 5. All counts in items 2–4 come from grouped database queries in admin-only endpoints, not from loading every record in the browser.
>
> 6. Hide the 예산 and 콘텐츠 tabs and sidebar items until their features exist, instead of showing them with 준비 중. Keep their routes and placeholders in the code so later items (budget-by-provider, Phase 5/8) can switch them on.
>
> 7. 시스템 section: add an "외부 서비스" panel below the server status, one card per provider (Claude, Higgsfield, and placeholders for GitHub and YouTube):
>    - Mode: "mock (테스트)" or "실제 연결", from the *_PROVIDER setting.
>    - API key: "설정됨" or "없음". Never display, log or return the key itself.
>    - Last successful call and last error (with a plain Korean explanation, e.g. invalid key, out of credit, service down), recorded by the provider layer.
>    - A "연결 확인" button that runs a check only when pressed, using the cheapest available request (preferably one that does not consume tokens or credits). In mock mode it reports that mock mode is active.
>    - Remaining provider-side balance only if that provider's API offers it; otherwise omit it.
>    - The dashboard shows a warning card when any real provider's last check or last call failed, linking to 시스템.
>
> 8. Keep everything else in the branch as it is.

**Decisions taken while implementing these**, worth knowing before review:

- **참여 회원** counts `QuarterMembership.status == active`, not approved
  applications. An admin can enrol someone directly, and that person is
  just as much a participant.
- **실제 사용자** counts distinct members, not usage events.
- **사용률** is `null` — shown as "–" — when nobody is participating.
  0/0 is not 0%, and "0%" would read as "everyone failed to use it".
- **The provider connection check is never automatic.** A background poll
  against a paid API spends money to produce a green dot nobody asked
  for. Only Claude has a real zero-cost check (`GET /v1/models`); the
  others report honestly that their adapter arrives in Phases 4, 6 and 7.
- **No provider balance is shown**, because none of the four APIs in use
  reports one. A made-up 0 would read as "out of credit".

---

**Note added 2026-10-01, superseded.** Point 6 above says "all labels in
Korean". **ui-naming** then moved the Admin section names to English, so
point 6 now reads as history: it describes the state this branch was
built to, not the state of the code. The rule that survives from it is
the rest of the sentence — one badge style, one table component, the
existing design tokens — and that body text stays Korean.

---

## ui-naming — full spec (merged 2026-10-01)

Branch `ui-naming`, merged. Saved exactly as written by the developer.

> 1. Sidebar and navigation labels in English, everything else stays Korean:
>    - Section headings: 만들기 → Create, 둘러보기 → Explore, 내 정보 → Account, 관리 → Manage.
>    - Items: Chat, Project Builder, Video Generator, CtrlAIApps, CtrlAITube, Usage, Profile, Report Issue (was 문제 신고), Admin.
>    - Admin sub-navigation labels in English too (Dashboard, Members, Quarters, Top-ups, Video Models, Audit Log, Content, System, Dev Tools).
> 2. "CtrlAI Apps" becomes "CtrlAIApps" (no space) everywhere: navigation, page titles, headings, Chat shortcut cards, empty states, README and CLAUDE.md. The route /ctrlaistore stays unchanged.
> 3. Rename "공동체 지원" to "동아리 지원" everywhere it appears (Usage, sidebar quarter card, Admin, explanations, docs). Personal funds stay "개인 충전".
> 4. Page body text, explanations, buttons and messages remain Korean. Product names stay as they are.
> 5. Search the whole frontend and docs for every old label and report what was changed, so nothing is left half-renamed.
>
> Tests and checks: tsc, lint and build; a quick text search proves no old labels remain.

### Decisions taken while implementing these — 2026-10-01

Worth knowing before review.

- **There is no Manage group to rename.** admin-restructure had already
  replaced the 관리 heading with the collapsible **Admin** item, which
  sits with Create and Explore. Its label was English already.
- **Admin page headings follow their menu name**, and now read it from
  `sections.ts` rather than spelling it again. The spec changes the
  sub-*navigation*; leaving the `<h1>`s alone would have put a tab
  reading "Audit Log" directly above a heading reading 감사 로그 — the
  same screen under two names, which is the half-rename item 5 guards
  against. An unknown key throws instead of rendering a blank title.
- **/issues follows the same rule**: the item is Report Issue, so the
  page title and heading are too.
- **Korean prose that points at a screen uses that screen's English
  name** ("Quarters에서 바꾸기", "Audit Log 전체 보기"), the house style
  already used for "Usage 화면". Korean prose about the *things* on a
  screen keeps the Korean noun — 충전 신청 for the requests themselves,
  기록 for audit rows. Those are nouns, not menu items.
- **`FundingSource` values are unchanged** (`community_build`,
  `community_video`). They are data, not labels; renaming them would
  mean a migration and an API change for a word nobody sees.
- **The verbatim specs in this file keep the old spellings.** They
  record what was asked for, and editing a quotation to match the result
  it produced makes the record useless.
- **English docs prose follows the Korean**: "community-funded" reads
  "club-funded", since the member-facing label is now 동아리 지원.
- **시즌 → 분기 was added on request.** Found while verifying in the
  browser: the CtrlAIApps subtitle still said 이번 시즌, the Season
  concept retired in Phase 0. One member-visible string plus seven
  comments. Raised as a separate UI request, then folded into this
  branch when the developer said to do it now.

## fix-video-workspace-hang — full spec

Branch `fix-video-workspace-hang`. Moved into the **Next** order at
position 1 on 2026-10-01, having previously sat under "Not in the Next
order" waiting for a place in the queue. Saved exactly as written by the
developer.

> `/video/[projectId]` never leaves "영상 프로젝트를 불러오는 중…". The
> three API calls it makes all return 200 and the console is clean, so
> the component is not reaching its ready state. Reproduced on `main`
> (so it predates membership-access-fix) and for an active member as
> well as an inactive one, so it has nothing to do with participation.
> The Video **library** at `/video` is fine; only the workspace is
> affected. Found while verifying membership-access-fix and left alone
> as out of scope for that branch.

## ui-tube-watch — full spec (merged 2026-10-02)

### Two things worth carrying forward

*(Moved from BACKLOG › Now on 2026-10-14, docs-cleanup; text unchanged.)*

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


Branch `ui-tube-watch`, merged. Added 2026-10-01. Saved exactly as written
by the developer.

**No before-screenshot.** One never arrived with the request, and the
developer confirmed on 2026-10-02 that the item was to be built from the
written spec alone. The problem statement below describes the old screen
well enough to work from; there is nothing to link.

> Problem: on the CtrlAITube watch page (/ctrlaitube/[id]) at 100% zoom, the video fills the full width, so the title, reactions and comments are pushed off-screen. The details are a large table, and comments look like a list instead of a comment section.
>
> 1. Layout on wide screens: two columns at about 7:3, the same for every video ratio.
>    - Left (70%): video player, title, a compact meta line under the title (creator name with status badge · 게시일 · 길이 · 생성 도구), then the prompt. Move the remaining details (YouTube 영상 ID, 회원 상태 explanation) into a collapsible "자세히" section instead of the big table.
>    - Right (30%): a panel with reactions at the top and comments below. The panel is full height and sticky; the comments scroll inside it while the video stays in view.
>    - Narrow screens: stack in this order: video, title and meta, reactions, comments, details.
> 2. Player sizing by ratio, so the title is always visible without scrolling on a normal laptop screen:
>    - The player area is the full width of the left column, with a maximum height of about 75% of the viewport height.
>    - 16:9 fills the column width. 9:16 and 1:1 are limited by that maximum height and centered, with a dark letterbox background on both sides (like YouTube Shorts on desktop).
>    - The player never scrolls sideways and keeps the video's true ratio.
> 3. Reactions: compact chips with an icon and count, a clear selected state when I have reacted, toggle on click.
> 4. Comments look like a real comment section:
>    - Each comment: round avatar with the initial, name, status badge, relative time ("2일 전", exact date on hover), text, and actions "답글" and a like count.
>    - Replies are indented under their comment with a thin thread line; long threads collapse to "답글 N개 보기".
>    - The input sits at the bottom of the panel with my avatar, grows as I type, Enter posts, Shift+Enter makes a new line, and 등록 is disabled while empty.
>    - Sort toggle: 최신순 / 인기순.
>    - Tabs at the top of the panel: "CTRL+AI 댓글 N" and "YouTube 댓글 N". The YouTube tab keeps the current explanation and the "YouTube에서 보기" button, so the two kinds of comments never mix.
> 5. Comments are still mock data; keep the "댓글 기능은 아직 준비 중입니다" note small and muted. The real comment backend comes with Phase 8.
> 6. Add mock videos in all three ratios (16:9, 9:16, 1:1) so each layout can be checked.
> 7. Use the existing design tokens and lucide icons; check at 100% zoom on full width, about 1280px, and narrow screens.
>
> Checks: tsc, lint and build; browser steps for each ratio and screen size.

### Browser checks run — 2026-10-02

`tsc`, lint, 87 frontend tests and `next build` all pass, but none of them
can see a layout: **jsdom has no layout engine, so every box measures
zero.** The tests pin the *ingredients* (the ratio reaches the player, the
player sits inside the letterbox frame); whether anything is pushed
off-screen was checked in Chrome, as follows.

Measured on the running dev server, per ratio and width:

| Content width | Columns | Stage / panel | Panel | Sideways scroll |
| ------------- | ------- | ------------- | ----- | --------------- |
| 1707px window (content capped at 68rem by `.mainInner`) | two | eyeballed | sticky | none |
| 1280px viewport (content 977px) | two | 671 / 287 | sticky | none |
| 1024px viewport (content ~733px) | one, stacked | — | static | none |
| 430px viewport (content 387px) | one, stacked | — | static | none |

The two middle rows were measured with `getBoundingClientRect` in the page;
the widest row was looked at, not measured. Note that `.mainInner` caps the
content at 68rem, so past about 1760px nothing changes.

Per ratio, in the 7:3 layout: 16:9 fills the column with no letterbox;
9:16 and 1:1 are capped at 75vh and centred with letterbox bars, keeping
their true ratio (9:16 measured 378×673 inside a 671×674 frame = 0.5617,
i.e. 9/16). The title stayed above the fold in all three.

Interactions driven by hand: reaction chip toggles 86 → 87 and back with
the selected state showing; a four-reply thread collapsed to "답글 4개
보기" and expanded; the YouTube tab replaced the list with its own note and
button; a Korean comment typed through the IME grew the box to three lines
and posted on Enter with no character lost to composition, appearing as
"방금 전" with the count going 6 → 7. Console clean on every page — no
errors, no hydration warnings.

**Two defects were found this way and fixed**, neither of which any test
would have caught:

1. **The breakpoint fired at the wrong width.** It measured the viewport,
   so on a 1280px screen — one of the three widths this spec names — the
   990px of actual content satisfied a 1024px rule while the columns did
   not fit as described. Now a container query on the content box.
2. **A hydration mismatch waiting to happen.** These pages are prerendered
   by `generateStaticParams`, so "6일 전" is baked at build time and
   disagrees with the reader's clock later. The `<time>` element carries
   `suppressHydrationWarning`; differing is correct here, and the browser
   redraws from its own clock.

---

## ui-apps-detail — full spec

### The shared comment section

*(Moved from BACKLOG › Now on 2026-10-14, docs-cleanup; text unchanged.)*

**The comment section is now shared code.** `ui-apps-detail` lifted
reactions, tabs and the whole comment column out of CtrlAITube's
`WatchPanel.tsx` into `app/components/CommentSection.tsx`. Any later
screen that needs comments uses that, and a change to it changes both
community screens — which is the point.


Branch `ui-apps-detail`. Added 2026-10-02 at the top of **Next**. Saved
exactly as written by the developer.

> Problem: the CtrlAIApps detail page (/ctrlaistore/[slug]) uses a large details table, comments that look like a list, an 앱 실행 button that looks active even when there is no launch address, a creator-status sentence viewers do not need, and buttons of equal weight.
>
> 1. Hero: thumbnail on the left; on the right the title, a one-line tagline, the creator (avatar initial, name, status badge, linking to their profile), and one compact meta line (분류 · 게시일 · 반응 수). Remove the "이번 분기에 참여 중이며…" sentence; the badge is enough.
>
> 2. Actions: 앱 실행 is the only primary button. If there is no launch address, it is disabled and reads "실행 준비 중" with the reason on hover. "GitHub에서 보기" is a small secondary button shown only when the creator made the repository public. Remove "개발자 보기" (the creator name already links to the profile).
>
> 3. Tabs below the hero: 소개 / 댓글 N / 업데이트 기록.
>    - 소개: the full description, a screenshot gallery (mock images for now), and a collapsible "자세히" with 저장소, 실행 주소 and last update date, replacing the big table.
>    - 댓글: reuse the exact comment and reaction components built in ui-tube-watch (avatars, relative time, 답글, likes, thread lines, collapsing threads, growing input, 최신순 / 인기순), so both community pages behave the same. Comments stay mock data with the small 준비 중 note.
>    - 업데이트 기록: a simple dated list (mock for now).
>
> 4. Below the tabs: "<creator>의 다른 앱" as small cards (mock).
>
> 5. Narrow screens: hero stacks (thumbnail, then text and actions), tabs stay.
>
> 6. Use the existing design tokens and lucide icons; check at 100% zoom on full width, about 1280px, and narrow screens.
>
> Checks: tsc, lint and build; a test that 앱 실행 is disabled without a launch address; browser steps.

### Browser checks run — 2026-10-02

`tsc`, lint, 101 frontend tests (14 of them new) and `next build` all
pass, but **none of them can see a layout** — jsdom has no layout engine,
so every box measures zero. The tests pin the button states, the tabs and
the comment count; widths were checked in Chrome, as follows.

Measured on the running dev server. Widths below are the CSS viewport;
`.mainInner` caps the content at 68rem, so past about 1760px nothing
changes.

| Viewport | Content | Hero | Screenshot row | Sideways scroll |
| -------- | ------- | ---- | -------------- | --------------- |
| 1897px | 1088 | two columns, 352 + 720 | fits (946) | none |
| 1280px | 978 | two columns, 352 + 610 | fits (946) | none |
| 1024px | 721 | two columns, 352 + 353 | fits (690) | none |
| 430px | 387 | stacked: artwork, then text and actions | 355 of 691, scrolls in place | none |

Interactions driven by hand on `/ctrlaistore/habit-at-a-glance`: the
반응 chip toggled 24 → 25 with the selected state showing; the four-reply
thread collapsed to "답글 4개 보기" and expanded; a Korean comment typed
through the IME posted on Enter with no character lost to composition,
appearing as "방금 전" with the tab going 댓글 7 → 댓글 8; 업데이트 기록
listed its three dated lines. On `/ctrlaistore/meeting-notes` (no launch
address, private repository) the button read 실행 준비 중, disabled, with
the reason on hover, and no GitHub button appeared. Console clean on every
page — no errors, no hydration warnings.

**CtrlAITube was re-checked after the extraction**, since its comment
section is now shared code: two columns 748 / 321, the panel still sticky
at `100vh - 2.8rem`, the comment list still the only thing that scrolls,
the composer still pinned to the bottom, the 9:16 player still letterboxed
at its true ratio.

**One defect was found this way and fixed**, which no test would have
caught: at 430px the description was clipped. A grid track will not shrink
below its widest item, and the screenshot row measures ~690px, so the
소개 panel took that width and the tab box cut it off; at 1024px the same
push showed as two pixels of page scroll. The track is now
`minmax(0, 1fr)`.

### Decisions taken while implementing these — 2026-10-02

- **The comment section moved to `app/components/CommentSection.tsx`
  before any of this screen was built.** ui-tube-watch had left a note
  saying the right moment to share it was when CtrlAIApps needed the same
  thing, and "reuse the exact components" cannot mean a copy. The watch
  page kept only its own parts: the panel frame, the CTRL+AI/YouTube tabs
  and the YouTube note. The list lives in a `useCommentThread` hook rather
  than inside the section, because the tab has to show a count that grows
  when a comment is posted.
- **The creator name is not a link yet.** The spec asks it to link to the
  creator's profile, but CTRL+AI has no member profile screen — `/profile`
  is the signed-in member's own. A link to a route that does not exist is
  worse than no link, so the name is plain text and becomes the link when
  a member profile exists. 개발자 보기 was removed as asked; it had been
  disabled since Phase 0 and was not worth keeping in the meantime.
- **GitHub에서 보기 stays disabled.** The spec settles where it appears
  (only for a public repository) and its weight (small, secondary), not
  whether it works; GitHub is Phase 4, so it carries a 준비 중 reason on
  hover, exactly like CtrlAITube's "YouTube에서 보기".
- **One mock app gained a launch address** (`example.com`, reserved for
  documentation, so it goes nowhere real). Every app had `launchUrl: null`,
  and with no app that has one, the enabled state of 앱 실행 cannot be seen
  by opening the screen or proven by a test.
- **Two mock apps were added** so two creators have more than one, which is
  what "<creator>의 다른 앱" needs; two creators still have none, so the
  empty case is visible too. 습관 한눈에 gained a four-reply thread, since
  threads only collapse past three.
- **The card count on the listing now includes replies.** It read
  `comments.length` while the detail tab and CtrlAITube count replies too,
  so the same conversation was counted two ways on two screens.

### Testing feedback round 2 — 2026-10-02

Saved as written by the developer, after looking at the screen.

> 1. "<creator>의 다른 앱": the cards are too large and draw more attention than the main content. Make them compact: a small thumbnail (about 64–80px square or a short 16:9 strip), the app name and one line of description, in a responsive grid of 3–4 per row on wide screens. Hide the section when there are no other apps.
> 2. Tab content spacing: add comfortable top padding between the tab bar and the content, and keep content aligned to the same left edge as the hero.
> 3. 소개 tab: the description as a readable paragraph block; "주요 기능" as small feature cards in a grid, each with a lucide icon, a short title and one muted line of explanation (add the explanation to the mock data); "스크린샷" as a horizontal gallery of 3–4 frames, clickable to open a larger view, with a muted caption under the gallery; "자세히" as a styled collapsible card with label/value rows (저장소 with an external-link icon, 실행 주소 or "아직 없습니다", 마지막 업데이트, 분류), tabular dates, a chevron that rotates when open.
> 4. 업데이트 기록 tab: a vertical timeline — a thin line with a dot per entry; each entry shows a version tag, the date, a short title and 1–3 bullet changes, the newest marked "최신". Fix the spacing so the date and text never touch. Add 2–3 mock entries.
> 5. Empty states: if an app has no features, screenshots or updates, show a short Korean empty state instead of a blank area.
>
> Keep the hero, 댓글 tab and design tokens as they are. Check at 100% zoom on full width, about 1280px, and narrow screens. Run tsc, lint and build.

**The screenshots attached to the feedback showed an unstyled page** — a
numbered list, a default `▶` details marker, no screenshot frames. None of
that was in the code: the served stylesheet already carried every rule,
and a fresh load of the same URL rendered correctly. It was a stale
stylesheet in the browser, so nothing was "fixed" for items that were
already working. **Reload before reporting a layout defect**, or the next
round spends itself chasing a cache.

#### What the data gained

- **`AppFeature`** (`icon`, `title`, `description`). The icon is a *name*,
  not a component, the same arrangement `CHAT_SHORTCUTS` uses — a data
  file that imports React components stops being data. `AppFeatureIcon` is
  a union and `FEATURE_ICON` is keyed by it, so adding a name to the data
  without adding the icon is a `tsc` error rather than a blank square.
- **`AppUpdate` lost `note` and gained `version`, `title` and `changes`.**
  One sentence per entry is what glued the date to the text; a timeline
  cannot lay out fields that do not exist separately.
- **Screenshot labels were renamed** (`결과 보기` → `결과 화면`). Feature
  titles and screen names had collided, so the same words appeared twice
  on one screen — and the test that looked one up by text found two.
- **단어 카드 has no features and no screenshots.** Every app was complete,
  so the empty state could be written but never seen. One app that is
  genuinely bare is how it gets looked at; the empty *updates* case stays
  unit-tested only, since every published app really does have a first
  entry.

#### Browser checks run — 2026-10-02 (round 2)

`tsc`, lint, 110 frontend tests (9 of them new) and `next build` pass.
Widths were measured in Chrome on the running dev server.

| Viewport | Hero | 주요 기능 | 다른 앱 | Page scrolls sideways |
| -------- | ---- | --------- | ------- | --------------------- |
| 1897px | two columns | 4 per row | 4 per row | none |
| 1280px | two columns, 352 + 610 | 3 per row | 4 per row | none (1269 of 1280) |
| 420px | stacked | 1 per row | 1 per row | none (409 of 420) |

At 420px only the screenshot row scrolls inside itself (925 of 351), which
is the intended behaviour and the reason the 소개 track is
`minmax(0, 1fr)`.

Driven by hand: a screenshot frame opened the larger view and Escape
closed it; 자세히 expanded with the chevron rotated and its four rows
right-aligned, the 저장소 row carrying the external-link icon; the
timeline's newest entry showed `v1.2`, the date and 최신 in separate
boxes 8px apart, with its two bullets below; `/ctrlaistore/word-cards`
showed both empty states with the section headings kept.

**The window could not be resized** — it was maximised, so Chrome ignored
the request, and page zoom was at 90%, which made the first screenshot
1897px of CSS rather than the 1280 it looked like. The widths above were
measured in a same-origin iframe sized exactly, which evaluates media
queries against its own viewport. Worth remembering: **measure
`innerWidth` before trusting a width**.

#### Decisions taken in round 2

- **The tab panel's inline padding is `0.75rem`, the same value as the tab
  labels'** (`comment-section.module.css`'s `.tab`). The two had been
  `0.95` and `0.75`, which put the first word of the body two pixels off
  the word "소개" above it — visible, but not obviously as a padding
  difference.
- **The screenshot frame is a `<button>`, not a `<div>` with `onClick`.**
  It opens something, so it has to be reachable by Tab and announced as a
  control.
- **The larger view is hand-drawn, not `<dialog>`.** `showModal()` does not
  exist in jsdom, so a `<dialog>` version could not be tested at all. It
  closes three ways — the button, the backdrop, Escape.
- **`.description` is capped at `76ch`.** `ch` is the width of "0" and a
  Korean glyph is about twice that, so 76ch is roughly thirty-eight Korean
  characters — a readable line. The first attempt at 62ch measured about
  thirty-one and wrapped too early.
- **The 다른 앱 grid is capped at four columns by media query.** `auto-fill`
  has no upper bound, and on a wide screen six small cards draw as much
  attention as two large ones did.
- **The old `.card` is untouched.** The listing screen still uses it; the
  detail page's row got its own `.otherCard`, and a test asserts the row
  does not contain a `.card` so the two cannot quietly converge again.

## project-video-management — full spec (merged 2026-10-07)

### Shared components later changes go through

*(Moved from BACKLOG › Now on 2026-10-14, docs-cleanup; text unchanged.)*

**Three components are now shared between Project Builder and Video
Generator**, which is where a later change should go rather than into
one product: `app/components/WorkspaceTitle.tsx` (the workspace title,
its ▾ menu, inline rename), `app/components/LibraryCard.tsx` (the list
card and its ⋯ menu), and `app/components/ConfirmDialog.tsx`, which moved
out of `app/admin/components/` and is now the only confirmation window in
the product — a member deleting a project and an admin closing an account
ask the same question and should not ask it in two different sets of
words.


Branch `feat-project-video-management`, merged. Saved exactly as written
by the developer, and kept for reference.

> 1. Delete Builder projects and videos
>    - Delete button on each project and video, in the library list and in the workspace, with a Korean confirmation dialog that names the item.
>    - Only the owner can delete, and only while they are an active member; admins can delete any item (written to the audit log). Backend enforces this.
>    - Soft delete (deleted_at), so it disappears for the member but an admin can restore it. Add a restore action in Admin.
>    - Deleting also removes the item from CtrlAI Apps or CtrlAITube if it was published.
>    - Never delete UsageEvent records or budget history: usage already spent stays recorded.
>
> 2. Download videos
>    - Download button on each finished video, owner only. Allowed even when the owner is inactive or not enrolled in the current quarter.
>    - Files go through a storage interface: local folder in development, cloud storage later (Phase 9), so nothing changes when we go live.
>    - Until Phase 6 connects a real provider, the mock provider produces a small placeholder video so the download flow can be tested end to end.
>    - The file name is readable: the video title plus date, safe characters only.
>
> 3. Download code as a ZIP
>    - "코드 다운로드 (ZIP)" button in each Builder project, owner only. Allowed even when the owner is inactive or not enrolled in the current quarter.
>    - The ZIP contains all project files in their folder structure plus a short README explaining how to open or run it.
>    - Never include secrets, .env files or anything outside the project.
>    - Safe ZIP building: no ../ paths, a size limit, a clear Korean error if the project is too large.
>
> Tests: owner can delete/download, other members cannot, inactive owners can download but not delete, admin delete is audited and restorable, deleted items disappear from Apps and Tube, usage history survives deletion, ZIP contains no secrets or unsafe paths, downloads are rejected for deleted items.

### Rename projects and videos

Added 2026-10-01. Saved exactly as written by the developer.

> - Rename from three places: the workspace title (click the title to edit it inline; Enter saves, Esc cancels), the ▾ menu next to the title ("이름 바꾸기"), and the library list's per-item menu.
> - Rules: trimmed, 1–60 characters, a clear Korean error for an empty name; duplicate names are allowed.
> - Owner only, and only while an active member (inactive members see the lock and reason, like other edits). Backend enforces this on the existing PATCH endpoint.
> - If the item is published, the new name shows in CtrlAIApps or CtrlAITube too.
> - The rename saves immediately, with a short "이름을 바꿨습니다" confirmation and no page reload.
> - Tests: the owner renames successfully; another member and an inactive owner get 403; empty or too-long names are rejected; published listings show the new name.

### Also needed here: store the generation settings per version

Carried over from the earlier note on this item, since it belongs to the
same branch. `VideoVersion` records which model made a version but not the
**length, aspect ratio or sound** it was made with — `VideoModel.capabilities`
only says what a model *can* do, not what was chosen.

The controls already exist (`frontend/app/video/[projectId]/VideoSettings.tsx`),
with the settings of versions made in the current session held in memory
as a stopgap. Reload and older versions lose them, because there is
nowhere to read them from.

Needs `duration_seconds`, `aspect_ratio` and `sound` on `VideoVersion`
with an Alembic migration (existing rows get null — their settings are
genuinely unknown and must not be guessed), accepted on
`POST /api/video/projects/{id}/versions` and validated against the model's
`capabilities`, returned on `VideoVersionRead`, after which the in-memory
map in `VideoWorkspace.tsx` is deleted.

## account-withdrawal — full spec (merged 2026-10-07)

Branch `feat-account-withdrawal`. Saved exactly as written by the developer.

> 1. Member self-withdrawal from Profile ("회원 탈퇴"):
>    - Requires re-entering the password plus a Korean confirmation dialog that lists exactly what will happen.
>    - Before confirming, the page reminds the member to download their videos and code ZIPs first, with links to their libraries.
>    - Choice for published work: keep it public labelled "탈퇴 회원" (default, per CLAUDE.md), or unpublish all of it.
> 2. Effects of withdrawal:
>    - account_status becomes former; the member is logged out and cannot log in.
>    - Their remaining 동아리 지원 allocation for the current quarter is released (written to the audit log). Returning it to a club reserve is budget-by-provider's work; there is no reserve yet.
>    - If they have remaining 개인 충전 balance, show a clear warning before confirming, and mark the withdrawal "환불 대기" so an admin must record the refund in Admin before the account is finalised. Never silently discard real money.
>    - UsageEvents and budget history stay, linked to an anonymised member, so quarter reports remain correct.
> 3. 30-day grace period: within 30 days an admin can restore the account (audited). After 30 days, a scheduled job anonymises personal data (username, email, display name, avatar) and the account cannot be restored. Published work keeps the "탈퇴 회원" label.
> 4. Admin: the member detail page shows withdrawn members with the withdrawal date, grace-period end, refund status, a 복구 action during the grace period, and a "환불 완료 기록" action. Admin-initiated withdrawal uses the same rules.
> 5. Tests: wrong password blocks withdrawal; a former member cannot log in; the remaining club allocation is released and the release is audited; a personal balance blocks finalisation until a refund is recorded; restore works within 30 days and not after; anonymisation removes personal fields but keeps usage totals; the unpublish choice removes items from CtrlAIApps and CtrlAITube.

**What this item leans on, which is why it sits at number 1.** Point 1's
"download your videos and code ZIPs first" links to the downloads built
in **project-video-management**, merged 2026-10-07, and
point 4's member detail page is the one built by **admin-restructure**,
already merged. Point 3's scheduled job is the first background job in
the project — there is no scheduler yet, so expect to choose one.

**Point 2 used to return the remaining club budget to "the club
reserve"**, and the reserve is created by **budget-by-provider**, now
deferred. Rewritten on 2026-10-02: withdrawal **releases** the member's
remaining allocation for the quarter and writes that to the audit log.
The money stops being spendable either way; what is missing without the
reserve is only where it goes next, and that is a line
`budget-by-provider` adds when the reserve exists.

---

## video-higgsfield-only — full spec (merged 2026-10-07)

### Decisions later items inherit

*(Moved from BACKLOG › Now on 2026-10-14, docs-cleanup; text unchanged.)*

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


Branch `feat-video-higgsfield-only`. Saved exactly as written by the developer.

> 1. All video generation, editing and extension go through Higgsfield only, behind VIDEO_PROVIDER (mock by default).
>    - Generate: text-to-video.
>    - Edit: "이 영상 수정하기" sends the selected version plus an instruction to the model's video-edit workflow and saves a new version. Length and framing come from the source, so hide those controls in edit mode.
>    - Extend: "이어서 만들기" uses the video-extend workflow with an explicit length.
>    - Show edit and extend only for models that support them (add supports_edit and supports_extend to the 영상 모델 catalogue); otherwise show a short Korean note.
>    - The mock provider supports all three.
> 2. The Claude panel in the Video workspace is collapsed by default, labeled "프롬프트 도움받기 (선택)", only rewrites prompt text, never generates video, and its usage is charged to the existing Build (Claude) budget (one short line says so).
> 3. Each version records how it was made (생성 / 수정 / 이어서), its source version, model, length and ratio, shown in the version strip.
> 4. Every Higgsfield call goes through the current budget service, charged to the existing Video budget, active members only. Each usage event records the provider, the feature tag, the model, the credits or seconds consumed, and the KRW amount.
> 5. Show the estimated cost in 원 next to generate, edit and extend, based on the model's per-second price in the catalogue.
>
> Tests: edit and extend create linked versions; unsupported models hide edit/extend; inactive members are refused; the Higgsfield budget is deducted; the Claude panel never triggers a Higgsfield call.

### Model-driven video settings

Added 2026-10-01, replacing the **Length slider** section of the same
date. Saved exactly as written by the developer.

> Model-driven video settings: everything in video creation follows the selected Higgsfield model.
>
> 1. Each model in the 영상 모델 catalogue stores its own options: allowed durations (a list of seconds), aspect ratios, resolutions, sound support, edit support, extend support, default values, and price per second for each resolution. Admin edits these in 영상 모델, with validation.
> 2. The Video workspace shows only the selected model's options as buttons (길이, 비율, 화질, 소리), with that model's defaults pre-selected. Options the model does not offer are not shown at all.
> 3. Changing the model re-applies its options: choices that still exist are kept, others switch to the new model's default, with a short Korean notice of what changed.
> 4. Edit and extend buttons appear only if the model supports them; in edit mode length and ratio come from the source video.
> 5. The summary line and the estimated cost in 원 (duration × the model's price for the chosen resolution) update live.
> 6. The backend rejects any request whose settings are not in the selected model's catalogue entry, and each version stores the exact settings used.
>
> Tests: only the model's options are offered; invalid combinations are rejected by the backend; switching models keeps or resets choices correctly; the cost estimate matches the catalogue price.

**What changed from Length slider.** That section asked for a 1–60 second
slider with `min_seconds` / `max_seconds` / `step` per model. This replaces
it with a **list of allowed durations** shown as buttons — a model offers
specific lengths, not a continuous range, so a slider would let a member
pick a value no model accepts. `resolutions` and a per-resolution price
are new, which makes the cost estimate depend on 화질 as well as length.

**Point 6's per-version settings already exist** —
`fix-video-workspace-hang` added `duration_seconds`, `aspect_ratio` and
`sound` to `VideoVersion` in migration `d7e1b4a9c052`, and
`project-video-management` merged on 2026-10-07 without needing to touch
them. This item uses the columns, adds the
catalogue fields in point 1, and will need a further column for the
chosen resolution.

**Point 1 overlaps `VideoModel.capabilities`**, the free-form JSON column
that already exists for exactly this purpose but whose shape is not
enforced. Point 1's "with validation" is what finally fixes that shape.

### Fixes before merge — 2026-10-07

Added after the developer's click-through, to be built on this branch
because it already reworks the workspace and the version strip. Saved
exactly as written by the developer.

> 1. Status badge
>    - Placement: on library cards the "Draft" badge floats between the name and ⋯. Put it right after the name (name truncates with an ellipsis), ⋯ alone on the right. Mark ui-library-cards item 1 done.
>    - Meaning: a project with a chosen final version still shows "Draft", on the card and in the workspace header (my probe project has v8 as 최종본). Decide the rule in the backend, apply it to existing projects too, use the same label in both places, and tell me which rule you chose.
>
> 2. Download any version
>    - Any version with a stored file can be downloaded at any time, final or not, through the existing route and its rules (owner only, works when not participating, refused for deleted projects).
>    - Workspace: a "다운로드" button in the preview header for the version shown, and a 다운로드 entry on each version in the version strip.
>    - Versions without a stored file (made before asset storage existed, like v1–v7 on probe): disabled, tooltip "파일이 없는 이전 버전입니다". Don't generate files after the fact.
>    - Library card ⋯ menu: "최종본 다운로드" when a final with a file exists, otherwise disabled with the tooltip "최종본을 먼저 고르세요". Mark ui-library-cards item 7 done.
>    - File name: <project>_v<n>.<ext>, e.g. probe_v8.gif.
>
> Tests for both, then the full suites, lint, tsc, next build, push, and tell me what to re-check. Don't merge.

**Built.** The status rule chosen: **a chosen final version makes a Draft
or Generating project Ready; clearing the final turns Ready back into
Draft; Published and Archived are never changed by it.** It runs on every
`PATCH` of a project (after any `status` sent in the same request), and
migration `4b8e2d6f1a90` applies it to existing rows. Card and workspace
header both read `VIDEO_STATUS_LABEL[project.status]`, so they cannot
disagree. Downloads are named `<project>_v<n>.<ext>`; the plain
`filename=` fallback for old clients is `video_v<n>.<ext>`.

## Archived specs

Merged, but kept because each is the standing description of something a
later screen can be checked against.

### UI batch 1 — full spec

**Merged 2026-10-01.** The standing description of the palette and the
brand. Saved exactly as written by the developer.

> Follow the working method and Git Workflow in CLAUDE.md. Create branch ui-brand-refresh from up-to-date main. UI and docs only: no backend logic or data-model changes. Attached: a screenshot of the current sidebar.
>
> 1. Club name: the community is called CTRL+AI.
>    - Show "CTRL+AI" as the brand name in the sidebar header.
>    - Add a short welcome area at the top of the Chat landing page (e.g. "CTRL+AI에 오신 것을 환영합니다" plus one short line about what members can do).
>    - Replace the "Phase 1 — 개발 중" subtitle with a short Korean tagline.
>    - Keep product and feature names (Chat, Project Builder, Video Generator, CtrlAI Apps, CtrlAITube, Usage, Profile, Admin) and all routes unchanged.
>    - Update the page <title>, CLAUDE.md and README so the club name is consistent. Do not rename the repository.
>
> 2. Logo: replace the "AI" square logo with a plus (+) mark in the same rounded square, matching the CTRL+AI name. Make it a small SVG component and use it as the favicon too.
>
> 3. Navigation icons: replace the text-symbol icons (◇ ◆ ▶ ▣ ◉ ⚙ ◑ ○) with one consistent icon set using lucide-react.
>    - Same size and stroke width everywhere, vertically aligned with the labels.
>    - A clear but subtle active state.
>    - Suggested: Chat = message bubble, Project Builder = code or hammer, Video Generator = clapperboard, CtrlAI Apps = grid, CtrlAITube = play circle, Admin = shield or settings, Usage = gauge or wallet, Profile = user, 문제 신고 = bug or flag.
>
> 4. Colors: build a dark-theme palette inspired by the Anatomy design system values below, adapted for dark backgrounds. Update tokens in globals.css only; no hard-coded colours in components.
>    - Never use #003c71 (brand primary, reserved for the company logo) or the brand gradient. Never use any company logo.
>    - Background: near-black navy derived from #001433, with slightly lighter navy surface steps for sidebar and cards (add these in-between shades as needed).
>    - Text: #f2f2f2 main, #cccccc secondary, #999999 muted. #666666 is for borders only, never text.
>    - Links and active navigation: #9ac2fe. Primary buttons: #0153cc fill with white text. Never use #0153cc as text on dark backgrounds.
>    - Build accent: #bb33ff for bars and fills, #dd99ff for any accent text. Video accent: #00eeff.
>    - Error: #e64d54 for icons and borders, #f2a6aa for error text.
>    - Success and warning are not in the source palette: keep our own green and amber, tuned to fit.
>    - Accent gradient #3485fe → #bb33ff only on the + logo mark, nowhere else.
>    - Check every text/background pair meets WCAG AA (4.5:1 normal text, 3:1 large text and UI elements) and list the ratios in your report.
>
> 5. New page /issues, titled "문제 신고", in the sidebar under 내 정보:
>    - A short Korean explanation of how to report a bug or suggest an idea.
>    - A button that opens https://github.com/anoukkim/ctrl-ai-platform/issues/new/choose in a new tab.
>    - A note that a GitHub account is needed and that issues are public, so never include passwords, personal information or private data.
>    - Add .github/ISSUE_TEMPLATE/ with two Korean templates, 버그 신고 (what happened, what you expected, steps to reproduce, screenshot, browser) and 기능 제안 (idea, why it helps), plus a config.yml.
>    - Leave a clearly marked place on the page for a future in-app feedback form for members without GitHub.
>
> Rules:
> - Keep word-break: keep-all. Never apply monospace or letter-spacing to Korean text.
> - Check every page, not just the sidebar: Chat, Builder, Video, CtrlAI Apps, CtrlAITube, Usage cards and bars, badges, buttons, Profile, Admin tables, and the new /issues page.
> - Check full width and the narrow-screen menu.
>
> Run tsc, lint and build. Report what changed per screen, the contrast ratios, the changed files, and exact browser steps for me to check it. Do not merge.

### membership-access-fix — full spec

**Merged 2026-10-01.** Branch `fix-membership-access`. The standing
description of the access rule. Saved exactly as written by the developer.

> Bug: members who are not active in the current quarter can still use Chat and the Builder/Video work chats, because only real paid endpoints were gated.
>
> Rule: a member who is not ACTIVE in the current quarter (inactive, or no membership record for the current quarter) cannot use any AI feature, mock or real. Former members cannot log in.
>
> Inactive / not enrolled members:
> - ALLOWED: log in; browse CtrlAI Apps and CtrlAITube; view their own projects, videos and conversations read-only; download their own work; Usage, Profile, 문제 신고.
> - BLOCKED: Chat send; Builder chat and generation; Video 다듬기, generate and 다시 생성; creating, editing and publishing.
> - Admins follow the same AI rule unless they are active members; admin pages stay available to admins.
>
> Backend: apply require_active_member to every AI, create, edit and publish endpoint, including mock-backed ones. Missing membership = not active. Blocked requests return 403 with a Korean message. Add a table of every endpoint and its access rule to the report and docs/architecture.md.
>
> Frontend: a calm banner on Chat, Project Builder and Video Generator: "이번 분기에 참여하지 않아 AI 기능을 사용할 수 없습니다. 내 작업물 보기와 다운로드는 가능합니다." with a link to Profile; disabled composers and action buttons with a lock icon and the reason on hover. The backend must still refuse.
>
> Tests: inactive and not-enrolled members get 403 on every AI/create/edit/publish endpoint; active members succeed; inactive members can browse and read their own work; former members cannot log in; admin pages work for admins.

## Phase 2 — Chat — full spec (merged 2026-10-07)

### Decisions later items inherit

*(Moved from BACKLOG › Now on 2026-10-14, docs-cleanup; text unchanged.)*

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


Branch `phase-2-chat`. Added 2026-10-01, replacing the one-line entry that
pointed at `CLAUDE.md` section 20. Saved exactly as written by the
developer.

**At position 4 since the 2026-10-02 reorder.** It has moved twice, and
the note below replaces what the earlier moves implied.

**Charge chat to the existing Build (Claude) budget through the current
budget service. Still record every field `budget-by-provider` and
`usage-analytics` will need (provider, feature tag "chat", exact model,
input and output tokens, USD cost from an admin-editable per-model token
price, the USD→KRW rate used, and KRW), so no backfill is needed
later.**

What follows from that:

- **Point 6 introduces the `UsageEvent` fields.** `budget-by-provider` is
  deferred, so there is no earlier migration to write into; this item
  adds the columns it records and the deferred item extends that shape.
- **The Claude/Higgsfield budget rename has not happened yet.** Chat
  charges the **Build** budget — the pot shown as 동아리 지원 — through
  the budget service that exists today. The rename is
  `budget-by-provider` point 1, and it is this item's recorded fields
  that make it a rename rather than a reconstruction.
- **Point 1's `ANTHROPIC_MODEL`** is already in `.env.example` and
  `Settings`; this item is what finally reads it.

> Goal: real Claude chat for members, ready for an invite-only beta.
>
> 1. Provider: a Claude adapter behind CLAUDE_PROVIDER (mock by default, "anthropic" for real). The model comes from ANTHROPIC_MODEL in the environment, never hard-coded. Max output tokens per reply and max conversation context are settings.
> 2. Conversations: Conversation and Message tables with an Alembic migration. A conversation list in Chat (새 대화, rename, delete), the current conversation's history sent to Claude within the context limit (oldest messages trimmed first).
> 3. Streaming replies in the existing chat UI, with a stop button. The Korean IME check before Enter stays.
> 4. System prompt: Claude answers in Korean, explains simply for beginners, and suggests CTRL+AI features when relevant. When a message is about building an app or making a video, the reply shows simple action buttons ("Project Builder에서 시작", "Video Generator 열기") that open those screens with the idea pre-filled. No complex agent routing.
> 5. Access and budget: require_active_member on every chat endpoint. Before each call, check the member's remaining Build (Claude) budget; if it is insufficient, refuse with a Korean message and no provider call.
> 6. Usage recording from the start, so later items need no backfill: each reply writes a UsageEvent with provider, feature tag "chat", exact model, input tokens, output tokens, cost in USD from an admin-editable per-model token price setting, the USD→KRW rate used, and the KRW amount, deducted through the existing budget service in the same transaction.
> 7. Errors: clear Korean messages for invalid key, out of provider credit, rate limits, timeouts and network failures. A failed call is never charged to the member.
> 8. Safety: the API key lives only in the backend environment and never reaches the browser or logs. A per-member rate limit (requests per minute) protects the budget.
> 9. Admin › 시스템 shows Claude as "실제 연결" when configured, and the 연결 확인 check works with the real key.
> 10. Real-provider check at the end: with my key in .env and CLAUDE_PROVIDER=anthropic, send one short real message, confirm the reply streams, the usage event and deduction are correct, and the error paths show Korean messages.
>
> Tests (all with the mock provider): conversations CRUD and ownership; inactive members get 403; insufficient budget is refused without a provider call; usage events store model, tokens, USD, rate and KRW; failed calls are not charged; the key never appears in any response.

**Merged 2026-10-07.** The decisions taken are in `BACKLOG.md` › **Now**.
**Point 10 was not run before the merge** and is carried there as an open
check before `prep-beta-launch`.

**Point 10 is the first time this project spends real money.** It needs a
key in `.env` and `CLAUDE_PROVIDER=anthropic`, so it is a step to take
with the developer present — CLAUDE.md section 21 rule 5. Points 1–9 and
every test above run on the mock provider with no key.

## ui-polish — final UI pass (merged 2026-10-07)

### Decisions later items inherit

*(Moved from BACKLOG › Now on 2026-10-14, docs-cleanup; text unchanged.)*

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


Raised 2026-10-07 and built on `ui-polish`, which also holds the earlier
design-handoff pass (light/dark themes, variant B shape, the restyle of
every route). Merged 2026-10-07. Saved exactly as written by the developer:

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

## chat-model-choice — full spec (merged 2026-10-07)

### Decisions later items inherit

*(Moved from BACKLOG › Now on 2026-10-14, docs-cleanup; text unchanged.)*

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


Branch `feat-chat-model-choice`. Added 2026-10-07. Saved exactly as
written by the developer.

**What it replaces.** Until this item, members could not choose a model in
Chat: `ANTHROPIC_MODEL` in `.env` decided it for every reply (and the mock
was priced as that model). The `claude_model_prices` table held prices
only, edited in Admin › System.

> 1. A model catalogue generalised to "provider + model" (provider = anthropic for now), so another provider later (e.g. Gemini) is a new adapter plus catalogue rows. Seed Haiku 4.5, Sonnet 5.5 and Opus 5.5 with prices, a Korean label, a one-line description, and visibility: enabled for members / admin only / disabled. Defaults: Haiku and Sonnet for members, Opus admin only, Sonnet the default. Admin edits it in a Claude Models section styled like Video Models; changes are audited. ANTHROPIC_MODEL is only the fallback when the catalogue is empty.
> 2. Chat: a model picker next to the composer, per conversation, with label, description and estimated cost per reply in 원. New conversations use the default; changing the model affects later messages only.
> 3. Backend: refuse models not enabled for this member (Korean 400); budget pre-check and charge use the chosen model's price; record the model on each message and usage event. The video prompt helper keeps the default model.
>
> Tests: disabled and admin-only refused for members; price matches the chosen model; choice persists per conversation; default for new conversations.

## Superseded by single-wallet (2026-10-08)

`single-wallet` replaced the two budgets per member (Build/Video, later to
be renamed Claude/Higgsfield) with one 동아리 지원 wallet per member per
quarter. The two specs below were written for the two-bucket model; they
are kept here exactly as they stood, and their rewritten versions are in
[`../BACKLOG.md`](../BACKLOG.md) under *After the prototype*.

### budget-by-provider — original spec (two budgets per member)

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

#### Application flow

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

#### Application and purchase model (decided)

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

### usage-analytics — original spec

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

## prep-beta-launch — full spec (merged 2026-10-13)

Branch `feat-prep-beta-launch`, merged 2026-10-13. Rewritten on 2026-10-01: the item used to be only the
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

### Cloud-neutral code part — superseded 2026-10-13

On 2026-10-07 the developer asked for the code part to be built
cloud-neutral while the cloud, region and VM size were decided. They were
decided on 2026-10-13 (below), so that note no longer applies: the code
part and the guide are written for the chosen VM.

### Hosting decisions — 2026-10-13

Decided by the owner; updates the 2026-10-07 decisions, which put an
e2-micro in a free-tier US region. **Where these conflict with points 1,
3 and 4 above, or with Phase 9 in `CLAUDE.md`, these win for the beta.**
Points 2 and 5 and the Launch data rules are unchanged.

**The VM (already created by the owner):**

| | |
| - | - |
| Name | `ctrlai-server` |
| Region / zone | `asia-northeast3` (Seoul) / `asia-northeast3-c` |
| Machine | **e2-medium** — 2 vCPU, 4 GB RAM. Paid, about US$32 a month; not a free-tier machine |
| OS | Debian 13 (trixie), x86_64 |
| Disk | standard persistent disk, being resized from 10 GB to 30 GB |
| Static external IP | `34.47.78.228` |
| Firewall | HTTP (80) and HTTPS (443) allowed; nothing else besides the default SSH rule |
| Done on the VM | `apt upgrade`; git; Docker Engine and the Compose plugin from Docker's apt repository; the owner's user `ctrlai_platform` in the `docker` group; a 2 GB swap file in `/etc/fstab` |

- **Billing: the Google Cloud free trial — ₩407,626 of credit, started
  2026-10-13, ending around 2027-01-11.** The billing account must be
  upgraded to paid before then or the VM stops. `docs/deployment.md` gives
  the date to act (2027-01-04, a week early) and what happens otherwise.
  Set a budget alert on day one.
- **Domain: `ctrlai.my`, already bought.** DNS at the registrar: `@` A →
  `34.47.78.228`; `www` CNAME → `ctrlai.my` (Caddy redirects www to the
  apex). Records and checks: `docs/dns-for-domain-owner.md`.
- **No `api` subdomain.** Point 3 asked for one, and it is not useful: the
  browser only ever talks to the main domain through the `/api` rewrite,
  so an `api` record would add a public address, a certificate and a
  cookie question for nothing. FastAPI is not exposed at all, and its
  `/docs` is off outside development anyway.
- **Data location notice on sign-up:** "회원님의 정보는 Google Cloud 서울
  리전(asia-northeast3)에 저장됩니다." — editable as `DATA_LOCATION_NOTICE`
  in `.env`.
- **Sizes in `.env.example` are for the e2-medium and about 40 members:**
  `WEB_CONCURRENCY=2`, `DB_POOL_SIZE=5` + `DB_MAX_OVERFLOW=5` (20
  connections at most), PostgreSQL `shared_buffers=256MB`,
  `max_connections=50`, Caddy `MAX_UPLOAD_MB=20`.

**Unchanged from 2026-10-07:**

- **One Docker Compose with four services:** `caddy` (80/443, automatic
  Let's Encrypt HTTPS), `web` (Next.js standalone output), `api`
  (FastAPI) and `db` (`postgres:16-alpine`, **no published port**, a named
  volume). File: `docker-compose.prod.yml`.
- **No Cloud SQL, Cloud Run or Secret Manager for the beta.**
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
- **Images are built off the VM.** GitHub Actions builds both images and
  pushes them to ghcr.io (`.github/workflows/images.yml`); the VM only
  pulls. Next.js rewrites are compiled at build time, so `BACKEND_ORIGIN`
  (`http://api:8000`) is a **build argument**, not a runtime variable.
- **Point 1 changes in two details only:** the domain is `ctrlai.my`, and
  `BACKEND_ORIGIN` is a build argument. CORS origins, secure cookies,
  cookie domain, `APP_ENV` and `DATABASE_URL` are runtime environment
  variables as written.
- **The first background job runs from host cron:** once a day,
  `python -m app.jobs.anonymise_withdrawn` in the `api` container
  (`deploy/daily-jobs.sh`).
- **Backups:** `pg_dump` from the `db` container before every update
  (`deploy/backup.sh`), kept off the VM.
- **Growing later is configuration, not a rewrite:** move PostgreSQL to
  Cloud SQL by dump and restore plus a new `DATABASE_URL`, or run the same
  images on Cloud Run. Resizing the VM (e2-standard-2 and up) is a stop,
  a machine-type change and a start.

---

## single-wallet — full spec (merged 2026-10-13)

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

## prompt-caching — full spec (merged 2026-10-13)

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

## cost-calibration — full spec (merged 2026-10-13)

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

## chat-builder-starter — full spec (merged 2026-10-13)

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

---

## invite-only-signup — full spec (merged 2026-10-13)

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

## test-database-isolation — full spec (merged 2026-10-13)

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

## google-login — full spec (merged 2026-10-13)

Branch `feat-google-login`. M1. Added by the owner on 2026-10-13, with
the decision **Google becomes the main way to sign in** (recorded in
`CLAUDE.md` section 11). Saved exactly as written:

> Add a backlog item google-login, spec only. Owner decision 2026-10-13: Google becomes the main way to sign in; update CLAUDE.md section 11 to say so.
> - "Google로 계속하기" on sign-in and sign-up. Scopes openid, email, profile only; no YouTube scope at sign-in.
> - First Google sign-in: a setup screen to choose username and display name. In APP_ENV=beta a new account still needs a valid invite code.
> - The account whose verified Google email equals ADMIN_EMAIL (ctrlai.platform@gmail.com) becomes admin; only email_verified=true may match.
> - Link by Google's stable id (sub), not the email. Never sign into an existing account just because the email matches; a member links Google from Profile while signed in.
> - Username/password stays only as the admin's emergency login; members do not see it.
> - YouTube stays Phase 7: Profile › "YouTube 연결" asks for the upload scope on the same Google account by incremental authorization. Refresh tokens encrypted at rest, never sent to the browser. Until Google verifies the app, YouTube is limited to test users and uploads stay private.
> - The backend does the whole OAuth exchange with state and PKCE; the client secret lives only in the server .env. A mock provider for development and tests.
> - docs/deployment.md lists the Google Cloud console steps I do myself (OAuth consent screen, client ID, redirect URIs, test users) and the .env lines.

**Depends on:** `invite-only-signup` (the invite code a new Google
account must present) and `test-database-isolation` (both come first in
Next). Provider rule (`CLAUDE.md` section 20): behind
`GOOGLE_LOGIN_PROVIDER=mock|google`, mock by default.

Notes for the build, not changes to the request:

- **Where it sits in the data model:** a `ConnectedAccount` row
  (`provider="google"`, `provider_account_id=sub`, unique), the table
  `CLAUDE.md` section 14 already describes. The sign-in identity and the
  later YouTube connection are the same row with more scopes, not two
  rows.
- **The callback lands on the backend** (`/api/auth/google/callback`
  through the same-origin `/api/*` rewrite), which sets the same HttpOnly
  session cookie as password sign-in; no token ever reaches the browser.
  `state` and the PKCE verifier live in a short-lived, HttpOnly cookie or
  a server row, never in `localStorage`.
- **The setup screen** keeps the existing username rules and the invite
  code check from `invite-only-signup`; until it is completed there is
  no account, only a pending, short-lived sign-up row keyed by `sub`.
- **ADMIN_EMAIL matching** happens only when the account is first
  created (and is audited); an existing member's later email change at
  Google never promotes or demotes anyone.
- **Hiding password sign-in:** the sign-in screen shows only Google; the
  password form moves to an unlisted route for the admin's emergency use,
  still rate-limited, and member accounts created by Google have no
  usable password (`UNUSABLE_PASSWORD_HASH`). Existing password members
  link Google from Profile before the password form disappears for them.
  **Superseded 2026-10-14 by `member-password-login`:** the password form
  is back on `/login` for every member, under the Google button;
  `/login/password` redirects there; a Google member can set a password
  and either method can be removed from Profile › 로그인 방법 while the
  other remains. Google-created accounts still start with no usable
  password.
- **Google verification:** openid/email/profile are non-sensitive scopes,
  so sign-in works for everyone without Google's app review once the
  consent screen is in production; the YouTube upload scope is the one
  that needs verification (Phase 7).
- **Tests (mock provider):** state and PKCE checked and single-use; a new
  `sub` goes to the setup screen and needs an invite code in beta; an
  existing account is never entered by email alone; linking from Profile
  attaches the `sub` to the signed-in account and refuses a `sub` already
  linked elsewhere; only a verified ADMIN_EMAIL becomes admin; no route
  returns a token; the access table and `EXPECTED_GUARDS` gain the new
  routes.

---

## ui-friendly-motion — full spec (merged 2026-10-13)

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

---

### chat-plus-rendering — full spec (merged 2026-10-14)

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

---

### member-password-login — full spec (merged 2026-10-14)

Branch `feat-member-password-login`. M1. Added by the owner on
2026-10-14. **Changes CLAUDE.md section 11:** members can sign in with
Google OR with username and password — both, for everyone. Password
login is no longer admin-only. The owner's words, verbatim:

> - Login page: "Google로 계속하기" and, below it, the username/password
>   form, both visible. Keep /login/password working (redirect to /login
>   is fine).
> - Sign-up: choose Google, or username + email + password. An invite
>   code is required either way, as today.
> - Profile › 로그인 방법: a Google member can set a password (then can
>   also sign in by username); a password member can link Google.
>   Unlinking or removing one is allowed only while another sign-in method
>   remains, so nobody locks themselves out.
> - Keep every existing rule: Argon2id, the database-backed attempt
>   limits, link Google by sub never by email, ADMIN_EMAIL promotion only
>   at creation with email_verified, withdrawal works for both kinds of
>   account.
> - Update CLAUDE.md section 11, the google-login notes in done-specs,
>   docs/product.md and the dev seed.

**For this item only — wait for the owner's check before merging.**
After steps 1–6 of the run's loop pass: start a preview of the branch
(separate ports, the practice database, mock providers, a fresh dev
seed with an admin with a password only, a member with Google only, a
member with a password only, a member with both, and an unused invite
code); check every flow with Playwright in both themes and at 390 px;
give the owner a Korean click-through checklist (URL, accounts and how
each signs in, the invite code, each flow, what must be refused — wrong
password, sign-up without a code, removing the last sign-in method, a
Google account whose email matches someone else's account — and what is
mock); push the branch, mark it "waiting for owner check" in the run
log, and merge only on the owner's OK, with `--no-ff`, resolving
conflicts with what merged meanwhile, then re-run step 4 on main and
stop the preview. A reported problem is fixed on the same branch, steps
4–6 re-run, the preview refreshed and only the changed checks given.

## deepseek-research — full spec (merged 2026-10-14)

Branch `docs-deepseek`. Research only — nothing is built. Added
2026-10-08 at position 3; can run any time. Its findings go to
`docs/research/` and into **more-chat-providers** (*After the beta*).
Saved exactly as written by the developer.

> ITEM 3 — research only (branch docs-deepseek), can run any time
> Can we add DeepSeek to the chat model catalogue? Using current docs, report: DeepSeek's own API (pricing, OpenAI-compatible API, streaming, file/image input, where data is stored and the privacy terms, billing and receipts for Concur), and alternatives that host DeepSeek models elsewhere (via OpenRouter with a provider/region choice, or US-hosted providers), with price differences. Recommend whether and how, noting that our company may restrict sending data to servers in China. Write it into docs/research/ and add a "more-chat-providers" note in BACKLOG. Don't build.

Findings (2026-10-08): [`../research/deepseek-research.md`](../research/deepseek-research.md);
summary under **more-chat-providers** in [`../BACKLOG.md`](../BACKLOG.md).
Merged with the owner's approval on 2026-10-14, into
`feat-admin-and-nav-cleanup` (`30de894`), which also seeded the closed
catalogue row (연결 준비 중) from the research's prices.

### admin-and-nav-cleanup — full spec (merged 2026-10-14)

Branch `feat-admin-and-nav-cleanup`. M1. Added by the owner on
2026-10-14, to be built at once with the run's loop and pre-approval.
The owner's words, verbatim:

> 1. Remove Report Issue from the menu and remove the /issues page
>    (redirect /issues to Chat). The 의견 보내기 button in the sidebar
>    footer stays as the one way to send feedback. Update
>    anonymous-feedback-board's spec to match: no menu item and no
>    /issues; its member board is a page reached from a "다른 의견 보기"
>    link inside the 의견 보내기 dialog. Update CLAUDE.md sections 1 and
>    15, docs/product.md and sections.ts.
> 2. Remove Dev Tools from Admin (menu, page, tab). Keep the backend
>    simulate-usage route only if tests still need it; otherwise remove it
>    too. Keep python -m app.db.reset_dev.
> 3. Fix the Claude Models table: in the 공개 범위 column the badge, the
>    select and the "기본으로" button overlap. One control per cell,
>    nothing overlapping, at 1280px and at 390px (table scrolls inside its
>    own box), both themes.
> 4. Rename the Admin section "Claude Models" to "AI Models" (route can
>    stay or redirect). Group the catalogue by provider with a heading per
>    provider: Anthropic (Claude) first. "+ 모델 추가" asks for the
>    provider first. A provider with no adapter yet is listed as "연결 준비
>    중", and its models cannot be made visible to members or default
>    (enforced in the backend, with a test).
> 5. DeepSeek: merge the docs-deepseek research branch (docs only, owner
>    approves). Add DeepSeek as a provider entry marked "연결 준비 중" with
>    the model the research recommends, prices from the research,
>    visibility disabled. Do not write a real DeepSeek adapter and do not
>    call any DeepSeek API; the adapter stays in more-chat-providers.
> 6. Update the section list in CLAUDE.md section 15 and every test that
>    counts Admin sections.

## fix-beta-blockers — full spec (merged 2026-10-14)

PART A1 of the owner's overnight batch of 2026-10-14 (merge pre-approved
when clean). The owner's words, verbatim:

> A1. fix-beta-blockers
> 1. Profile shows mock apps for the hard-coded user "yurikim" to every member. Show only the signed-in member's own data, with an empty state; remove that mock path.
> 2. Remove docs/index.html and docs/.nojekyll (the old ui-polish prototype, 3 MB). Write in the run log how I turn off GitHub Pages; do not change settings yourself.
> 3. Three backend test files write GIFs into the real backend/var/storage. Every test uses a temporary storage dir; add a guard test that fails if any test writes there.
> 4. httpx2 is imported at runtime but only in requirements-dev.txt. Move it to requirements.txt; add a test that imports the anthropic adapter with runtime requirements only.
> 5. Dev-only scripts (init_db seed, reset_dev) must refuse to run in the production image; confirm and test.

Checklist and decisions: [`progress-2026-10-13/fix-beta-blockers.md`](progress-2026-10-13/fix-beta-blockers.md).

## personal-topup-off — full spec (merged 2026-10-14)

PART A2 of the owner's overnight batch of 2026-10-14 (merge pre-approved
when clean). The owner's words, verbatim:

> A2. personal-topup-off — Owner decision 2026-10-14: personal top-ups (개인 충전) are not offered. Update CLAUDE.md sections 1, 9, 12 and 14 and docs/product.md.
> - Remove every member-facing trace: the 개인 잔액 block on Usage and the sidebar, overage opt-in, any top-up button or copy, and 개인 충전 wording in the wallet card. Members see only the 동아리 지원 wallet.
> - Hide Admin › Top-ups from the menu and sections.ts. The backend top-up and personal-spend routes refuse with a Korean message in every environment, behind one setting PERSONAL_TOPUP_ENABLED=false (default false, in .env.example). Keep tables and code; no migration that drops data.
> - charge() never uses personal money while the setting is off; test it.
> - Withdrawal: drop the 환불 대기 path from the member screen while top-ups are off; keep the backend logic for any existing balance.
> - Add a backlog item personal-topup-ui (after the beta).

Checklist and decisions (including why the 환불 대기 copy stays for money
that already existed):
[`progress-2026-10-13/personal-topup-off.md`](progress-2026-10-13/personal-topup-off.md).

## token-guard — full spec (merged 2026-10-14)

Branch `feat-token-guard`. Added by the owner on 2026-10-13. Saved
exactly as written:

> token-guard: a per-reply cost cap (admin setting, default about 100원) that stops the reply and charges only what was used, with a Korean notice; a warning when a conversation's history is long, suggesting a new conversation, with the estimated saving; an optional daily cap per member. Stopping a reply already exists — keep its rule (stopped replies are saved and charged for tokens used).

**Depends on:** `single-wallet`, `prompt-caching`, `cost-calibration`
(all merged).

1. **Per-reply cap, an admin setting** (Admin › System, audited like the
   exchange rate; default **100원**). Enforced **before** the call rather
   than by cutting the stream: from the calibrated input estimate and the
   model's prices, the backend works out how many output tokens the rest
   of the cap buys and sends that as `max_tokens` (never above
   `CHAT_MAX_OUTPUT_TOKENS`). The API then stops at the cap itself and
   reports real usage, so the charge is exact, with no estimate of an
   aborted stream. Thinking tokens count toward `max_tokens` and are
   billed as output, so the cap covers them too.
2. **The notice.** A reply that ends with `stop_reason: "max_tokens"`
   because of the cap is saved and charged for what was used (the
   existing stop rule) and shows: "답장이 1회 비용 한도(100원)에 닿아
   여기서 멈췄어요. 이어서 받으려면 '계속해 줘'라고 보내 주세요." A
   member's own 중지 keeps today's behaviour.
3. **If the input alone is over the cap** (a very long history on an
   expensive model): refuse before calling, charge nothing, and show the
   suggestion from point 4.
4. **Long-history warning.** When the calibrated input estimate passes a
   threshold (admin setting, default 8,000 tokens, half of
   `CHAT_CONTEXT_TOKENS`), a note above the composer: "대화가 길어져
   답장마다 약 N원이 더 들어요. 새 대화로 시작하면 약 M원 아낄 수
   있어요." N and M come from the same price functions as the pre-check,
   at the cache-read price where the history is cached
   (`prompt-caching`), so the saving is not overstated. A 새 대화 button
   sits beside it.
5. **Optional daily cap per member** (admin setting, 0 = off). Counted
   from today's `UsageEvent` rows (KST day) and checked with the wallet
   pre-check; refused with a Korean message before anything is spent.
   Applies to every paid feature, not only Chat.
6. **Tests:** `max_tokens` derived from the cap and the input estimate;
   a capped reply is saved, charged its real usage and carries the
   notice; input over the cap is refused with no charge and no provider
   call; the warning and its figures; the daily cap counts across
   features and resets at KST midnight; the settings are audited.


**Owner decision — 2026-10-14 (morning, tool-cap-defaults):** the default
per-reply cap rises **100원 → 200원** — the strict cap stayed (result
tokens reserved inside it), and at 100원 웹 페이지 읽기 could never fit.
The default lives in `chat_limits.DEFAULTS` only; the table is never
seeded, so no data moved.

## live-cost-display — full spec (merged 2026-10-14)

Branch `feat-live-cost-display`. Added by the owner on 2026-10-13. Saved
exactly as written:

> live-cost-display (after cost-calibration): while a reply streams, show the running cost in won next to it; after it ends, a small receipt (input, output, cache read, won) and the wallet card in the sidebar updates at once. The ledger stays the single source of truth; the live figure is an estimate settled by the real usage.

**Depends on:** `cost-calibration` (merged); `token-guard` (the same
running estimate drives its cap); best after `chat-plus-rendering`,
which reworks the same reply bubble.

1. **While streaming:** beside the reply, "약 N원", updating as text
   arrives: the calibrated input estimate plus the output so far
   (`estimate_tokens` of the streamed text), priced for the model.
   Always labelled as an estimate (약). Updated at most a few times a
   second.
2. **When it ends:** the `done` event carries the real usage the ledger
   recorded (input, output, cache write and cache read tokens, and
   `charged_krw`), and the bubble shows a small receipt: 입력 / 출력 /
   캐시 읽기 / 합계 N원. The figure shown is the **ledger's**, never the
   estimate; if they differ, the receipt simply replaces the estimate.
3. **The sidebar wallet card updates at once** (a `MyQuarterProvider`
   refresh, or the remaining balance carried in the `done` event), and
   the Usage page shows the same row.
4. **A stopped or capped reply** gets the same receipt; a failed call
   shows "청구되지 않았어요".
5. **Tests:** the running figure never shows without 약; the receipt's
   numbers equal the usage event's; the wallet card changes without a
   reload; a failed call shows no charge.

## chat-plus-tools — full spec (merged 2026-10-14)

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

**Owner decision — 2026-10-14 (morning, tool-cap-defaults):** 웹 페이지
읽기 is bounded to **1회 per reply × 10,000토큰 per page** by default,
and both figures became admin settings in Admin › System › 채팅 한도
(audited, carried on each request to the adapter and the mock). With the
cap at its new 200원 default, 웹 검색 and 페이지 읽기 fit on every
member-visible model — pinned by a catalogue-iterating test; a cap below
a tool's worst case still refuses with the Korean notice.

## audit-caching-and-distribution — full spec (merged 2026-10-14)

PART F of the owner's 2026-10-14 addendum (merge pre-approved when clean;
"include in the PART E deploy if it finishes before it, otherwise list it
as 'deploy next'" — it finished after, so it deploys next). The owner's
words are in the run log (docs/archive/progress-2026-10/RUN-2026-10-13.md › Run of
2026-10-14) and the built details in
[`progress-2026-10-13/audit-caching.md`](progress-2026-10-13/audit-caching.md) and
[`progress-2026-10-13/audit-caching-and-distribution.md`](progress-2026-10-13/audit-caching-and-distribution.md);
the member/admin-facing result is [`../api-distribution.md`](../api-distribution.md).

**Owner decision — 2026-10-14 (morning):** the Sonnet 5.5 cache-read
over-charge ($0.20 instead of the documented $0.10) is **not
compensated** — every charge made at the wrong price was mock or
development data; no member's real money moved. The ledger keeps the
recorded figures as history.

## Queue history — how Next was reordered (2026-10-01 → 2026-10-13)

*(Moved from BACKLOG › Now on 2026-10-14, docs-cleanup; text unchanged.)*

**Earlier working order (2026-10-07)** — superseded by the owner's order
of 2026-10-13 at the top of **Next**.

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

**Working order set by the developer (2026-10-08)** — complete:
single-wallet and `ui-friendly-motion` merged 2026-10-13,
`deepseek-research` merged 2026-10-14 (owner approved, with
admin-and-nav-cleanup).


## privacy-and-terms — full spec (merged 2026-10-14)

Branch `feat-privacy-and-terms`. M1, top of Next. Added by the owner on
2026-10-14. **The owner reviews the text before it ships.** Saved exactly
as written:

> privacy-and-terms: 개인정보 처리방침 and 이용약관 pages in Korean for a club (collected data — Google email/name, username, chats, files, usage; why; retention; withdrawal and anonymisation after 30 days; stored in Google Cloud Seoul; contact ctrlai.platform@gmail.com). Consent checkbox at sign-up (Google and password); links on the sign-up screen and sidebar footer. Before members are invited; I must review the text.

**Built (2026-10-14):** `/privacy` and `/terms` (Korean, logged-out,
시행일 2026-10-14 · v1), consent checkbox on both sign-up paths enforced
server-side before any invite use (`users.terms_accepted_at`, migration
`b9e6a3d1f4c7`; existing members stay NULL — re-consent is the owner's
call), 개인정보 · 약관 links in the sidebar footer. Two review rounds
checked every sentence against the code (backups: the newest 7 kept by
hand, no day-based retention; attempt rows pruned on the next attempt;
deletes need an active quarter; community screens in future tense).
**운영진 검토 필요** — the owner reads the final text before inviting
members. Open: no member password-reset tool exists (약관 §3 says "운영진에게
알려 주세요").

---

## project-export-handoff — full spec (merged 2026-10-15)

Added by the owner on 2026-10-15 (H4 of RUN-2026-10-15). Saved verbatim:

H4 — feat-project-export-handoff. I pre-approve merge + deploy (same PART E rules), after H1 and H2.

Goal: a member can download their whole Builder project and keep developing it with their OWN Claude (claude.ai or Claude Code) without knowing anything technical. Beginner-friendly, all Korean.

1. Download (Project Builder header ⋯ → "프로젝트 내려받기", and the existing ZIP button):
   ZIP named <project-slug>-v<N>.zip containing:
   - the project files of the chosen version (default: current draft; option: 게시된 버전)
   - README.md (Korean): what this app is, how to open it (index.html 더블클릭 / 간단한 로컬 서버 명령 한 줄), file list with one line each, what works only in the browser (localStorage), and "다음에 해 볼 만한 것" 3 ideas
   - CLAUDE.md: project context for Claude Code (purpose, file structure, constraints it was built under — static, no network, size caps — and that outside CTRL+AI those limits no longer apply), coding conventions used, how to run/test
   - HANDOFF_PROMPT.md: a ready-to-paste Korean prompt for claude.ai ("첨부한 ZIP은 CTRL+AI에서 만든 내 웹앱이야. …"), with blanks the member fills ("내가 추가하고 싶은 것: ___")
   - HISTORY.md: version list (v1… with the member's request text for each, date), so their Claude knows how it evolved
   - SPEC.md if the project has one (e.g. the showcase apps' original full-stack spec → their Claude can build the real FastAPI/Postgres/Claude version)
   - nothing else: no CTRL+AI internals, no tokens, no other members' data, no usage/cost data.

2. "내 Claude로 이어서 만들기" panel (button next to 내려받기), a short guided sheet with two tabs:
   - claude.ai: ① ZIP 내려받기 ② claude.ai에서 새 대화 → ZIP 첨부 ③ 아래 프롬프트 복사해서 붙여넣기 — with the prompt shown in a box + 복사 button, and an optional text field "무엇을 더 하고 싶나요?" that is inserted into the prompt live.
   - Claude Code: ① ZIP 풀기 ② 폴더에서 `claude` 실행 ③ "CLAUDE.md 읽고 README의 다음 아이디어 1번부터 해 줘" 같은 첫 문장 예시 + 복사.
   - One line: "CTRL+AI 밖에서 만든 변경은 자동으로 돌아오지 않아요. 다시 올리려면 파일을 Builder에 붙여 넣거나 (나중에) GitHub 연결을 쓰세요."
   - Copy buttons show 복사됨 for 2 s; keyboard/screen-reader accessible; light/dark; 390px bottom sheet.

3. Admin can preview exactly what goes into the ZIP for any example app (to check the prompts read well). The three showcase apps (H2) get hand-polished README/CLAUDE/HANDOFF/SPEC.

4. Optional (if small): on a published CtrlAIApps listing, the owner can tick "다른 회원이 이 앱으로 시작하기 허용" → others get "내 프로젝트로 복사" (a fresh Builder project from the published version, credited "원작: <이름>"). If not small, add it to BACKLOG as `app-remix` instead.

5. Tests: ZIP contents/paths/names, version choice, no secrets or other users' data, prompt text includes the member's extra request, file-size caps, deleted project → 404. Screenshots in the run log. Final report in Korean, ending with the branch.

When app-platform P1 lands, update the H4 README/CLAUDE.md templates to mention ctrlai.storage / the SDK (and that outside CTRL+AI those calls need replacing).

As built: optional point 4 (remix) was not small and became BACKLOG `app-remix`; the showcase apps' guides reach the server with `import_example_apps --update`.

## feedback-screenshots — full spec (merged 2026-10-16)

Branch `feat-feedback-screenshots`, built 2026-10-16 in a separate
worktree (two other tabs were on the main folder). The owner's words are
above ("… and also be able to put in screenshots to their feedback"); the
request as relayed: 최대 3장 (png/jpg/webp, 1장 5MB 이하), 파일 고르기 ·
끌어다 놓기 · 붙여넣기(⌘V) 모두, 미리보기 썸네일 + ✕, 휴대폰에서도 사진
고르기, 안내 한 줄 "화면에 개인정보가 보이면 가린 뒤 올려 주세요",
chat-plus-files와 같은 서버 처리, 관리자만 보기, 의견을 지우면 이미지도.

1. **Upload before the note**, like Chat: `POST /api/feedback/images`
   (bytes as the body, `?name=`, must not be a "simple" content type —
   CLAUDE.md §2) → a `feedback_images` row with `feedback_id` NULL and the
   re-encoded copy in storage (`feedback/<user_id>/<id>`). Checks reuse
   `attachments.reencode_image`: kind from the bytes (PNG/JPEG/WebP only
   — not GIF), extension must agree, ≤ 5 MB read with a hard stop,
   decoded under the pixel guard, encoded again with no metadata, long
   edge 2,560 (a screenshot is read by a person, so larger than Chat's
   1,568). Stored bytes count against a per-member quota
   (`FEEDBACK_IMAGE_MEMBER_QUOTA_MB=100`, 409) and the server total Chat
   attachments share (`CHAT_ATTACHMENT_TOTAL_LIMIT_GB`, 507); Admin's
   dashboard "첨부 파일" figure includes them. A 4th waiting picture is
   refused ("사진은 3장까지 붙일 수 있어요."); only then, waiting pictures
   older than a day (a closed tab) are swept first so a leftover never
   blocks a member — and a picture still shown in an open dialog is never
   taken away under it (review fix, 2026-10-16). The body reader, name
   sanitiser and file-response headers are shared with Chat
   (`api/uploads.py`), as is the browser's `uploadBytes` (`lib/http.ts`).
2. **The note** `POST /api/feedback` carries `image_ids`: each must be the
   sender's own waiting picture (else 400 "사진을 찾을 수 없어요"), at
   most 3; they are attached, and any other waiting picture of the
   sender is deleted with its bytes (a dialog closed without sending).
3. **✕ / closing the dialog** → `DELETE /api/feedback/images/{id}` (own
   and waiting only; 404 for anyone else's, 409 once sent). The dialog
   also deletes what it uploaded when closed without sending — including
   an upload that finishes after the close — and does not close at all
   (Esc, backdrop) while 보내기 is in flight, so the deletions can never
   race the note.
4. **Who sees a picture: admins only.** `GET /api/admin/feedback` lists
   each note's pictures; `GET /api/admin/feedback/images/{id}/file`
   serves one inline (nosniff, sandboxed CSP, private cache) — a member,
   the uploader included, gets 403; a waiting (unsent) picture is 404 even
   to an admin. There is deliberately no member route to a stored copy:
   the thumbnail in the dialog is the browser's own object URL.
5. **Deleting.** `DELETE /api/admin/feedback/{id}` removes the note, its
   rows (cascade) and its bytes, audited `feedback.deleted` (의견 삭제)
   with the count. Admin › Feedback gets 지우기 with a confirm. Withdrawal
   anonymisation deletes the member's pictures (like Chat attachments) and
   keeps the notes.
6. **Dialog.** 스크린샷 붙이기 (file input `accept=image/png,image/jpeg,
   image/webp`, multiple — phones open the photo library), drag onto the
   form (dashed outline), paste on the form or the textarea (image files
   only; pasting text is untouched; a nameless pasted image gets
   `screenshot-N.<ext>` from its type). Thumbnails 88×66 with ✕; "N/3장 ·
   붙여넣기(⌘V)나 끌어다 놓기도 돼요"; the privacy line; the server's
   Korean refusal under the thumbnails; 보내기 waits while a picture is
   uploading ("사진 올리는 중…").
7. **Admin › Feedback.** A 사진 column of thumbnails (admin-only URL),
   click → `ImageLightbox` (← → between a note's pictures, Esc, caption
   with name · size · dimensions); 지우기 per row.
8. **Settings** `FEEDBACK_IMAGES_PER_NOTE=3`, `FEEDBACK_IMAGE_MAX_MB=5`
   (`.env.example`). Migration `c2d9e4f7a1b6` (`feedback_images`).
9. **Tests.** Backend `tests/test_feedback_images.py` (kinds accepted by
   bytes; GIF/PDF/renamed/text/broken refused with nothing stored; > 5 MB
   413; 4th refused; stale sweep; simple content type 415; sign-in; note
   carries pictures and Admin sees them; admin-only file (member 403,
   signed-out 401, unsent 404); other member's picture 404 / "not found";
   ✕ deletes bytes; sent picture 409; > 3 ids refused; abandoned picture
   goes with the next note; admin delete + audit; member cannot delete;
   anonymisation) and the guard map. Frontend
   `__tests__/feedback-screenshots.test.tsx` (paste, nameless paste,
   text paste ignored, drop + picker, ✕, close-without-send, 4th/kind/size
   refused, server refusal, send carries ids and waits for uploads,
   privacy line + accept; Admin thumbnails + lightbox, delete with
   confirm).

Merged `12e72a8` (owner approved 2026-10-16). Review fixes (`87b4660`): no
close while sending, a late upload deleted, the sweep only at the cap and
only day-old, member quota (`FEEDBACK_IMAGE_MEMBER_QUOTA_MB`) + the shared
server total + the dashboard figure, shared upload helpers
(`api/uploads.py`, `uploadBytes`), a synchronous shot list, lightbox focus.

## promo-videos — full spec (merged 2026-10-16)

Branch `feat-promo-videos`. Moved here from BACKLOG › Next on merge; text unchanged.

    *Not pre-approved — branch, test, report, WAIT. Order: after
    publish-summary (merged 2026-10-16).* **Status 2026-10-16: built on
    the branch, tests green, waiting for the owner** — see
    `progress/RUN-2026-10-16.md` › PV. Owner, 2026-10-16 (relayed from another session,
    their words): "영상 소스 있음 https://github.com/anoukkim/ctrl-ai-platform/tree/chore-promo-videos/promo-videos
    — 2번(데스크탑), 3번(모바일 영상) — 이거를 각각 가이드 마지막(화면
    임베디드, 크게 보기 가능) 그리고 ctrl tube에 그냥 기본적으로 나오는
    영상 하나(리액션 댓글 가능하게. 나머지 영상들은 유튜브일텐데 얘는 그냥
    기본으로) 나오게 해줘" — this is owner-polish 7. Sources on
    `origin/chore-promo-videos`: `promo-videos/02-swiss-garage.mp4`
    (1920×1080, 13.8 MB, desktop) and `03-y2k-jersey.mp4` (1080×1920,
    23.9 MB, mobile); original music per its README. Do not commit the
    originals: re-encode with ffmpeg for the web (H.264 + AAC, +faststart,
    about 1280×720 and 720×1280, roughly 5–8 MB each, check the quality)
    plus a JPG poster, commit only those; decide and report where they are
    served from (e.g. `frontend/public`) and the cache headers;
    `preload="metadata"`, never autoplay (data, sound). (1) FirstVisitGuide
    (four steps today) gets a last step "CTRL+AI 한눈에 보기": the video in
    the page with controls, 크게 보기 / fullscreen; 02 on desktop, 03 at
    phone widths; sound only when the viewer turns it on; reduced motion,
    keyboard and screen readers considered. Also *propose* in the report
    (owner decides) replacing step 3 "Video Generator — 영상 만들기", which
    contradicts owner-polish 6 (video locked this quarter), with a
    CtrlAIApps introduction. (2) CtrlAITube: a default video first in the
    grid marked "공식", played in the page from our file (02/03 by width),
    with real reactions and comments on its detail screen. CtrlAITube is
    all `MOCK_VIDEOS` today, so this needs the backend: design the video
    rows with a source kind (hosted / youtube) with Phase 8 in view,
    reaction and comment tables + an Alembic migration + routes (reads
    `get_current_user`, writes `require_active_member`, another member's
    comment 404/403), admin hide/delete (reason, audited) and 신고 through
    the existing report queue, the CLAUDE.md §10 `deleted_at` rule, the
    guard map. The other sample cards stay marked as test data. Tests: the
    guide's last step (desktop/mobile choice, 크게 보기), the Tube default
    video element, reaction/comment CRUD and permissions (non-participating
    members read only; another member's comment), admin hide, 신고.
    Screenshots 1440 · 390, light and dark.

## owner-polish-a — delivery notes (merged 2026-10-16)

Branch `fix-owner-polish-a`, merged `806f563` (owner approved 2026-10-16).
The owner's words for every point stay in BACKLOG › "owner-polish-2026-10-16"
(the remaining points refer to them). What was built, per point:

- **3 (bug)** Profile › 내가 만든 앱: `GET /api/apps/mine` (the store's
  listing query narrowed to the caller), shown with the shared `AppCard`.
- **8 (bug)** Admin › Members: 미신청 = neither an application nor a
  participation row this quarter, excluding 탈퇴 회원 — card and filter
  alike; the list carries `application_status`; 미참여 stays its own option.
- **1** `PATCH /api/admin/invites/{id}` (`max_uses`): never below the
  sign-ups made (row locked), unchanged logs nothing, `invite.updated`
  audited with before/after; inline 바꾸기 in the 사용 cell.
- **9** `PATCH /api/account/profile` (display_name, 1~100, trimmed,
  `get_current_user`); 이름 바꾸기 inline; 아이디 fixed; no profile picture.
- **6** `feature_switches` (append-only, newest wins, no row = locked;
  migration `d7e1f3a9b5c2`). `require_video_open` on Video create/edit/AI
  routes on top of participation (delete and reads keep their guards); the
  API never locks the 관리자 out. `/api/site.video_open`; Admin › System ›
  기능 열기 flips it with a note (`feature.set` audited). Screens (owner's
  shape): one centred lock + "Video Generator는 다음 단계에서 열려요 / 지금은
  준비 중이에요" for everyone, the 관리자 with one extra line to Admin ›
  System; the menu item carries a lock and the hint under its name.
- **13** The Claude 판 conversation appears only once a Claude-made
  version exists; until then 모든 버전 is open and carries 이 버전 보기.
- **14** Builder: busy button with spinner and `cursor: progress` (never
  🚫), "작성 중… N초" on the current step, ✓ pops, thin n / m 파일 bar.
  Chat: "생각하는 중…" shimmer + seconds; new blocks ease in. Reduced
  motion: no animation, text and timers stay. Not built: per-character
  file text — the backend writes files whole (needs run-stream deltas).
- **10** spend-feedback v2: spring pop with a coin and sparks, large
  "-N원", the chip flies to the sidebar balance when visible, the toast
  carries amount + remaining otherwise; 띠링 = WebAudio two tones, Profile ›
  알림 switch, off by default, per device (localStorage). Real
  `charged_krw` only; reduced motion = plain toast.
- Checks at merge: backend 1063 (PG on, exit 0), frontend 535,
  tsc/lint/build OK, Playwright 14/14, screenshots
  `progress/screens/owner-polish-a/`; `/code-review high` findings fixed.

## ui-improvements-a — delivery notes (merged 2026-10-16)

Branch `feat-ui-improvements-a`, merged `89efa9c` under the owner's written
pre-approval of 2026-10-16 (quoted in `progress/RUN-2026-10-16.md` › UI-A):
own `/code-review high` and `/security-review`, every gate green, main
merged with one Alembic head, the coordinating session asked before the
merge. The owner's words stay in BACKLOG › "owner-polish-2026-10-16"
(points 4, 5, 15) and › ui-improvements (the UI bundle; its admin half,
points 3–6, is another session's branch). What was built:

- **App detail (owner-polish 15).** One head row — small thumbnail, name,
  maker, "vN · 3일 전 업데이트", 업데이트 메모; 새 창에서 열기 and 신고하기 on
  the right — the description folded past 80 characters, the sandboxed
  frame right under it sized `clamp(360px, 100dvh − chrome, 1400px)`
  with a taller chrome figure on the phone (the head is two rows there),
  so the frame ends inside the first screen at 390px. No colour block,
  no duplicate 앱 실행. The honest note names shared lists only when the
  published `ctrlai.json` declares one (`AppListing.shared_lists`,
  parsed from that one file; a broken manifest counts as none).
- **ListToolbar.** `label | search | controls` grid on the four lists
  (Builder, CtrlAIApps, Video, CtrlAITube's header row); the search ends
  at the card row's edge; stacked below 44rem. The global `.toolbar`
  rules and the striped `--lib-stripe` placeholder are gone.
- **Pins · favourites · sort** (migration `a3f7c1d9e2b4`: `pinned_at` on
  builder and video projects, `draft_thumbnail_at`, versions'
  `thumbnail_at`, table `app_favorites`). `POST
  /api/builder/projects/{id}/pin` and `/api/video/projects/{id}/pin`
  (`{on}`, `get_current_user` — a reading preference, like ★; never moves
  `updated_at` via `services/quiet.quiet_update`); `POST
  /api/apps/{slug}/favorite` (`get_current_user`, idempotent on the
  unique row); `SortMenu` + `lib/list-sort` (마지막 수정순 / 이름순 in
  `localStorage` per screen), pinned or favourite first with a stable sort.
- **Thumbnails (owner-polish 4·5)** — method A of the plan: a capture in
  the maker's browser, never member code on the server. SDK version "5"
  answers the shell's `capture` event with a PNG (DOM clone with the
  computed styles that differ from a bare element of the same tag → SVG
  `foreignObject` → canvas; ≤ 5,000 nodes, ≤ 4 M characters, long edge
  ≤ 1,600 px); the shell relays only for `window.parent` with an origin
  in `data-sites`, answers only the asking origin, once per id; the site
  (`lib/thumbnail-capture.ts`) checks source, origin and id, turns the
  data URL into a Blob and uploads it (`POST
  /api/builder/projects/{id}/thumbnail?space=draft|published`,
  `application/octet-stream`, ≤ 4 MB, `require_active_member`);
  `services/thumbnails.encode` sniffs PNG/JPEG/WebP from the bytes,
  decodes through the shared `attachments.decode_image` (pixel guard,
  EXIF applied then dropped), draws on white, fits 640×400 top-anchored,
  writes WebP q82 with no metadata into `AssetStorage`
  (`thumbnails/<project>/draft.webp`, `v<N>.webp`; pruned versions take
  theirs along). `PreviewPane` captures 1.5 s after the frame loads and
  on ⋯ › 썸네일 다시 찍기 (errors shown only for the manual one);
  `HiddenCapture` photographs the published address right after 게시; the
  게시 dialog says the first screen becomes the card. Served by `GET
  /api/builder/projects/{id}/thumbnail` (owner) and `GET
  /api/apps/{slug}/thumbnail` (any signed-in member, published only) with
  nosniff and a sandboxed CSP. Known blanks — an app's own `<img>` files,
  WebGL, Safari — keep the coloured cover; `thumbnail-render-worker` is
  the later item.
- **Add-ons the owner asked for on the way.** builder_stages, builder_edit
  and builder_starter no longer copy a request into `description` and
  `ArtifactPreview` sends none, so a card shows a description only once
  published; Profile › 알림 as two `role="switch"` rows on one grid;
  Profile › 내가 만든 앱 as `<ul>` rows (name · vN · time · 열기), no pictures.
- **Tests.** Backend: `test_ui_improvements.py` (pins incl. an owner not
  taking part, `updated_at` untouched, favourites per member),
  `test_thumbnails.py` (encode, routes, pruning, shell `data-sites`),
  guard-map rows, shared-lists listing, "a request never becomes the
  description", SDK "5". Frontend: ListToolbar CSS contract and the four
  screens, list-sort, pin/sort cards, thumbnail capture protocol,
  thumbnails on cards and the preview, Profile rows, CtrlAIApps detail.
  Playwright `e2e/ui-improvements.spec.ts` (4): a from-chat project's
  preview is photographed and the stored WebP's RIFF/WEBP header checked,
  the Builder card shows it, 게시 photographs the published app for the
  CtrlAIApps card and head, the detail frame fits 390 × 844, pin · 이름순
  · ★ survive a reload, Profile's two switches align and the list has no
  image. Final: backend 1076, frontend 547, tsc/lint/build, Playwright
  6/6 (with promo-videos), screenshots `progress/screens/ui-improvements-a/`.
- **Reviews.** `/code-review high` 9 findings fixed in `028c5eb` (the
  `updated_at` bump, the pin guard, pruned pictures, one decoder, the SDK
  payload, the favourite race, manifest-only parsing, the `<img>` retry,
  one upload helper); `/security-review` no findings; nothing touches
  wallets or charging.

## ui-improvements — full spec (A merged 2026-10-16 `89efa9c`, B merged 2026-10-16)

Moved out of BACKLOG › Next when the B half merged. The item as it stood,
with the owner's words:

**ui-improvements** · M1 · two branches
    **A — the member screens: merged 2026-10-16 as `89efa9c`
    (`feat-ui-improvements-a`; Done row and delivery notes in the archive;
    migration `a3f7c1d9e2b4`):
    points (1), (2) and (7) below, plus three add-ons the owner asked for
    on the way — a Builder card never shows the last request as its
    description (the from-chat path fixed too), Profile › 알림 as two
    aligned switch rows, Profile › 내가 만든 앱 as a plain list. **B — the
    admin screens, points (3)–(6): merged 2026-10-16
    (`feat-ui-improvements-b`; delivery notes below; migration
    `a3c7e9b1d5f2`).** Owner, 2026-10-16 (relayed from another
    session): fold **owner-polish 15** (app detail screen) and **owner-polish
    4·5** (thumbnails) together with the UI points below into one bundle.
    The thumbnail method is decided in the plan from 2–3 compared options
    (never running member code on the server, CLAUDE.md §8·§10). Do **not**
    touch owner-polish 6 (video lock) — another session has it. Owner's
    words, verbatim: "그거랑 같이 지금 검색도 이상함 뭔가 선도 끝에랑
    안맞고 (video에는 보면 사용자별 드랍다운이 있는데 여기엔 없어서 그런지
    뭔지 모르겠음) 모든 build, store, 빌드 영상 둘다 나중에 pin이랑 정렬
    (마지막 수정일 이름) 으로 할 수 있게 / 분기 신청기한도 늘릴 수 있게 /
    ai model budget 여기 화면 너무 복잡해 너무 줄줄이 길어 뭔가 차라리
    하나씩 토글해서 볼 수 있으면 나을 듯 / deleted items는 관리자가
    완전히 삭제할 수 있음. 그리고 분기 끝나면 관리자 안 삭제한거
    전체적으로 자동 삭제 (이건 확정) / system도 뭔가 너무 많음;; 걍
    연결상태를 전체적으로 health를 보고 싶은데 아래에 뭐가 저리 많음 /
    그거까지 해서 ui개선". The relaying session's reading of the
    screenshots, to confirm in the plan: (1) the search bar's right edge on
    CtrlAIApps does not line up with the card row (Video has the
    전체/작성 중/게시됨 filter beside it) — align the list screens' header
    rows (Builder, CtrlAIApps, Video, CtrlAITube) on one grid; (2) pin +
    sort (last modified / name, remembered) on the Builder, CtrlAIApps and
    Video lists — pins per member (CtrlAIApps: a member's own favourites),
    one migration if storage is needed; (3) Admin › Quarters: extend an
    application deadline later (within the quarter; audited; whether a
    closed quarter can reopen is proposed in the plan); (4) Admin › AI
    Models and Budget: sections collapsed to a summary, opened one at a
    time, state remembered; (5) Deleted Items: an admin's 완전히 삭제
    (confirm, reason, audit) **and**, at 분기 마감, everything not restored
    is purged automatically (owner's decision) — money rows (`UsageEvent`,
    wallets, audit) are never deleted, so the design must survive the
    project's removal (FKs, name snapshots), app folders and stored files
    go too, and the decision is recorded in CLAUDE.md §2/§4; (6) Admin ›
    System: an at-a-glance health row (server · DB · each provider,
    green/red) on top, the rest (exchange rate, chat limits, depth table,
    `.env` list, builder check) in collapsed sections; (7) owner-polish 15
    and 4·5 as written.

## ui-improvements-b — delivery notes (merged 2026-10-16)

Branch `feat-ui-improvements-b`, built in the worktree `../ctrl-ai-ui-b`
under the owner's written pre-approval of 2026-10-16 (quoted in
`progress/RUN-2026-10-16.md` › UI-B): own `/code-review high` and
`/security-review`, every gate green, main merged with one Alembic head,
the coordinating session asked before the merge. What was built:

- **(4) 신청 기한 연장 / 신청 다시 열기** (`cddc2bc`). Admin › Quarters row
  menu: 신청 기한 연장… while applications are open, 신청 다시 열기… once
  they were closed by hand (`active`); off for `draft` and `closed`.
  `ExtendDeadlineDialog` opens on the first valid day (the day after the
  current deadline, or today) and is bounded by the quarter's end. The
  rules are the backend's (`PATCH /api/admin/quarters/{id}`): once a
  quarter is open or running its deadline is today or later and inside
  the quarter; reopening `active` → `application_open` needs a deadline
  that has not passed; a quarter that never had an application window
  gets one from its first day when a deadline is set; **분기 마감
  (`closed`) never reopens** (409). The audit summary names the change
  ("…마감일을 D로 늦췄습니다" when it moved later, "바꿨습니다" otherwise,
  "신청을 다시 열고…" on reopen).
- **(1)+(2) Folds** (`e15b066`). `admin/components/Fold.tsx`: `FoldGroup`
  keeps one open section per screen in `localStorage`
  (`ctrlai.admin.<screen>.open`, "" = all closed) through
  `lib/layout-prefs.makePrefs`; `Fold` is a `<section>` with an
  `aria-expanded` button, a one-line summary while closed and the body
  only while open. **AI Models**: StatCards (모델 · 회원 공개 · 기본 모델 ·
  제공자), one fold per provider (all forced open while searching), 비용
  보정 as a fold. **Budget**: the stat cards, then eight folds (이달 ·
  지원금 대비 사용 · 크레딧 · 제공자별 · 모델·깊이별 · 회원별 · 캐시 · 대조)
  each with a figure in its summary line. **System**: `HealthStrip` on top
  — 서버 · 데이터베이스 from `/api/health`, each provider from its last
  recorded success/error (`providerTone`: mock → grey; an error newer
  than the last success → red; otherwise green) — nothing is called on
  open, 모두 확인 runs every provider check in turn; below it the server
  card, 기능 상자, providers, 환율, 채팅 한도 (with the depth table), `.env`
  and the builder check as folds.
- **(3) Deleted Items 완전히 삭제 + purge at 분기 마감** (`32a25e5`, owner's
  decision recorded in CLAUDE.md §2/§4). `services/purge.py`:
  `purge(db, item)` locks the row, re-checks `deleted_at` (a restore in
  between wins), copies the name onto its usage events
  (`usage_events.work_label`, migration `a3c7e9b1d5f2`) and nulls their
  project/video links, then deletes every child explicitly youngest first
  (reports, data items/collections/writes, login codes, sessions,
  consents, favourites, generations, files, versions; video versions)
  and the row — explicitly because the tests run on SQLite, which does not
  cascade. `DELETE /api/admin/work/{kind}/{id}/purge` (`require_admin`,
  JSON `{reason}` 1–500 characters, blank refused, Deleted Items only)
  writes `work.purged` with the reason in `detail` (the summary column
  holds 300). `POST /api/admin/quarters/{id}/close` purges everything in
  Deleted Items **deleted by the quarter's last day (KST)** in the same
  transaction as the wallet freeze — a late close leaves this week's
  deletions for their own quarter — with one `work.purged_at_close` row
  listing the items; the close preview carries `purge_count` and the
  dialog says how many. App folders and stored videos are removed after
  commit (`remove_files`, tolerant of a missing file or a bad key). Usage
  labels purged work "… (삭제됨)". **Money rows never go**: usage events
  keep their amounts, wallets freeze as before, audit rows are appended.
- **Tests.** Backend `test_purge.py` (12): project purge removes the row,
  one row of every child table and the folder but keeps the charge with
  its amount and name; video purge removes the stored file; app charges
  keep the name; live work refused; reason required, blank refused, a
  500-character reason fits (proven on the PG run); only admins; close
  purges what was deleted by the last day and keeps a later deletion; a
  restore between the list and the purge wins; nothing deleted → no row.
  `test_admin_quarter_form.py` +7 (extend, past, outside the quarter,
  reopen, reopen with a past deadline, closed never, no window). Guard
  table row for the purge route. Frontend: `admin-fold`,
  `admin-health-strip`, `admin-extend-deadline`, `admin-deleted`,
  `cost-clarity` (purge count), catalogue and wallet tests adapted to the
  folds. Screenshots `progress/screens/ui-improvements-b/` (18, by
  `e2e/ui-b-shots.mjs`).
- **Reviews.** `/security-review` (subagent on the worktree diff): no
  findings; one note applied (`remove_files` catches `StorageKeyError`).
  `/code-review high` (subagent on the worktree diff): 8 findings, all
  fixed in `0097817` — the audit summary overflowing 300 characters on
  PostgreSQL, a quarter without an application window unable to reopen,
  the extend dialog opening in an error state, `AppFavorite` rows not
  purged, the close purging deletions after the quarter's last day, no
  re-check of `deleted_at` under a lock, a whitespace reason, and
  "늦췄습니다" for a deadline that moved earlier. Nothing touches
  `usage.charge()` or the wallets.

## app-ai-access — full spec and delivery notes (merged 2026-10-16)

The item as it stood in BACKLOG › Next (its "Not pre-approved" line
predates the owner's batch pre-approval of 2026-10-16, which names it):

**app-ai-access** · M3 · branch `feat-app-ai-access`
    *Not pre-approved — branch, test, report, WAIT.* Owner decision
    2026-10-16 (saved in their words below): when publishing an app that
    uses AI, the creator chooses **데모만** or **전체 기능** (changeable
    later); visitors switch between 데모 and 토큰 사용 any time; the
    관리자 can turn AI off per app (today's kill switch). Comes after
    app-platform P4.

The owner's answers of 2026-10-16 stay in BACKLOG › "owner-polish …" ›
Answers ("Who controls 데모 / 토큰 사용"). Branch `feat-app-ai-access`,
built in the worktree `../ctrl-ai-ui-b` right after ui-improvements B,
on the coordinating session's "시작해". What was built:

- **The maker's choice** (`builder_projects.ai_access`, "demo" | "full",
  migration `b2d4f6a8c0e1`). The 게시 dialog asks "이 앱은 AI를 써요 —
  다른 회원에게 AI 기능을 열까요?" — 데모만 (default) / 전체 기능 — when
  `publish-summary` reports `uses_ai` (the working copy's pages or
  scripts call `.ai.ask/stream/estimate` in a file naming `ctrlai`,
  aliases included) or the app is already 전체 기능; `publish` takes
  `ai_access`; the Builder's 게시 menu (⋯) offers "AI 기능: …" for every
  published app (`POST /api/builder/projects/{id}/ai-access`, owner only,
  `get_current_user` like 게시 취소). Apps published before the migration
  were set to "full" so the deploy changed nothing; a new app starts as
  "demo"; `import_example_apps` publishes the showcases as full.
- **The server refuses in 데모** (`app_platform._ai_allowed`): a visitor's
  `/_ctrlai/v1/ai/ask` and `/stream` in mode "app" — or in a preview used
  by anyone but the project's own maker (`_owners_preview`) — answer 403
  `{code: "demo"}` before `prepare()`: no provider call, no `UsageEvent`,
  the wallet untouched (`test_app_ai_access.py`). `estimate` stays free.
  `/v1/app` carries `ai: {usesAi, access}`.
- **The shell's bar** (`shell.js`): a thin CTRL+AI strip above the app
  frame for a published app that uses AI or is 전체 기능 — badge "실제 AI
  · 내 지원금에서" (or "· 로그인하면 …" signed out) / "데모 · 0원" / "데모 ·
  AI 호출 없음" and the button 데모로 보기 / 실제 AI 켜기 (the showcases'
  badge-and-button look); the visitor's choice is kept per app in the
  shell origin's `localStorage` (`ctrlai:<slug>:ai-mode`). In 데모 the
  shell rejects `ai.ask` / `ai.stream` locally with code "demo" after
  `/v1/app` has answered (never on a stale `info`, never in the maker's
  preview) and before `signedIn()`, so no sign-in window opens. A bar,
  not a floating pill: the pill covered the showcase's tab bar at 390px.
- **SDK version "6"**: `ctrlai.ai.mode()` → "live" | "demo" ("demo"
  outside CTRL+AI), the window event `ctrlai:ai-mode` when the bar is
  flipped. `_SDK_RULES` tells the Builder's Claude to treat code "demo"
  like signed-out (the demo answer, marked "데모"). The three showcases
  and the AI 챗봇 template handle it.
- **Screens.** CtrlAIApps' detail adds one honest line (데모만 / 전체
  기능); Admin › Apps shows "AI 전체 기능 / 데모만" beside the app and a
  fact on the app's page; /help/apps gained the paragraph. Docs:
  CLAUDE.md §2 › Member app platform (5), product.md, architecture.md.
- **Tests.** Backend `test_app_ai_access.py` (11): the flag and its
  aliases, the version carries it, the dialog asks only for AI apps, the
  choice at 게시 and the default, the owner's switch and a stranger's
  404, 데모 refuses ask/stream with the code and an empty ledger, the
  maker's own preview vs a guest of the preview, the shell/SDK strings
  and the gate's order, the showcases import as full, the prompt and
  examples know the code, a bad setting refused. Guard-table rows.
  Frontend: the dialog's question (shown, default, sent; not shown, not
  sent), the detail's note. Playwright `e2e/app-ai-access.spec.ts`:
  데모만 → code demo and no sign-in window; 전체 기능 → the bar, 데모로
  보기, the choice survives a reload, nothing charged throughout; live
  and signed out → the sign-in window opens. Final: backend full (PG
  on) exit 0, frontend 570, tsc/lint/build, Playwright 19/19;
  screenshots `progress/screens/app-ai-access/` (14, by
  `e2e/app-ai-access-shots.mjs`).
- **Review** (one read-only subagent on the worktree diff, code +
  security): 5 findings fixed in `50da2b0` — the shell's gate on a
  stale `info`, the flag gating the switch (aliases), the preview
  exemption open to anyone with the link (low, security → owner only),
  the doc chatbot stuck in demo, bare 403 assertions. No money or
  security high.

## feat-notifications — delivery notes (merged 2026-10-16)

Branch `feat-notifications`, merged `fa16d52` under the owner's written
pre-approval of 2026-10-16 (BACKLOG › Next head: "③ owner-polish 2 … Yes,
merge + deploy … Build directly"); the coordinating session confirmed the
turn and the go before the merge. The owner's words (owner-polish 2):
"프로필 정리 뭔가 알림 같은 것도 추가하면 좋겠어. 게시가 완료됐습니다 !
사용이 차감됐습니다 etc". The build log with the safest defaults chosen is
in `progress/RUN-2026-10-16.md` › NT. What was built:

- **Rows** (`notifications`, migration `c4e8a2d6f0b3`; `services/
  notifications.py`): kind, title, body, link (literal site paths plus
  ids or server slugs), `dedupe_key` unique per member, `read_at`.
  Written in the transaction of the event by `app_publish.publish`
  (`notify=False` for the example-app importer), the admin's review in
  `admin_quarters` (approval after the carry-over, with
  `allocation.budget_krw`), `milestones.claim` (flushed first so the
  two-tabs race keeps its graceful path), `app_publish.admin_unpublish`
  and `resolve_report`. `ensure_spend_summaries` reads `usage_events`
  for the last 7 KST days, skips days already summarised, writes one
  "spend" row per day (never today, never 0원), only while
  `spend_notifications` is on; `prune` deletes rows older than 90 days.
  `refresh()` (prune + summaries + commit) runs on both reads.
- **Routes** (`get_current_user`, spends nothing): `GET /api/
  notifications` (newest first, 50, with the unread count), `GET …/
  unread`, `POST …/{id}/read`, `POST …/read-all` (JSON `{}`); another
  member's row → 404. Guard-map rows and the write-exception list in
  `test_membership_access.py`.
- **Screens**: `NotificationBell` (badge, a portal panel: latest 8, 모두
  읽음, "Profile에서 전체 보기"; Esc / outside click; focus to the heading
  on open; a visually hidden "안 읽음" and the whole row's text as its
  name; count refreshed on mount, `visibilitychange`, every 60 s and on
  `ctrlai:notifications-changed` from elsewhere — events carry a
  `source`, sequence guards drop stale responses); `NotificationFeed` on
  Profile above the switches (now under 알림 설정), `#notifications`.
- **Tests**: backend `test_notifications.py` (12) + guard rows; frontend
  `notifications.test.tsx` (5); Playwright `notifications.spec.ts` (1),
  screenshots `progress/screens/notifications/`. Final after merging
  main: backend 1118, frontend 575, tsc/lint/build, Playwright 1/1.
- **Not built, on purpose**: no row for an admin's reply to 의견 (no
  reply feature exists; noted in product.md).

## app-fonts (2026-10-17)

- **app-fonts** — owner, 2026-10-17 (Builder: "글씨체가 안 고쳐졌어, 동글체
  사용" — the app only had system fonts; "이것저것 한글 폰트", "더 많은 한글
  폰트 올리게", "응 이거 진행"). A catalogue of 32 Korean OFL families
  (41 files, 11 MB) served by CTRL+AI under `/_ctrlai/fonts*`, loaded
  automatically when an app names one, listed by mood in the Builder
  prompts. CSP unchanged. Spec: architecture.md › Member app platform ›
  Fonts. Branch `feat-app-fonts`: tests pass, checked in real Chrome in a
  sandboxed frame; merged `a992e2b`, deployed 2026-10-17. After
  deploy: run `rewrite_app_runtime` so older apps get the link. Not
  included (later): members uploading their own font files; fonts in the
  `srcdoc` preview and in exported ZIPs.

## Backlog "Now" and Next pre-approvals, 2026-10-14 → 2026-10-16 (moved 2026-10-17)

Moved out of BACKLOG › Now and the head of BACKLOG › Next in the docs tidy-up of 2026-10-17, after the owner's queue finished (`a7190f8`). Text unchanged; every item they name has merged or is still listed in BACKLOG › Next.

### RUN-2026-10-14b (BACKLOG › Now, 2026-10-14 evening)

**Run of 2026-10-14 (evening) — "RUN-2026-10-14b"** — the owner's batch
after the morning deploys, with merge **and deploy** pre-approved one item
at a time for exactly cost-clarity, chat-plus-files, chat-plus-artifacts,
chat-thinking-view, builder-static-runtime, ctrlaiapps-publish,
example-apps, offsite-backups and monitoring, plus the `set_password` CLI
and the `signup-google-first` backlog entry (CLAUDE.md §12, "written owner
instruction"). **Add-on (owner, same evening):** fix-quarter-form-autofill
and feat-spend-feedback, also pre-approved to merge and deploy, done right
after cost-clarity. anonymous-feedback-board and builder-python: branch,
test, report, WAIT. The board is
[`progress/RUN-2026-10-14b.md`](progress-2026-10/RUN-2026-10-14b.md).

Owner answers recorded with this run (2026-10-14): the Google `.env`
change on the server was the owner's; no re-consent for existing accounts
(the only production account is the admin); sign-up stays as deployed for
the beta (`signup-google-first` is specced under *After the beta*);
members who forget a password ask the operator, who runs
`python -m app.db.set_password <아이디>` on the server
(`docs/deployment.md` §12); GitHub Pages, DNS and the sidebar footer are
the owner's, not this run's; **member apps are served from
`apps.ctrlai.my`** — no separate domain (CLAUDE.md §2).

**Reordered by the owner on 2026-10-14 (evening)**: money clarity first,
then the three Chat items, then the Builder runtime and the first slice
of CtrlAIApps with example apps, then backups and monitoring. Items 1–9
are pre-approved to merge and deploy one at a time (see **Now**).

### Pre-approvals of 2026-10-16 (BACKLOG › Next head)

**Pre-approval and order (owner, 2026-10-16 ~16:20 KST, in the desktop
session, before being away for a few hours).** The owner's words:
"keep 9 on hold … bring motions to 1st and app ai access next … if it is
different, add to third [Polish 2] … i am going to not have access to
this computer for the next few hours and i want you to run current +
1,2,3", and the owner's answers to two questions: **"Yes, merge + deploy"**
— each item may be merged and deployed once its code review + security
review are clean and all tests pass, one at a time, the desktop session
deploying and checking each; serious money/security findings stop and
wait for the owner — and **"Build directly"** — no plan step; follow the
specs, take the safest default on open questions and list them in the
report. **Scope, exactly:** the three running items (ui-improvements A,
ui-improvements B, auto-continue / polish 11), then **① motion-modern,
② app-ai-access, ③ owner-polish 2 (tidier Profile + notification list)**.
**dino-avatars stays on hold.** Not covered: the CtrlAITube poster branch
`fix-tube-poster` (waits for the owner), anything else in Next.

**Owner, 2026-10-16 (evening, desktop session), after checking
production.** Answers: auto-continue **"yes, ship it"** · poster
**"Yes"** (both merged 2026-10-16, `87f157f`, `4b0bbf6`) · and for the
batch below **"Yes, same rules"** — each item may be merged and deployed
once its code review + security review are clean and all tests pass, one
window at a time, the desktop session deploying and checking each;
serious money/security findings stop and wait for the owner. **Scope,
exactly:** ④ **owner-polish-3** (merged `03fb141`, deployed 2026-10-17 — Done row in the archive) (the four points below, one branch
`fix-owner-polish-3`), then ⑤ **motion-modern** (spec 8b, unchanged).
The owner's words, verbatim:

- "앱 썸네일이 겁나 이상해 그리고 들어갔다 나와야지 썸네일이 생김" →
  **(a) thumbnails**: capture the **whole app screen scaled down** into
  the 640×400 card (not the top-left crop); capture in the Builder
  **whenever a new version's 미리보기 has loaded** and at 게시 — not
  only on leaving a project; a one-time **"썸네일 만들기"** button in
  Admin › Apps that loads each app without a thumbnail in the admin's own
  browser, one at a time, and saves it (still client-side, no server
  renderer — that stays `thumbnail-render-worker`); a nicer coloured
  cover (app name + colour) instead of `</>` until one exists;
  **CtrlAIApps cards show the thumbnail too** (the published version's).
  A visitor's browser never uploads a thumbnail.
  **(a2) owner, same evening, verbatim:** "빌더일 때는 게시 전이니까
  미리보기가 없을 수도 잇잖아.. 그래서 빌더에서는 일단 게시 전까진 그냥
  화면 알맞게 크롭해서 보여주고 / 게시할때는 사용자가 고르고, 게시하면
  빌더 안에서도 게시랑 같은 썸네일" → before 게시 the Builder card shows
  the automatic, well-fitted capture; the **게시 dialog lets the creator
  choose**: 2–3 automatic candidates (첫 화면, scrolled, phone width) plus
  **「지금 화면으로」** (captures the 미리보기 as it is now); no choice →
  the first screen; no AI involved. Once published, **the chosen image is
  the thumbnail everywhere** (CtrlAIApps and the Builder card), and can be
  changed later from the app's settings.
- "환율은 그냥 자동 반영하면 안됨? 왜 굳이 여기다" → **(b) automatic
  exchange rate**: USD→KRW fetched once a day from a **free, keyless**
  public source (e.g. Frankfurter/ECB), behind a provider interface with
  a mock default (`FX_PROVIDER=mock|frankfurter`, in `.env.example`);
  a day-to-day jump over ~5% is not applied and shows a warning in
  Admin › System; the admin may still pin a fixed rate (an override
  switch); every change audited; only new charges use the new rate,
  wallets never move. If no scheduler exists, refresh when the stored
  rate is older than 24 h, never blocking or failing a charge (a failed
  fetch keeps the last rate). **No paid service** — stop and ask if one
  would be needed.
- "매번 쓸 때마다 알림 오면 너무 많잖아 그냥 승인됐습니다 반응을
  얻었습니다 그런 것만 알림" + "the notification number doesnt disappear
  when i open and close it. only when i press 읽었음. delete number
  bubble when opened" → **(c) notifications**: no more spending-summary
  notifications (지원금 N원 사용; existing ones hidden from the list);
  keep only approvals (신청 승인, 게시 완료), **반응을 얻었어요**
  (a reaction or comment on your app or video, grouped per item per day)
  and 신고 처리; **opening the list clears the number badge** (marks
  everything shown as seen).
- Added the same evening, verbatim: "오른쪽 알림 필요 없음 / 왼쪽 아래 알림
  있는 건 좋은데 그러니까 저게 저기에 다 안들어가잖아, 로그아웃을 옮기던지
  알림을 옮기던지 뭔가 구상을 해서 다른 웹사이트들 잘 분배해봐 / 그리고
  알림은 그닥 중요한게 아니라서 켜서 들어가서 볼 수는 있어도 굳이 기록을
  남겨둘 필요가 없어서 그럼. 걍 벨 누르면 숫자는 사라지고 clear 누르면
  알림 없애기" → **(c2)**: remove the 알림 card from Profile (and the
  "Profile에서 전체 보기" link) — the bell popover is the only place;
  bell opens → badge gone; a **지우기** button deletes the shown
  notifications (no history kept); **redesign the sidebar footer** the way
  common sites split it (e.g. the bell up beside the CTRL+AI header or in
  the account row, the account row opening a small menu with Profile,
  Usage, theme and 로그아웃, the footer left with 개인정보 · 약관) so the
  popover fits and nothing overlaps, at desktop and phone widths and in
  the collapsed rail. The 사용 알림 표시 / 띠링 settings stay on Profile.
- **(d)** the CtrlAIApps header still says "저장한 내용은 그 사람 기기에만
  남아요" — outdated since `ctrlai.db`; rewrite it to match what apps can
  do now. The owner, later the same evening: "별거 아니긴 한데 앱스토어에서
  ai 기능 관련해서 간단하게 설명있으면 좋겠는데 이젠 기기에만 남는게
  아니잖아" → two or three short lines, each true of the code (AI paid by
  the visitor, 데모 = no call, `ctrlai.db` on CTRL+AI across devices,
  `ctrlai.storage` on the device), with 자세히 → /help/apps.

## app-platform — Next entry and full spec (P1–P4b merged 2026-10-15 → 2026-10-16)

P1 `1a5059a`, P2 `1d9b997` (2026-10-15); P3 `739aacb`, P4a `d39d251`, P4b `77f816e` (2026-10-16). **P5 (`ctrlai.files`) is still open** — BACKLOG › Next. The Next entry as it stood:

1. **app-platform** · M3 · branches `feat-app-platform-p1` … `p5`
   "CTRL+AI 기능 상자" for member apps: a trusted shell around each app on
   apps.ctrlai.my, an SDK (storage, sign-in, AI paid by the visitor, a
   per-app database, files later). **Starts after H1, H2 and H4 of
   RUN-2026-10-15 are deployed.** P1–P4 pre-approved to merge and deploy
   one at a time; P5 branch + tests + WAIT. Supersedes H3 (app-ai-bridge).
   Spec below, saved verbatim. **P1 merged 2026-10-15** (shell, SDK,
   ctrlai.storage; RUN-2026-10-15). **P2 merged 2026-10-15** (sign-in, consent,
   ctrlai.user, ctrlai.ai, kill switch). **When P1 lands:** update the H4 templates
   (`services/project_handoff.py` README / CLAUDE.md, and the showcase
   apps' hand-written guides) to mention `ctrlai.storage` / the SDK, and
   that outside CTRL+AI those calls need replacing — done in P1.
   **P3 merged 2026-10-16** (`739aacb`; `ctrlai.db` — collections as
   (name, kind) pairs after the security review, migration `1cc00c092902`;
   its first drafts were lost with the old computer and it was designed
   again, RUN-2026-10-16). **P4 is built in two halves** (owner,
   2026-10-16): **P4a** = the owner-declared lists (`ctrlai.json`), the
   Builder prompts knowing the SDK, the four templates, the 미리보기's own
   label — **merged 2026-10-16** (`d39d251`, branch `feat-app-platform-p4`); **P4b** — **merged 2026-10-16** (`77f816e`, branch `feat-app-platform-p4b`; RUN-2026-10-16) — = the three showcase apps in LIVE mode (an in-app
   toggle, the demo logic kept; an expensive call shows its maximum
   beside the button first and has a per-call cap), Admin › Apps as a new
   section (Content keeps 신고 and 게시 내리기), `/help/apps`. Each merged
   and deployed after its own report and approval. Decided with the
   split: (a) the security review's stronger recommendation is **in**
   (collections are the owner's to declare — `ctrlai.json`, or the
   owner's first save; `ctrlai.json` is served with the app, it holds
   names only); (b) `app-libraries` (item 8) is reviewed after P4, so the
   templates use no library; (c) AI templates work as a demo when
   `window.ctrlai` is missing or the visitor is signed out — the basis of
   app-ai-access.

Added by the owner on 2026-10-15. Saved verbatim:

APP-PLATFORM — "CTRL+AI 기능 상자" for member apps (owner decisions 2026-10-15). Supersedes H3 (app-ai-bridge spec). Start after H1, H2, H4 are deployed.
PRE-APPROVAL: merge + deploy for P1, P2, P3, P4 below, one at a time, same PART E rules (backup → update.sh → verify → roll back + STOP on failure). P5 = branch + tests + WAIT. Never call the real Claude API in tests; never touch .env, DNS, cloud resources or repo settings.

OWNER DECISIONS (record in CLAUDE.md §2 "Member app platform" and docs/architecture.md):
1. Who pays for AI inside an app: the VISITOR, from their own 동아리 지원 wallet, through usage.charge() (feature "app_ai", with app project id). Visitor must be an active member this quarter (require_active_member). Creator-pays is a later option, not now.
2. Non-members / signed-out visitors: can open apps and read PUBLIC app data only. AI, writes, files, ctrlai.user → require sign-in; show "CTRL+AI 회원만 쓸 수 있어요" + 로그인 button.
3. Addresses stay path-based (apps.ctrlai.my/<slug>/) for the beta. Isolation comes from a trusted shell + sandboxed iframe (below), not subdomains. Per-app subdomains = later item `app-subdomains` in BACKLOG (note: may need DNS moved to a provider Caddy can do DNS-01 with).

ARCHITECTURE (P1)
- apps.ctrlai.my/<slug>/ now serves OUR trusted shell page (from the backend/static, not member files). The shell embeds the member app in an <iframe sandbox="allow-scripts allow-forms allow-popups allow-modals?"> WITHOUT allow-same-origin (opaque origin), loading the member files from apps.ctrlai.my/<slug>/_app/… served with `Content-Security-Policy: sandbox allow-scripts allow-forms …` as well (defence in depth), CSP default-src 'self', connect-src 'none' for member files, never Set-Cookie. Decide allow-modals: keep alert/confirm blocked (consistent with Builder).
- The member app talks only to the shell via postMessage through the SDK (/_ctrlai/sdk.js, served to the app). The shell accepts messages ONLY where event.source === its own iframe's contentWindow; it knows its slug from its own URL; it makes all API calls same-origin to apps.ctrlai.my/_ctrlai/* (Caddy → api router `app_runtime`), with an app-scoped HttpOnly cookie `ctrlai_app_<slug>` (Path=/_ctrlai/, SameSite=Strict, Secure, host-only) + a required custom header. Member code (opaque origin) can never send those cookies or reach /_ctrlai/* with credentials — add browser tests (Playwright on the built stack) proving: app A cannot call /_ctrlai with credentials; app A cannot impersonate B via postMessage to B's shell; a page opening B's shell in a popup cannot drive it.
- The main site's rules stay: ctrlai.my session cookie host-only, no CORS on the main API, JSON bodies only. The /_ctrlai/* routes are a separate router with their own guard and never accept the main session cookie.
- ctrlai.storage.get/set/remove: per-app, per-visitor key-value kept by the shell in the shell origin's localStorage under a slug-prefixed key (works signed-out; ≤ 1 MB per app). Migrate the existing example/showcase apps and the Builder generation guide from localStorage to ctrlai.storage. Existing published apps keep working (shim: inject a localStorage-like object into the sandbox via the SDK, best-effort, documented).
- Builder preview uses the same shell in a "미리보기" mode.

P2 — sign-in, consent, ctrlai.user, ctrlai.ai
- Sign-in: SDK ctrlai.login() → shell opens top-level ctrlai.my/apps/connect?app=<slug> → if signed in on ctrlai.my, a consent screen: app name, owner display name, what it may do ("Claude 사용 · 1회 약 N원 (최대 200원) · 내 지원금에서 차감", "이 앱에 데이터 저장"), [허용] [거절] → one-time code (60 s, single use) → back to apps.ctrlai.my/<slug>/_ctrlai/callback → shell exchanges it for the app cookie. Consent rows (user, project, scopes, granted_at, revoked_at) + audit. Profile › "연결된 앱" lists and revokes.
- ctrlai.user → { displayName, appUserId } (appUserId = stable per-app pseudonymous id; never email/username/balance).
- ctrlai.ai.ask({ prompt, system?, images?, json?: schema, model?: "fast"|"smart", maxTokens? }) and ctrlai.ai.stream(...) (chunks via postMessage). Server: admin-allowed models only (map fast→Haiku, smart→Sonnet via the catalogue), wallet pre-check, the 200원 per-call cap, a per-visitor daily cap for app AI (new chat_limits setting, default 2,000원/day, audited, 0 = off), per-app rate limit, json schema validation with one automatic retry, our short safety preamble before the app's system prompt, images ≤ 5 MB. Every call = one UsageEvent (user, quarter, provider, app project id) and appears on Usage as "앱 · <앱 이름> · N원" and in the spend toast.
- First AI use in an app shows the consent if not granted. Kill switch: Admin can disable the SDK for an app (immediate 403 with a Korean message in the app).

P3 — ctrlai.db
- Collections per app, two kinds: "private" (each signed-in visitor sees only their own items) and "shared" (everyone can read, signed-in members can write). Items JSON ≤ 4 KB, per app ≤ 5 MB / 2,000 items, per visitor ≤ 30 writes/min. Owner of an item can update/delete it; app owner can delete any shared item; admin can hide/delete. Report button helper in the SDK (ctrlai.db.report) → admin queue. Public read for signed-out visitors on shared collections only.
- Queries: list(collection, { where: simple equality, orderBy: createdAt|field, limit ≤ 100, cursor }), get, save, update, remove, count. No raw SQL, no cross-app access, every query filters deleted projects/apps (CLAUDE.md §10 deleted_at rule).
- Alembic migration; tests for isolation between apps and between visitors, quotas, deleted app → 404.

P4 — make it usable
- Builder's generation/editing prompt knows the SDK (short reference + examples) and uses it when an idea needs AI, shared data or "who is this"; the Builder start screen offers 4 templates: AI 챗봇, 투표·설문, 랭킹 게임, 동아리 게시판 (each small, distinct look, uses the SDK correctly).
- Switch the 3 showcase apps (H2) to LIVE mode when the visitor is signed in (receipt image → ctrlai.ai with JSON schema; itinerary JSON with schema + retry, still restricted to the seeded places; document Q&A = in-browser BM25 → ctrlai.ai answer with sources, "문서에서 찾을 수 없어요" when unsupported), with a toggle back to 데모 데이터. Keep their honest badges ("실제 AI · 1회 약 N원" vs "데모").
- Builder preview: SDK works for the creator as the visitor (charged to the creator, labelled "미리보기 사용 · 내 지원금").
- Admin › Apps (unhide the Content section or add one, defined in sections.ts): per app — owner, published version, AI calls / won today and this quarter, consents, data size, reports; buttons: SDK 정지/재개, 공유 데이터 숨기기. All audited.
- docs/product.md "앱 기능 상자" for members (Korean, plain) + a member-facing help page /help/apps with SDK examples.

P5 — ctrlai.files (branch + WAIT): images/files per app on the VM disk with caps (5 MB each, 100 MB per app, 2 GB total setting), served from apps.ctrlai.my/<slug>/_files/… with nosniff and safe content types; plan for Cloud Storage later.

Everything Korean for members, light/dark, 390px. Progress in docs/archive/progress-2026-10/RUN-2026-10-15.md with "now on". Final report in Korean: per phase commit + backup, what I must test (with exact steps and test sentences), known risks, and the branch you are on.

## motion-modern — full spec (merged 2026-10-17)

Merged `f1bdb99` (Done row in [`done.md`](done.md)). BACKLOG › Next entry 8b as it stood:

8b. **motion-modern** · M1 · branch `feat-motion-modern`
    *Not pre-approved — branch, test, report, WAIT.* Owner, 2026-10-16
    ("motion ui를 개선할 수 있는 방법? 뭔가 더 현대적인 느낌으로…
    미리보기 생성 같은거 할때 약간 중간부터 좀 생략해도 될 것 같아…
    생성 중 뭔가 오로라 같은거, 답변 생성도 그럼"), after a demo page
    the owner approved (the demo lives in the owner's desktop session;
    refs looked at: motionsites.ai, prompt-motion.com). Final choices:
    (1) **aurora card instead of streaming code** — while a Chat reply
    writes a preview's code (or the Builder writes files) show
    "미리보기 만드는 중…" over a slow aurora gradient with a timer and
    the running cost and 2–3 step chips; when done the aurora melts into
    the preview; the code stays under a folded "코드 보기";
    (2) **thinking → calm stream** — "생각하는 중…" with a shimmer and
    seconds, a slowly rotating colour ring around the composer while
    busy, words fade/unblur in, a glowing caret;
    (3) **Builder collapsed steps** — only the current step big
    ("index.html 작성 중… N초"), finished steps fold into "✓ N개 완료"
    (pop), the rest as dots, a progress bar, spinner not 🚫 (overlaps
    polish 14 — extend it);
    (4) **띠링 = 별가루** — small twinkling stars (pale gold/white) flow
    from the price into the wallet, a few twinkle there, the number rolls
    down, the toast pops (replaces the current toast motion; sound stays
    the Profile switch);
    (5) **게시 완료 = 쭈욱 → 팡! + 색종이** — thin glowing lines shoot up and
    burst into rays with a white flash (calm colours: white, warm gold, a
    touch of lavender), confetti from the centre, "게시 완료!" letters pop.
    **No dino** in the motion (owner: "쟤만 너무 픽셀레이트 되어있어서").
    Everything off with 동작 줄이기 (text stays); no click waits on an
    animation; CSS + motion/react + Web Animations only, no paid service.

## owner-polish-2026-10-16 — Next entry and the owner's words (all but point 12 merged 2026-10-16)

Points 1, 3, 6, 8, 9, 10, 13, 14 merged as owner-polish-a (`806f563`); 4, 5, 15 and the first half of 2 with ui-improvements-a; 2's list as feat-notifications (`fa16d52`); 7 as promo-videos; 11 as auto-continue (`87f157f`). **Point 12 (image provider research) stays in BACKLOG**, with the nested-`<Link>` note. The Next entry as it stood:

5. **owner-polish-2026-10-16** · M1 · one small branch per point
    *Not pre-approved — branch, test, report, WAIT.* **Points 3, 8, 1, 9,
    6, 13, 14, 10 merged as `806f563`** (owner-polish-a, owner approved
    2026-10-16 — Done row and the eight points' spec in the archive; the
    deploy runs migration `d7e1f3a9b5c2`). **Points 4·5 (thumbnails)
    and 15 (app detail) merged with ui-improvements-a (2026-10-16),
    together with the first half of 2 — Profile's 알림 as two switch rows
    and 내가 만든 앱 as a plain list.** **2's notification list: merged 2026-10-16 as `fa16d52`
    (`feat-notifications`, the owner's written pre-approval of ③
    owner-polish 2 above; Done row and delivery notes in the archive;
    migration `c4e8a2d6f0b3`).** Left in this item:
    7 (promo video → now `promo-videos`), 11 (continue past the cap —
    `feat-auto-continue`, built, waiting on the owner), 12 (image provider
    research). Small note (app-ai-access, 2026-10-16, not fixed yet):
    Admin › Apps draws a `<Link>` inside the row's `rowHref` link
    (`AdminTable` + the name column), so dev mode logs one "<a> cannot
    be a descendant of <a>" hydration warning — make the name column
    plain text there. The owner's nine
    points from a walk through production (2026-10-16), to start **only
    after the work in progress is done** ("지금 하는 작업 전부 완료 후에").
    Spec below ("owner-polish-2026-10-16"), with what the screenshots
    showed. Two are bugs (3, 8).
    **10 (added 2026-10-16, chat screenshot):** "모션 추가하고 싶다고 한게 …
    뭐 쓰면 그렇게 바로 바로 알림이 안 뜨는 것 같은데..? 약간 모션그래픽
    띠링 이런식으로 하고 싶었던거" — spend-feedback v2. Today
    (feat-spend-feedback) the toast appears only after a reply *finishes*,
    slides in softly (opacity + 10px), and the countdown sits in the
    sidebar's wallet card — which the expanded Admin menu pushes out of
    view. Wanted: a livelier "띠링" moment — a pop/bounce with a coin or
    sparkle, the "-N원" flying to the balance, maybe a short chime (off by
    default or a Profile switch; browsers allow sound only after a click),
    visible wherever the wallet card is. Still only on real `charged_krw`;
    reduced motion keeps a plain toast.

### The owner's words and what production showed (points 1–11, 13–15)

**Merged 2026-10-16 (owner-polish-a, `806f563`): points 1, 3, 6, 8, 9, 10,
13, 14** — kept here because the remaining points refer to them; their
delivery notes are in `archive/done-specs.md`.

Added by the owner on 2026-10-16 with screenshots of ctrlai.my (Chat,
Project Builder, Video Generator, CtrlAIApps, CtrlAITube, Admin ›
Dashboard / Members / System, Profile): "이것도 일단 백로그에만 추가 —
지금 하는 작업 전부 완료 후에." Saved as written, each with a note:

1. **"초대코드 수용인원 늘릴 수 있게"** — Admin › Members › 초대 코드: an
   existing code's 최대 가입 수 can be raised later (today it is set only
   at creation; the one code is 소진 1/1). Audited; never below the uses
   already made.
2. **"프로필 정리 뭔가 알림 같은 것도 추가하면 좋겠어. 게시가
   완료됐습니다 ! 사용이 차감됐습니다 etc"** — a tidier Profile and a
   member-facing notification list (게시 완료, 지원금 차감, 신청 승인, …).
   Today only the passing spend toast exists (feat-spend-feedback).
   *(First half — Profile's 알림 switch rows and the plain 내가 만든 앱
   list — merged with ui-improvements-a; the list itself merged as
   `feat-notifications` `fa16d52`, 2026-10-16.)*
3. **"내가 만든 앱은 프로필에 안 뜸"** — bug: Profile › 내가 만든 앱 says
   "준비 중 · 아직 게시한 앱이 없어요" while the admin's 여행 일정 메이커 and
   the showcases are published. Read the member's published apps there.
4. **"게시할때 프로젝트 읽어서 압축해서 썸네일 만드는 기능"** *(merged
   2026-10-16, ui-improvements-a: a capture in the maker's browser,
   re-encoded on the server)* — a
   thumbnail made at 게시 (render the published version, store a small
   image) for CtrlAIApps cards and the Builder list. Rendering must not
   run member code on the backend (CLAUDE.md §8, §10) — e.g. a headless
   browser in an isolated container, or a capture in the creator's
   browser at publish time.
5. **"draft도 저렇게 뭔가 썸네일 비슷하게"** *(merged 2026-10-16,
   ui-improvements-a)* — Builder project cards show
   a striped "미리보기 썸네일" placeholder today; drafts get a thumbnail too
   (same mechanism as 4, from the working copy).
6. **"영상은 다음다음분기에 시작할거임.. 그래서 일단 전체 화면에 락
   걸어두면 될 것 같아. 안보이게. 연결은 미리 해두러다로 이번 분기에는
   추가 안할거임"** — Video Generator starts two quarters from now: lock
   the whole Video area for members this quarter (hidden or a locked
   screen, behind a switch the 관리자 controls); keep the provider wiring;
   no new video work this quarter.
7. **"AITube는 홍보 영상 하나 있거든 그거 추가로 해서 지금 영상은
   준비단계이지만 홍보영상에는 댓글 달 수 있게 할 있기"** — CtrlAITube:
   add the club's one promo video (the owner supplies the URL); the page
   stays 준비 중, but the promo video takes real comments. The three
   current cards are sample data.
8. **"미신청에 유저가 왜 안뜨지"** — bug: Admin › Members shows **미신청
   1명** on the card, but filtering 참여 = 미참여 lists nobody (0개 / 전체
   2개) while both listed members are 활동 회원. Find which account the
   card counts (perhaps one the list hides) and make card and filter agree.
9. **"이름도 변경 가능하게? 아이디는 못바꾸지만 비번이랑 이름은 바꿀 수
   있게.. 가능하면 프사도 ? 사실 크게필요없긴 해"** — Profile › 계정 설정:
   display name editable (아이디 fixed); password change exists already
   (로그인 방법 › 바꾸기); a profile picture optional, low priority.

(Point 10, a livelier "띠링" spend notification, is in the Next entry
above.)

13. **Builder › Claude 판 — a project that has only imported versions
    shows the same content twice** (owner, 2026-10-16): when every version
    came from 예시 앱 / 가져오기 (no `BuilderGeneration` behind it), the
    conversation-style history (Q3) and the compact "모든 버전 (n)" list
    below it show the same rows. Show one or the other for such projects
    — e.g. hide the history until the first Claude-made version, or fold
    "모든 버전" when it would repeat the history.

15. **CtrlAIApps 앱 상세 — "뭔가 너무 화면이 비효율적"** (owner,
    2026-10-16, screenshot of '동아리 게시판' v5, relayed from another
    session). *(Merged 2026-10-16, ui-improvements-a — built as proposed.)* What the screenshot showed: the top half of the detail screen
    is a colour-gradient placeholder block repeating the app's name; the
    live app frame sits below it and needs a scroll; 앱 실행 duplicates the
    frame right under it. Proposal: a one-line head (small thumbnail or
    icon · name · maker · vN · description folded/unfolded · 새 창에서 열기 ·
    신고), the app frame taking most of the first screen (nearly the
    desktop height, visible at once at 390px), long descriptions below;
    once thumbnails exist (points 4–5) use them small in the list cards and
    the head and drop the big placeholder block. Also make the screen's
    honest note per app: when the app's `ctrlai.json` declares a shared
    list, say "이 앱의 공유 글은 다른 회원도 볼 수 있어요"; otherwise the
    plain sentence (P4b already replaced the pre-P3 wording with a general
    one that mentions login, AI and shared lists).

11. **Built 2026-10-16 as `feat-auto-continue`** (owner's later direction,
    relayed: no question first — continue automatically to the end, 중지
    always available, "이어서 쓰는 중… 지금까지 N원", one charge per call
    with the wallet checked each time, one 전체 한도 per depth in Admin ›
    System, the pieces joined so the preview opens; see
    `progress/RUN-2026-10-16.md` › AC). Original words: **"뭔가 한번 끊기면 비용 예측해서 ex 진짜 많이 쓰일 수도 있는데
    가겠냐고 물어보고 그냥 쭉 할 수 있게 (중단도 가능하니)"** (2026-10-16,
    after a 강아지 SVG on Opus · 보통 stopped twice at the 200원 cap) —
    when a reply stops at max_tokens or the per-reply cap, show the
    estimated cost to finish ("끝까지 쓰면 약 N원 · 최대 M원") and one
    question; on yes, continue **in one go** to the end with 중지 always
    available, charging the actual usage per call (each call still behind
    the wallet pre-check; a ceiling for the whole run that the member
    sees). Also: (a) the system prompt must not promise to "finish in one
    go" or restart from scratch at the cap — continue where it stopped, or
    suggest a cheaper model / higher depth; (b) the preview joins a code
    block split across 이어서 쓰기 replies.
14. **"만드는중인데..? 이러면 🚫 커서에 이렇게만 뜸. 뭔가 생각을 하고
    있다는 UI를 만들었음 좋겠어. 채팅도 그럼.. 뭔가 도로록..."**
    (2026-10-16, screenshot of /builder/12 during 고치기) — a "working"
    UI with motion. Today: the disabled 고치기 button shows the browser's
    🚫 not-allowed cursor; the plan card's step circles stay empty until a
    whole file is done (20–60 s of nothing moving); Chat shows only "•••".
    Wanted: Builder — the button becomes "만드는 중…" with a spinner and
    `cursor: progress` (never 🚫), the current step's circle spins and the
    row says "index.html 작성 중…" with an elapsed timer, finished steps
    tick ✓ with a small pop, a thin progress bar (n / m 파일), and if
    feasible the file text streaming in a small "도로록" typing view
    (needs the run stream to send text deltas, not only file_start/done).
    Chat — "생각하는 중…" with a shimmer and elapsed seconds until the
    first words, then text that flows in smoothly with a caret at the end.
    Reduced motion: no animation, the text and timer stay. Pairs with
    point 10 (the 띠링 spend moment).

## thumbnail-render-worker — full spec (merged 2026-10-17, live 2026-10-17)

Merged `7599a1f`; switched on after four fixes (`ad1c75c`, `7def1ae`, `29a42f7`, `642e73c`) — live on the fourth attempt (`progress/RUN-2026-10-16.md` › TRW-ON). Was BACKLOG › After the beta:

**Scheduled and pre-approved (owner, 2026-10-17, verbatim):** "서버에서 진짜
브라우저로 썸네일 찍는 것(thumbnail-render-worker) 만들어줘. 격리 조건 그대로,
리뷰 깨끗하고 테스트 통과하면 merge + 배포까지 해도 돼." — branch
`feat-thumbnail-render-worker`. The isolation conditions the owner accepted:
a separate container (never the api/db network; the browser reaches only
`apps.ctrlai.my`, every other host refused), 768 MB / 1 CPU caps, one job at
a time, ≤ 20 s per picture, read-only filesystem, non-root, no new paid
resource (fits the e2-medium: ~2.8 GB free). The in-browser capture stays
as the fallback when the worker is off or fails.

*(Original note:)* ui-improvements-a (2026-10-16) takes an app's
thumbnail in the **maker's browser** (SDK capture → server re-encode),
which cannot draw an app's own image files, WebGL, or much of anything in
Safari — such cards keep their coloured cover. When that is not enough:
a headless browser in an **isolated container** on the server (no
network, CPU/memory/time limits, one job per published version, never
the main backend — CLAUDE.md §8·§10) renders the published address and
stores the same 640×400 WebP through `services/thumbnails`. Costs a
container image and memory on the VM; decide after seeing how many
real apps come out blank.

## UI requests built 2026-10-16 → 2026-10-17 — full specs

Moved out of BACKLOG › UI requests on 2026-10-17. Merges: chat-pins `d224240`; app-tab-icon `94c0110` (later replaced by the shared 「앱」 icon, `9d4e309`); chat-list-collapse `8226ab2`; builder-snapshots `0e35bef`; builder-images, draft-server-thumbnails, ctrlaiapps-reactions, ai-switch-wording as `feat-batch-1017` `bea1b6e`; running-state-calm, chat-preview-fullscreen, spend-toast-compact as `feat-batch-calm` `261cc87`; thumbnail-choice, builder-first-build-running, publish-done-popup (A) as `feat-batch-thumbs-popup` `b3f5ce1`; background-runs `33fc533`; chat-to-builder-carry `e533b1d`. Text unchanged, in the order it stood.

- **builder-first-build-running** — owner, 2026-10-17, looking at a first
  build on production ("처음 build할때도 ui 적용이 되니" — then "아직
  배포전인데 저것도 적용이 될까 해서 채팅 창만 한 것 같아", "둘다 목업
  만들어"). Follow-up to `running-state-calm`: the new running look
  (`BuilderRunPanel`) is drawn inside `PreviewPane`, which exists only
  once a project has files (`!empty`); a **first build** has none, so the
  centre shows the older `PlanCard` (만들 계획, `0 / 5 파일` bar, step
  list, `남은 파일 N개`) and the right Claude panel stays empty — no
  stage list, big timer, top sweep, file chips or narrated log.
  **Direction:** keep the 만들 계획 (the member approved it; it is also
  the honest progress per file) and, while it runs, put the same stage
  list (계획 확인 → 파일 쓰기 → 점검), large elapsed timer, header sweep and
  faint aurora above it; fold the `0 / 5` bar into that header; the left
  file list fills in as files finish (today "아직 파일이 없어요" until the
  end); the Claude panel narrates the same events as for later builds;
  the live code tail is optional here (the plan already lists purposes).
  Same stages, same wording and same reduced-motion rules as the other
  builds — one component, two hosts. Open point: the stage events already
  exist for plan/file/check (`Progress`, `generation.files_done`), so
  frontend only unless the first-build run lacks the per-file events.
  Mock-up:
  [`ui-requests/builder-first-build-running.html`](ui-requests-2026-10/builder-first-build-running.html).
  Not scheduled.
  **Bundled and pre-approved** (owner, 2026-10-17, verbatim:
  "builder-first-build-running이랑 publish-done-popup(A)도 썸네일 지정이랑 한
  묶음으로, 같은 규칙으로 해줘") — one batch with thumbnail-choice, after
  fix-draft-thumbs.
- **publish-done-popup** — owner, 2026-10-17: "게시완료 하면 그냥 원래
  사이트 배경에 흰글씨랑 컨페티 되거든 뭔가 복잡하단 말이지 차라리 그
  toasting 처럼 팝업되는 그런걸 하는게 어떨까". Today
  (`PublishCelebration.tsx`, `motion-modern` (5)) 게시 완료 covers the
  whole screen for 1.9 s with light beams, a flash, confetti and white
  "게시 완료!" letters. **Proposal (two shapes were mocked; A chosen):** (A) a **popup card** in the toast style, bottom right
  (top on phones): a check that pops with a few confetti pieces bursting
  *around the check only*, "게시했어요", the app name · CtrlAIApps, and two
  buttons — 열어 보기 (the app's address) and 링크 복사 — kept ~6 s because
  it has buttons, closable, never covering the composer or taking focus;
  (B) a one-line pill like the spend pill, ~3.5 s, tapping it opens
  CtrlAIApps. Either way: no full-screen layer, no beams or flash; the
  persistent notification row (`NotificationBell`) stays; reduced motion
  keeps the card/pill without the confetti; the live-region line says
  "게시했어요" once. Touches `PublishCelebration.tsx`,
  `celebration.module.css`, the `celebrating` state in
  `BuilderWorkspace.tsx`, its test. Frontend only. Small. Mock-up:
  [`ui-requests/publish-done-popup.html`](ui-requests-2026-10/publish-done-popup.html)
  (현재 · A · B side by side). **Owner picked A (2026-10-17: "게시 완료
  팝업을 A로")** — B is dropped. Not scheduled.
  **Bundled and pre-approved** (owner, 2026-10-17, verbatim:
  "builder-first-build-running이랑 publish-done-popup(A)도 썸네일 지정이랑 한
  묶음으로, 같은 규칙으로 해줘") — one batch with thumbnail-choice, after
  fix-draft-thumbs.
- **spend-toast-compact** — owner, 2026-10-17 (desktop session, with a
  screenshot of the 썼어요 toast: "알림이 조금 너무 큰 것 같아 … 줄이던가
  하는 거 있어?"), then picked **"A가 좋은데"** and **"지갑 쪽에서만
  반짝이게 줄임 이거까지 해서 백로그"**. Today
  (`SpendFeedbackProvider.tsx` + `spend-feedback.module.css`) the toast is a
  card — a 2.1rem coin, a 1.15rem bold `-156원`, a sentence, a label line —
  up to 22rem wide, sitting just above the composer at the bottom right,
  for 3 s, while stars fly from it to the sidebar wallet; the same amount
  also shows as `-156원` by the wallet and as `합계 156원` under the reply.
  **Change (the owner's pick, A + stars only at the wallet):**
  1. **One-line pill** instead of the card: `−156원 · 68,336원 남음`
     (merged charges: `−36원 (3번) · 68,336원 남음`) — no coin, no label
     line, no big amount. What it was for ("채팅 · Sonnet") moves to the
     pill's `title` and the screen-reader line (`toastText` keeps the full
     sentence, so assistive tech is unchanged). `toastMainText` is the one
     place that builds the wording.
  2. **2 s, not 3** (`TOAST_MS` 3000 → 2000); `MERGE_WINDOW_MS` stays 3000
     so charges that arrive together still merge. Still opens Usage on
     click; still takes no focus and never covers the composer (centred
     just above it, or the same corner but lower — settle at build).
  3. **Stars only at the wallet**: no more stars flying from the toast
     (`planFlight` and `Flight.from` go away); when the sidebar balance is
     on screen the 4 twinkles (`TWINKLE_COUNT`) play on the wallet, with the
     existing count-down, `-N원` rise and pulse. When the wallet is not
     visible (collapsed sidebar, phone) there is nothing to twinkle — the
     pill alone says it.
  4. **Small charges stay quiet**: under 10원 no pill at all — only the
     wallet count-down, the `-N원` rise and the twinkles (Profile › 알림 ›
     사용 알림 표시 off still hides everything but the number; reduced
     motion still drops the twinkles and the count-down and keeps the pill).
  5. **Unchanged**: milestone cards (첫 사용, 25 / 50 / 75 %, 잔액
     10,000원 이하, 잔액 0) keep their size — rare and they matter; the
     sound switch; the backend (`charged_krw` is still the only source).
  Touches: `SpendFeedbackProvider.tsx`, `spend-feedback.module.css`,
  `frontend/__tests__/spend-feedback.test.tsx` (the toast text, the 3 s →
  2 s timing, the no-flight rule, the under-10원 rule), and the "spend
  moment" paragraph in `docs/product.md`. Frontend only, no money logic, no
  migration. Small. Mock-up:
  [`ui-requests/spend-toast-compact.html`](ui-requests-2026-10/spend-toast-compact.html)
  (현재 vs 제안 switch). Not scheduled; best built with `running-state-calm`
  since both retune the shared motion.
  **Scheduled and pre-approved** (owner, 2026-10-17, verbatim:
  "spend-toast-compact(시안 A 그대로)도 running-state-calm이랑 같이, 같은 규칙으로
  해줘") — on the same branch as running-state-calm and chat-preview-fullscreen.
- **running-state-calm** — owner, 2026-10-17 (desktop session, after
  mock-ups the owner approved: "오 좋음 빌더도 만들어줘" → "응 좋다, 그거까지
  백로그로 보내"). Follow-up to `motion-modern` (8b, merged): while Chat
  writes a reply or the Builder builds, the motion is either too loud or too
  quiet. Chat: "갑자기 돌리면 아래가 저렇게 되는데 너무 튄다 … 이것도
  돌아가는게 보였으면" — the composer turns into a bright full-width pill
  and the 그림 만드는 중 card has a loud green aurora. Builder: "build가
  꽤나 걸리는데 … 모션이 너무 subtle" — only a `미리보기 만드는 중… 61초`
  line and file chips, so a long build looks stuck; and "옆에 채팅에도
  돌아가고 있다는게 잘 보였으면". Owner on the aurora: "꼭 있어야하는건
  아닌데 … 최적의 디자인". **Direction (mock-ups seen and approved):** one
  shared running-state look for Chat and Builder, calm by default:
  1. **Composer keeps its normal dark surface** while busy (no bright fill,
     no rainbow ring); only a thin 2px bar sweeps along its bottom edge. The
     stop button becomes a small outlined square, with one line under it:
     "중지하면 지금까지 쓴 만큼만 차감돼요". Builder's `만드는 중…` button
     is an outlined violet button with a small spinner, not solid blue.
  2. **Same signal in four places**: a 2px sweeping bar on the card / header
     top, a pulsing dot (+ `작업 중` chip) on the project/conversation row in
     the sidebar and list, the Chat/Builder header chip, and the card itself —
     so a running job is visible from any screen.
  3. **Progress is shown, not implied**: a stage list (Builder: 요구사항
     읽기 → 파일 쓰기 → 미리보기 조립; Chat card: 뼈대 → 스타일 → 동작,
     `✓` when done, the current one spinning/underlined), a large elapsed
     timer, file chips that go `쓰는 중` → `완료`, a short live code
     window (the last ~7 lines, caret blinking), and in Chat a flowchart
     skeleton whose boxes appear and lines draw in; cost reads
     `12초 · 지금까지 약 56원` and keeps counting.
  4. **Builder chat panel mirrors the preview**: same elapsed time in its
     header, the Claude bubble shows the current action ("파일을 쓰고
     있어요…" + three-dot pulse) and a rolling activity log of the last four
     events (`✓ index.html 완료`, `› style.css 쓰는 중`); the input says
     "작업이 끝나면 이어서 말해요". Preview and chat always show the same
     stage.
  5. **Aurora stays, but small and optional**: removed from the composer and
     the full card; kept only as a very faint, slow glow *inside* the
     그림 card (Chat) and the 미리보기 pane (Builder); a Profile switch
     "오로라 배경" turns it off (default on; reduced-motion also turns it
     off). Everything else keeps moving without it.
  Open points: (a) the stages must follow **real progress** — the stream
  needs per-file / per-stage events (does the Builder run already emit
  one per written file? Chat's 뼈대/스타일/동작 steps are guessed from the
  streamed code today); where the backend gives none, show an honest
  indeterminate bar plus elapsed time, never a fake percentage; (b) the
  sidebar dot needs the "running" state to survive navigation (it is
  client-only now); (c) honour `prefers-reduced-motion` (sweeps and
  typing stop, dots stay static). Mock-ups (open in a browser):
  [`ui-requests/running-state-calm-chat.html`](ui-requests-2026-10/running-state-calm-chat.html)
  and [`running-state-calm-builder.html`](ui-requests-2026-10/running-state-calm-builder.html),
  both with the aurora switch.
  **Scheduled and pre-approved** (owner, 2026-10-17, verbatim:
  "running-state-calm(시안 그대로)이랑 chat-preview-fullscreen 지금 배포 끝나면
  다음으로, 같은 규칙으로 해줘") — after the feat-batch-1017 deploy; review clean
  + tests pass → merge + deploy.
- **chat-preview-fullscreen** — owner, 2026-10-17 (desktop session, with a
  screenshot of a Chat 미리보기 card): "지금 미리보기로 뭘 생성하면,
  전체화면으로 보기? 이런게 없음 … 빌더로하기만 있고". A Chat reply's
  미리보기 card (`ArtifactPreview.tsx`: 코드 보기 · 다운로드 · Builder로
  보내기, then 미리보기 열기) shows the page only inside the narrow card;
  the only way to see it bigger is to send it to the Builder, which makes a
  project and costs a step. Add a **전체 화면** button beside 코드 보기 /
  다운로드 that opens the same preview large. Shape to settle when built:
  (1) an **in-page overlay** (almost full window, dark backdrop, 닫기 and
  Esc) rather than the browser's Fullscreen API — the frame is
  `sandbox="allow-scripts"` only and must stay so (no `allow-fullscreen`);
  (2) the overlay should carry the frame **already running** if it can
  (moving an iframe reloads it and restarts the page), otherwise open a
  second frame from the same `srcdoc` and say nothing about it — the
  runaway-loop rule stands: it starts only after the member pressed 미리보기
  열기 or 전체 화면, and closing it removes the frame; (3) a 새로고침 button
  and a phone / desktop width switch in the overlay header, like the
  Builder's 미리보기, which already has an expand icon to match; (4) works
  on touch (full-screen sheet at phone width). No money, no backend. Small. Mock-up:
  [`ui-requests/chat-preview-fullscreen.html`](ui-requests-2026-10/chat-preview-fullscreen.html).
  Not scheduled.
- **builder-snapshots** — owner, 2026-10-17: "하나 누를때마다 버전 올라가서
  좀 부담스러움", then "이것저것 하고 이걸 버전으로 저장 하고 스냅샷
  만들기? 그렇게 하자 괜찮을 것 같아" and "그냥 나가기하면 … 이 버전을
  저장할까요? 를 물어보는..?". Today every file change is a version
  (`builder_versions.snapshot`), **되돌리기 included** ("v5로 되돌리기" is a
  new version), and only the newest 30 are kept (pinned and the published
  one excepted) — so a few 되돌리기 clicks push useful old versions out.
  Direction: versions become **saved snapshots** the member makes (버전
  저장, with a name), not a by-product of each edit; leaving the Builder
  with unsaved changes asks "이 버전을 저장할까요?" (저장 / 저장 안 함 /
  취소); 되돌리기 to a snapshot changes the working copy only and adds no
  version. Open points to settle before building: (1) Claude's own edits
  cost money and need an undo — keep a short automatic rolling history
  (e.g. the last few steps, not counted in the 30) besides the named
  snapshots; (2) 게시 must snapshot automatically (`published_version_id`
  needs a row); (3) what happens to the existing numbered versions (keep
  them as snapshots). **Settled by the owner (2026-10-17):** versions are
  saved snapshots (v1 → 작업1, 작업2 → 저장 → v2); between snapshots only
  작업-step undo/redo; loading an old snapshot (v1) changes the working copy
  only, and if there is unsaved work first asks "저장 안 한 작업이 있어요.
  저장할까요?"; saving after that is simply **v3** (no branch numbers).
  **Scheduled** (owner, 2026-10-17: "지금 main run 뭐 돌리고 있어서 그거
  끝나고 돌리고 코드체크 배포까지") — starts only after the run now in
  progress on main has finished; then build on `feat-builder-snapshots`,
  code check (review) and tests, then merge + deploy under the same rules
  as the other pre-approved items (review clean + tests pass; backup →
  update.sh → verify → roll back + STOP on failure).
  **Built on `feat-builder-snapshots` (2026-10-17); merged 2026-10-17 under
  the scheduled pre-approval above (coordinator: full suites green on main):** `builder_project_steps` + migration `c5a8e1f3b7d9` (existing
  versions untouched), 20 undo steps outside the 30 versions, routes
  `POST …/versions` (버전 저장), `GET …/steps`, `POST …/steps/{seq}/restore`;
  불러오기 makes no version; 게시 saves the working copy first. Settled
  while building: the 업데이트 메모's "what changed" now reads the Claude
  runs since 게시 (not versions); the 게시 dialog's pre-filled text is kept
  only on a saved version (unsaved work asks again each open); a
  versionless project's "처음 상태" is now a step, not a v1. Not done
  (later): the ZIP of unsaved work is still named after the newest version;
  the browser's back button is not intercepted (only links and closing the
  tab).
- **app-tab-icon** — owner, 2026-10-17: "게시된 앱 열면 탭 썸넬 뭔가 같은건데
  앱? 으로 바꾸기". A published app opened on `apps.ctrlai.my/<slug>/` shows
  the browser's blank globe in its tab; give the shell page a favicon — the
  app's own cover (its colour + first letter, the same as the CtrlAIApps
  cover), drawn as an SVG data URL by the shell, so every app gets one
  without the member doing anything. Small.
  **Scheduled and pre-approved** (owner, 2026-10-17, verbatim: "app-tab-icon이랑 chat-list-collapse도 서버 썸네일 다음에 같은 규칙으로 (리뷰 깨끗 + 테스트 통과하면 merge + 배포) 해줘") — after thumbnail-render-worker, one at a time.
- **chat-list-collapse** — owner, 2026-10-17: "대화목록도 숨기기 기능 아니면
  줄이기? 모름". The Chat conversation list (새 대화 + 최근 대화) can be folded
  away like the main sidebar (a « button, remembered per browser), giving
  the conversation the full width; folded, a slim rail keeps 새 대화 and
  an open-list button. Phone width already hides it. Small.
  **Scheduled and pre-approved** (owner, 2026-10-17, verbatim: "app-tab-icon이랑 chat-list-collapse도 서버 썸네일 다음에 같은 규칙으로 (리뷰 깨끗 + 테스트 통과하면 merge + 배포) 해줘") — after thumbnail-render-worker, one at a time.
- **builder-images** — owner, 2026-10-17: "빌더 에는 사진 추가 못하나..? 이런
  디자인 참고 등으로". Two uses: (1) **reference** — attach up to ~3 images to
  a 만들기 / 고치기 request (📎 or paste); Claude sees them (vision input),
  the images are not put into the app; ~5–10원 more per image, included in
  the estimate; the upload path of chat-plus-files (bytes checked,
  re-encoded, metadata gone). (2) **assets** — an image saved as an app file
  (e.g. `logo.png`) the app shows; storage only, app size limits, export
  ZIP and thumbnails follow. (1) first. **Scheduled** (owner, 2026-10-17:
  "지금 작업 이후에") — (1) after builder-snapshots; branch, tests, review,
  then the owner's go before merge (no pre-approval given for this one).
  Owner, later the same morning: (2) **app assets too** ("빌더 사진: 앱에 넣는
  사진(로고 등)") — in the same queue.
- **ctrlaiapps-reactions** — owner, 2026-10-17 ("CtrlAIApps 댓글·반응"):
  comments and reactions on a published app's CtrlAIApps page, the same
  shape as CtrlAITube's (reactions, threaded comments, 신고, admin
  hide/delete, 반응을 얻었어요 notifications). Phase 5's remaining slice.
  **Layout (owner, 2026-10-17):** "아래 미리보기에서 한 8:2? 7:3? 으로 분리해서
  영상처럼 댓글 윈도우 만드는게 좋을듯" — on a wide screen the app preview
  takes ~70% and a right-hand panel ~30% holds the reactions (좋아요 · 유용해요 ·
  흥미로워요) and the comments, like the CtrlAITube watch page; the panel can be
  folded to give the app the full width (remembered per browser); on a phone
  the panel goes under the app.
- **ai-switch-wording** — owner, 2026-10-17: "실제 AI켜기 가 아니라 로그인해서
  사용하기 (토큰 소모 있을 수도 있음) 뭔가 이런식으로 쓰면 좋을 듯". The shell
  bar's 「실제 AI 켜기」 becomes 「로그인해서 사용하기」 with a short note that
  the member's 지원금 may be used (e.g. "AI를 쓰면 내 지원금이 조금 쓰일 수
  있어요"); wording only, the same switch.
- **Order (owner, 2026-10-17: "이거 끝나면 진행")** — after the server
  thumbnails are switched on and builder-snapshots is deployed: builder-images
  (reference, then assets), ctrlaiapps-reactions, ai-switch-wording.
  **Pre-approved** (owner, 2026-10-17, answering whether to ask each time:
  "큰 건은아니어서 매번 묻지 않아도 되면 \"같은 규칙으로\"") — the same rules:
  merge + deploy once reviews are clean and all tests pass, one at a time;
  serious money/security findings stop and wait.
  **One batch (owner, 2026-10-17: "한꺼번에 deploy. 크게 변경되는건 없는 것
  같아서 체크 한번에 하고"):** builder-images, draft-server-thumbnails,
  ctrlaiapps-reactions and ai-switch-wording are built on one integration
  branch, reviewed and tested once together, merged and deployed once.
- **draft-server-thumbnails** — owner, 2026-10-17, after the server
  thumbnails went live ("글씨체나 그 테트리스 같은 애들은 좀 깨긴 해"), choosing
  "1. 작업 중 프로젝트도 서버가 찍기" and "글꼴과 그림이 다 그려질 때까지
  기다렸다가 찍기", "지금 뭐 돌아가고 있으니까 그거 끝나고". (1) The Builder's
  draft (working copy) thumbnail is also taken by the thumbs worker after
  each new version, through the same queue and isolation (the draft's
  preview address added to what the api may ask for and the worker accepts);
  the in-browser capture stays the fallback. (2) The worker waits for
  `document.fonts.ready` and ~1–2 s more before the screenshot (both for
  published and draft renders). Scheduled right after builder-images, under
  the same rules as the queue.
- **thumbnail-choice** — owner, 2026-10-17 (seeing 미니 테트리스's empty
  start screen; "썸네일을 지정하시오 … 네모가 나와서 옆에 개발중인 데서 고를 수
  있게... 아님 말고", "사진을 직접 추가하는 일은 많진 않을 것 같아서"). A small
  썸네일 square at the top of the Builder's file panel: **자동 (첫 화면)** (the
  server's picture, default) or **내 그림** — paste a screenshot (⌘⇧4) or
  upload one; back to 자동 any time. The chosen picture is used on the
  Builder card and CtrlAIApps until changed; re-encoded like every upload.
  Optional, small. Not scheduled.
  **Revised and scheduled (owner, 2026-10-17, verbatim):** "앱에 넣을 사진 빼고
  썸네일 지정 (원래는 기본으로 렌더링 된 값을 넣고) 지정을 하면 옆에서 오른쪽에서
  비율 고정된걸로 캡쳐해서 넣을 수 있게 하면 안됨?" → (1) remove the 「앱에 넣은
  사진」 panel (builder-images (2), app assets) from the Builder; 참고 사진 stays.
  (2) In its place a **썸네일** panel: the current picture, 자동 (the server's
  first screen, default), **지정하기** → a 16:10 frame over the 미리보기 that the
  member moves/resizes (the app stays usable, e.g. a game mid-play) →
  「이 화면으로」 takes the real pixels with the browser's screen capture
  (getDisplayMedia, preferCurrentTab; one capture, the share stopped at
  once, nothing sent anywhere but the thumbnail upload), cropped to the frame;
  fallback: paste or upload a screenshot (Safari, or capture refused);
  「자동으로 되돌리기」. A chosen picture is not replaced by automatic renders
  until reset. After fix-draft-thumbs, same rules.
- **background-runs** — owner, 2026-10-17 ("채팅하다 중간에 나가면 계속
  돌아가?" → after hearing it stops today: "만약 나갔다면 채팅에 오로라로 점?
  돌아가고 있다는거 보이게"). A Chat reply (and a Builder run) keeps going on
  the server when the member leaves the page or closes the tab; only 「중지」
  stops it. The finished reply is saved and charged as today (the ledger is
  already server-side). While it runs, the conversation's row in the Chat
  list, the sidebar's Chat item and the Builder card show a small glowing
  aurora dot (running-state-calm's running signal, which must then come from
  the server, not the page); coming back mid-run re-attaches to the live
  stream. Open points: one running reply per member at a time (or per
  conversation); a server restart mid-run ends it as 중지 with what was
  written; reduced-motion shows a static dot. **Scheduled and pre-approved**
  (owner, 2026-10-17, verbatim: "background-runs도 썸네일 지정 다음에 같은
  규칙으로 해줘") — after thumbnail-choice; one running reply per member.
- **chat-to-builder-carry** — owner, 2026-10-17: "이거를 바탕으로 빌드하기
  하면 내가 채팅에서 작업했던 작업물을 그대로 들고 와서 하면 좋겠는데 처음부터
  디자인을 다시 짜야되더라고 프롬프트도 그렇고 (프롬프트만 들어가니까) 이거를
  바탕으로 빌드하면 만든 미리보기를 들고오게". Today Chat's action button
  ("Project Builder에서 시작", `useChatIdea`) opens `/builder?idea=…&name=…` —
  only the words travel, so the Builder designs from scratch. Only the
  미리보기 card's 「Builder로 보내기」 carries the HTML (`from-chat`). Change:
  when the conversation has a 미리보기 (an HTML artifact), the action creates
  the project **from that page** (the newest one; a picker if there are
  several) via the same `from-chat` path, with the idea as its first request
  context, so the Builder continues from the design the member already
  liked; without a 미리보기 it stays as today. Small. **Scheduled and
  pre-approved** (owner, 2026-10-17, verbatim: "chat-to-builder-carry는
  background-runs 다음에 같은 규칙으로 해줘").
  **Refined (owner, 2026-10-17, with screenshots):** "빌더로 보내기 이거를 하면
  잘 가긴 하거든? 근데 html만 띡 가고 제목도 저렇게만 되고 프로젝트 빌드하기
  누르면 프롬프트만 가서 이상한거 만들어지고". So: (1) one action — in a
  conversation with a 미리보기, 「Project Builder에서 예시 앱 만들기」 becomes
  「이 미리보기로 Builder 시작」 (same as the card's 「Builder로 보내기」); (2) the
  project name comes from the page (`<title>` / first heading, shortened), a
  Haiku name only when the page has none — not the truncated conversation
  title; (3) the conversation's requirements travel too: a short requirements
  note (what was asked and decided: features, data, look) saved as the
  project's SPEC.md (a guide doc, not served) and shown in the Builder's
  first Claude bubble ("채팅에서 가져왔어요 · 요구사항 N개"), so later 고치기
  build on it instead of starting over; Haiku summary charged and estimated
  like any call (a few 원), or free when it can be taken from the messages as
  they are; (4) several 미리보기 in the conversation → pick one (newest by
  default).
- **chat-pins** — owner, 2026-10-16 evening: "채팅에 핀 기능
  추가해야하는데". The same 고정 that Project Builder and Video Generator
  got in ui-improvements-a (`pinned_at` on the row, a 고정 / 고정 해제
  item in the conversation's ⋯ menu, pinned conversations first in the
  Chat sidebar list under a small 고정됨 heading, newest pin first). Owner
  only (a member pins their own chats), a JSON-body route, a migration.
  Small. **Scheduled and pre-approved** (owner, 2026-10-16 evening,
  verbatim: "chat-pins도 motion-modern 다음에 같은 규칙으로 (리뷰 깨끗 +
  테스트 통과하면 merge + 배포) 해줘") — ⑥ after ⑤ motion-modern, branch
  `feat-chat-pins`, same rules as ④–⑤. **Merged `d224240`, deployed 2026-10-17** — Done row in the archive.

## admin-consolidation — Next entry (v3, merged 2026-10-17 in four batches)

Batches: (1) `feat-admin-frame` `20eee8f`, (2) `feat-admin-merges` `0e8d2b2`, (3) `feat-admin-usage` `8e45e40`, (4) `feat-admin-settings` `a7190f8`. The decisions, mock-up and branch plan stay in [`../ui-requests/admin-consolidation.md`](../ui-requests/admin-consolidation.md). The Next entry as it stood:

8. **admin-consolidation** · M1 · eight small branches, one per row of the plan
    **Scheduled and pre-approved** (owner, 2026-10-17, verbatim:
    "admin-consolidation(v3 기준, 4묶음)도 ⑤ 다음에 같은 규칙으로 해줘") — after
    chat-to-builder-carry, built from the **v3** revision in
    `ui-requests/admin-consolidation.md` (mock `admin-consolidation-v3.html`) in
    **four batches**, each: review clean + tests pass → merge + deploy. Owner, 2026-10-17 (desktop
    session): Admin has too many sections and repeats itself — cut **13
    sections to 6** (Dashboard · Members · Quarters · Models · Community ·
    System), add per-member usage and a Quarters › 사용 분석 tab (where the
    API money goes: by provider, feature, model, app, member, day). **Start
    only after the batch deploy now running has gone out.** Decisions
    (미참여 not 미신청; orange means "needs action"), the mock-up, the
    branch plan and the open questions are in
    [`ui-requests/admin-consolidation.md`](../ui-requests/admin-consolidation.md)
    (mock: `admin-consolidation.html`). Supersedes the *Admin › 사용량 분석*
    part of **usage-analytics** (decide at the start whether to merge the
    two specs). Open: 공지 보내기 now or later; keep the old `/admin/*`
    addresses as redirects (recommended).
