# member-password-login — checklist

Branch `feat-member-password-login`. Spec: `docs/BACKLOG.md` ›
member-password-login (owner, 2026-10-14). **Waits for the owner's check
before merging.**

## Requirements

1. Login page: **Google로 계속하기** and, below it, the username/password
   form — both visible (the form alone when Google sign-in is off).
2. `/login/password` keeps working — redirects to `/login`.
3. Sign-up: Google, or username + email + password; an invite code is
   required either way (unchanged backend rule).
4. Profile › **로그인 방법**: a Google member can set a password (and can
   then sign in by username); a password member can link Google.
5. Unlinking Google or removing the password is allowed only while the
   other method remains — enforced in the backend, under a row lock so two
   requests at once cannot remove both.
6. A member with a password can change it (current password required).
7. Existing rules kept: Argon2id; the database-backed attempt limits (also
   on the new current-password checks); Google linked by `sub`, never by
   email; ADMIN_EMAIL promotion only at creation with `email_verified`;
   withdrawal works for both kinds of account.
8. New sign-in-method changes are audited like `GOOGLE_LINKED`.
9. Docs: CLAUDE.md section 11, done-specs › google-login notes,
   `docs/product.md`.
10. Dev seed: an admin with a password only, a member with Google only, a
    member with a password only, a member with both, an unused invite
    code — development only, with a test.

## Tests

11. Backend: set password (Google-only) then log in by username; change
    needs the current password; remove refused without Google, allowed
    with it; unlink refused without a password, allowed with it; wrong
    current password counted by the login limit; withdrawal after setting
    a password needs the password; seed accounts exist with the right
    methods.
12. Frontend: login page shows both; `/login/password` redirects; sign-up
    shows both; Profile rows show set/change/remove/unlink as allowed.

## Owner check (this item only)

13. Preview on separate ports with the practice database and a fresh dev
    seed; Playwright through every flow, both themes, 390 px.
14. Korean click-through checklist for the owner; push the branch; RUN log
    "waiting for owner check"; merge only on the owner's OK.

## Status — self-review against the diff

1. ✅ `frontend/app/login/LoginForm.tsx` — Google button, "또는 아이디로 로그인", the form.
2. ✅ `frontend/app/login/password/page.tsx` — `redirect("/login")`.
3. ✅ `frontend/app/signup/SignupForm.tsx` — both; invite code required on both paths (backend unchanged).
4. ✅ `frontend/app/profile/SignInMethodsSection.tsx` + `backend/app/api/routes/sign_in_methods.py`.
5. ✅ `drop_password` / `drop_google` under `SELECT … FOR UPDATE` with `populate_existing`; PostgreSQL race test (`test_removing_both_at_once_leaves_one`), proved to fail without the lock. Password removal also needs Google sign-in switched on.
6. ✅ 바꾸기 with the current password.
7. ✅ Argon2id (`hash_password`); `login_blocked`/`record_login_failure` on every current-password check (and withdrawal); Google linked by `sub` (unchanged); ADMIN_EMAIL unchanged; withdrawal tests for both kinds.
8. ✅ Audit actions `account.password_set/changed/removed`, `account.google_unlinked`.
9. ✅ CLAUDE.md §11, done-specs google-login note, product.md, development.md, deployment.md, README, architecture.md guard table.
10. ✅ `seed_sign_in_accounts` + `test_the_dev_seed_has_one_account_for_each_way_in`.
11–12. ✅ `backend/tests/test_sign_in_methods.py`, `frontend/__tests__/member-password-login.test.tsx`, `google-login.test.tsx` updated.

Review: round 1 — 11 findings (3 medium: password removal while Google
sign-in is off; other browsers kept after a removal; a first password or a
Google link from a browser left open) — fixed, plus withdrawal under the
limiter, case-insensitive sign-up email, accessibility and copy; round 2
— 6 (low/medium-low), 4 fixed, 2 accepted and documented (the 10-minute
rule cannot stop a browser still signed in to Google; the link state is
tied to the member, not the session; a unique index on `lower(email)`
left for later — a migration that could fail on existing data); round 3 —
1 low (the same check-then-lock gap in remove/unlink), fixed.

Final checks on the branch: backend 639 passed (test PostgreSQL), frontend
321 passed, tsc 0, lint 0, build ok. Browser check on the preview: every
flow below, dark and light, 1280 and 390 px, no console errors.

## 주인 확인용 체크리스트 (미리보기)

미리보기: **http://localhost:3200** — 이 브랜치만 띄운 연습용 사이트입니다
(연습용 데이터베이스 `ctrlai_preview`, 모든 서비스 목업). 개발용 DB(5432)는
건드리지 않습니다.

계정 (비밀번호는 개발용):

| 아이디 | 비밀번호 | 로그인 방법 |
| ------ | -------- | ----------- |
| `dev` | `devpassword` | 관리자, 비밀번호만 |
| `pw_member` | `memberpassword` | 비밀번호만 |
| `google_member` | (없음) | Google만 — 목업 화면에서 sub `mock-sub-google-member` |
| `both_member` | `memberpassword` | 둘 다 — Google sub `mock-sub-both-member` |

초대 코드: 한 번만 쓸 수 있는 `DEV-TRY-ONCE` (안 쓴 것), 여러 번 쓰는 `DEV-WELCOME`.
세 회원은 이번 분기에 참여하지 않으므로 Chat 보내기는 막혀 있습니다(로그인
확인과는 관계없음).
