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
- Merged `main` at the end (docs-cleanup included) — clean, no migration
  re-parenting needed (`b9e6a3d1f4c7` is the single head on
  `a8d4f1c7e9b3`); full loop re-run after the merge.

## Self-review notes (for the owner's text review — 운영진 검토 필요)

- Every claim in both documents was checked against the code: the beta's
  mocks send nothing out, 30-day anonymisation matches the job, charge
  limits exist as described, backups stay in the same environment,
  account data is never sent to AI providers (request content only).
- 약관 §3 says a member who forgot their password should contact the
  운영진 — honest as a contact instruction, but **no member
  password-reset tool exists yet** (`set_admin_password` is admin-only).
  Worth a small backlog item if password-only members are expected.
- Existing members (the dev seed, the server admin) keep
  `terms_accepted_at = NULL`; whether they must re-consent on next
  sign-in is deliberately left for the owner.
