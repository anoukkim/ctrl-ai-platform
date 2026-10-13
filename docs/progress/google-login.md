# google-login — checklist

Branch `feat-google-login`. Spec: `docs/BACKLOG.md` › google-login (owner
decision 2026-10-13: Google is the main way to sign in).

## Requirements

1. "Google로 계속하기" on sign-in and sign-up.
2. Scopes `openid`, `email`, `profile` only; no YouTube scope at sign-in.
3. First Google sign-in → a setup screen to choose username and display name.
4. A new account needs a valid invite code (spec: in beta; invite-only-signup
   requires it everywhere, so everywhere).
5. The account whose **verified** Google email equals `ADMIN_EMAIL` becomes
   admin; `email_verified=false` never matches.
6. Link by Google's `sub`, never the email. An existing account is never
   entered because an email matches.
7. A member links Google from Profile while signed in.
8. Username/password stays only as the admin's emergency login; members do
   not see it.
9. YouTube stays Phase 7 (Profile › YouTube 연결 unchanged; incremental
   authorization later). Refresh tokens encrypted at rest, never sent to the
   browser — none are stored by sign-in; the column is reserved.
10. The backend does the whole OAuth exchange with `state` and PKCE.
11. The client secret lives only in the server `.env`.
12. A mock provider for development and tests (`GOOGLE_LOGIN_PROVIDER=mock`).
13. `docs/deployment.md` lists the Google Cloud console steps (consent
    screen, client ID, redirect URIs, test users) and the `.env` lines.
14. Provider rule: real implementation behind configuration; a missing
    client ID / secret / redirect URI fails at startup only when `google`.

## Build notes from the spec

15. A `ConnectedAccount` row (`provider="google"`, `provider_account_id=sub`,
    unique) — the same row Phase 7 extends with the YouTube scope.
16. The callback lands on the backend (`/api/auth/google/callback`) and sets
    the usual HttpOnly session cookie; no token reaches the browser.
17. `state` and the PKCE verifier in a short-lived server row, tied to an
    HttpOnly cookie, never in `localStorage`.
18. Pending sign-up row keyed by `sub`, short-lived, until setup is done.
19. ADMIN_EMAIL matched only when the account is created, and audited.
20. The sign-in screen shows only Google; the password form at an unlisted
    route; Google-made accounts have no usable password.
21. The mock is offered in development only (elsewhere it would let anyone
    claim any Google account).

## Tests named by the spec

22. state and PKCE checked and single-use.
23. a new `sub` goes to the setup screen and needs an invite code.
24. an existing account is never entered by email alone.
25. linking from Profile attaches the `sub` to the signed-in account and
    refuses a `sub` linked elsewhere.
26. only a verified ADMIN_EMAIL becomes admin.
27. no route returns a token.
28. the access table and `EXPECTED_GUARDS` gain the new routes.

## Status

(filled in at step 6)
