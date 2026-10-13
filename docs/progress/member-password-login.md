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

## Status

(filled in at step 6)
