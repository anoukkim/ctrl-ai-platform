# privacy-and-terms — checklist

Top of Next (owner, 2026-10-14; built in the morning batch under the same
loop and pre-approval). **The owner reads the Korean text before members
are invited** — the run log marks it 운영진 검토 필요 at merge.

1. `/privacy` (개인정보 처리방침) and `/terms` (이용약관) — Korean,
   club-scale and honest, server components on a shared `LegalPage`
   layout, reachable logged out (added to `PUBLIC_PATHS`), phone-width
   and both themes.
2. 처리방침 covers: collected data (Google 이메일·이름은 로그인에만,
   아이디, 대화 내용, 올린 파일, 사용 기록), purposes, retention
   (탈퇴 30일 뒤 익명화 — matches `anonymise_withdrawn`: 아이디·이메일·
   이름이 `withdrawn-<id>` 꼴로 바뀌고, 사용·감사 기록은 기록으로 남음),
   Google Cloud 서울 리전, third parties (Claude(Anthropic)에 대화가
   전달됨, 영상은 Higgsfield — 베타에서는 목업이라 실제 전송이 없음을
   정직하게 표기), member rights (Profile에서 열람·수정·탈퇴), contact
   ctrlai.platform@gmail.com, 시행일 2026-10-14 · v1.
3. 약관 covers: 동아리 내부 초대제 베타, 무상 지원금(80,000원/분기,
   환불·현금화 불가), 계정 규칙(초대 코드, 1인 1계정, 비밀번호 관리),
   이용 규칙(불법·유해 생성 금지, 공용 크레딧 남용 금지 — 한도 규칙
   존재), 게시물 공개 범위와 탈퇴 후 표기, 베타의 변경·중단 가능성,
   AI 생성물 비보장, 문의처, 시행일·버전.
4. Consent at sign-up, both paths, **server-enforced**: one checkbox
   (개인정보 처리방침과 이용약관에 동의) with new-tab links; the
   password `register` and `google/complete` routes refuse without it
   (Korean 400, before anything is spent or claimed);
   `users.terms_accepted_at` stored on creation. Migration adds the
   nullable column. **Existing members stay NULL** — they predate the
   terms; whether they must re-consent is the owner's later decision.
5. Links: both sign-up screens (in the checkbox label) and the sidebar
   footer (small 개인정보 · 약관 row under the footer buttons).
6. Tests: refusal without consent on both paths creates nothing and
   claims no invite use; acceptance stores a tz-aware timestamp; pages
   render with their key sections; the checkbox gates submit; footer
   links exist.

## Status — loop results

- Backend full suite green (PG tests ran on `ctrlai_pt_test` with the
  real container password); frontend **354** vitest (35 files, 4 new),
  tsc 0, eslint 0 — both re-run after the end-of-run merge of main.
- Browser check (preview 8260/3260, practice DB `ctrlai_preview_pt`):
  `/privacy` and `/terms` render logged-out in both themes with no
  sideways scroll; the signup button stays locked until the checkbox,
  whose links open `/privacy`·`/terms` in a new tab; a consent-false
  POST is refused 400 with the exact Korean sentence; the password path
  and the **mock Google path** both complete end to end with consent and
  land signed-in on Chat; the sidebar footer shows 개인정보 · 약관.
- First end-of-run merge of `main` (docs-cleanup) was clean.

## Review round 1 → round 2 (owner ruled on the fixes)

1. **Migration re-parented** — main merged `feat-tool-cap-defaults`
   (`c9f2e6a8d4b1`, same parent `a8d4f1c7e9b3`), so the earlier "no
   re-parenting needed" was overtaken. `b9e6a3d1f4c7` now revises
   `c9f2e6a8d4b1`; `alembic heads` shows exactly one; proven on a fresh
   PostgreSQL DB (`ctrlai_ptmig_test`): upgrade head → downgrade
   `c9f2e6a8d4b1` → upgrade head.
2. **Privacy §6** promises only what the app does today: view info
   (Profile), sign-in methods (Profile › 로그인 방법), delete
   conversations, delete projects/videos, download work (ZIP, video),
   회원 탈퇴. Name change / 정정 / 열람 요청 → 운영진에게 요청. (There
   is no member name-change route — checked.)
3. **Privacy §3 backups — the real retention is "최근 7개", not N
   days.** `deploy/backup.sh` (called by `update.sh` before every
   update) writes a full gzipped `pg_dump` on the Seoul VM; nothing
   expires backups by date — `docs/deployment.md` §8 tells the operator
   to keep the most recent 7 by hand and to download a copy to their own
   PC. Final wording: "서비스를 업데이트하기 전마다 서버(서울 리전)에서
   데이터베이스 전체를 백업하고, 서버에는 가장 최근 백업 7개만
   남깁니다(날짜가 지나면 저절로 지워지는 방식이 아니라, 운영진이 오래된
   것부터 지웁니다). 장애에 대비해 운영진이 백업 사본을 안전한 곳에
   내려받아 둘 수 있습니다. 서버 밖 자동 백업을 시작하면 이 내용을
   고칩니다."
4. CtrlAIApps/CtrlAITube publishing is future tense in privacy §5 and
   terms §5 (the screens are still mock); the withdrawal 내리기 choice
   stays present tense (implemented). Privacy §1 adds 의견 보내기 notes
   (text, page, author; 운영진만), says Google 이메일·이름 are for
   로그인과 계정 만들기 (name prefills the display name; the verified flag
   identifies the admin), and that attempt/IP rows are deleted after a
   day (`rate_limit.RETENTION`). The "커뮤니티에 올린 글과 댓글" claim
   was dropped (comments are not stored yet). `docs/product.md` routes
   gain `/privacy` and `/terms`. Tests: the Google refusal now asserts
   invite uses unchanged and the timestamp's recency; new assertions for
   the sidebar 개인정보·약관 links (and their absence on the collapsed
   rail), the LegalPage footer links, and the no-name-change / 7-backups
   wording; `expire_all()` before re-reading uses so a stale session
   cannot hide a change; trailing whitespace in
   `tests/test_sign_in_methods.py` and redundant consent keys in
   `tests/test_auth.py` cleaned.

**Round-2 loop:** backend full suite green with **0 skipped** (every
PostgreSQL test ran, real container password, `ctrlai_pt_test`);
frontend **357** vitest (35 files), tsc 0, eslint 0. Browser re-check
at a true 390px width (same-origin iframe; the window itself would not
resize) in dark and light: both pages render, no sideways scroll, the
backup sentence on `/privacy`, future-tense community wording on both.
`npm run build` not run in the worktree (Turbopack) — run it on main.

## Self-review notes (for the owner's text review — 운영진 검토 필요)

- Every claim in both documents was re-checked against the code after
  round 2: the beta's mocks send nothing out, 30-day anonymisation
  matches the job, charge limits exist as described, backups are as in
  point 3 above, account data is never sent to AI providers (request
  content only), attempt rows older than a day are deleted when the next attempt is recorded (no scheduled pruning), community screens are future.
- 약관 §3 says a member who forgot their password should contact the
  운영진 — honest as a contact instruction, but **no member
  password-reset tool exists yet** (`set_admin_password` is admin-only).
  Worth a small backlog item if password-only members are expected.
- Existing members (the dev seed, the server admin) keep
  `terms_accepted_at = NULL`; whether they must re-consent on next
  sign-in is deliberately left for the owner.


## Review round 2 — 2026-10-14

Approve after three wording fixes, applied by the main session:
- §6: 대화 삭제 and 프로젝트·영상 삭제 need an active quarter membership
  (`require_active_member`); the page now says so and points others to
  운영진.
- §1 보안 기록: rows older than a day are pruned only when the next
  attempt is recorded — no scheduled job — so the page no longer says
  "하루가 지나면 지웁니다" and notes they can stay longer and are in the
  pre-update backups.
- §1 Google: a verified email is required to sign up at all, not only to
  recognise the admin.
