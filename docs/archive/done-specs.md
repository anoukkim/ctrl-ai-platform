# Done specs

Full specs of merged items, and the older archived specs, moved out of
[`../BACKLOG.md`](../BACKLOG.md) on 2026-10-07 so that file only holds
open work. Text unchanged; headings keep their original levels and
merge dates. The merge summaries are in [`done.md`](done.md).

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

**Before:** [`docs/ui-requests/admin-before.png`](../ui-requests/admin-before.png)
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
words are in the run log (docs/progress/RUN-2026-10-13.md › Run of
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
