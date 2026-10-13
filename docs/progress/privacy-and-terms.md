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

## Status

(filled at the end of the loop)
