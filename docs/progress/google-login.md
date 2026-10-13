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

## Status (self-review against the diff)

1. ✅ `GoogleButton` on `/login` and `/signup` (LoginForm / SignupForm), where `/api/site` says `google_login`.
2. ✅ `services/google_login.SIGN_IN_SCOPES`; `test_real_provider_asks_only_for_sign_in_scopes`.
3. ✅ `/signup/google` (`GoogleSetupForm`), `GET /api/auth/google/pending`, `POST /api/auth/google/complete`.
4. ✅ Code required for every new account except a verified ADMIN_EMAIL —
   decision: the owner must be able to make the first admin on an empty
   server where no invite code exists yet. `test_a_code_is_required_in_the_beta_too`.
5. ✅ `_is_admin_email` (verified and equal, case-insensitive);
   `test_only_a_verified_admin_email_becomes_admin`, `..._becomes_admin_without_a_code`.
6. ✅ Lookup by `ConnectedAccount.provider_account_id == sub`; email only for display;
   `test_an_existing_account_is_never_entered_by_email`, `test_the_same_sub_signs_in_next_time`.
7. ✅ `GET /api/account/google/link/start` + `GoogleConnectionRow`; link tests.
8. ✅ `/login/password` (unlisted, noindex); Google-made accounts get `UNUSABLE_PASSWORD_HASH`.
9. ✅ YouTube row unchanged except its hint; `encrypted_credential` reserved, empty.
10. ✅ `routes/google_auth.py` — state row + HttpOnly cookie + PKCE S256.
11. ✅ `GOOGLE_CLIENT_SECRET` read only by `RealGoogleLogin`, never returned.
12. ✅ `MockGoogleLogin` + dev-only consent page.
13. ✅ `docs/deployment.md` step 14 (consent screen, client ID, redirect URI, test users, `.env`, linking the admin first).
14. ✅ `missing_provider_settings` for `google`; `test_real_google_needs_its_settings`.
15–21. ✅ as listed (`connected_accounts`, callback on the backend, `oauth_states`,
    `pending_google_signups`, audit `account.admin_by_google`, password form at
    `/login/password`, `google_login_available` = dev-only mock).
22–28. ✅ `tests/test_google_login.py` (state/PKCE single-use, cross-browser state,
    cancel, setup + code, same sub, email never enters, linking and refusal, admin
    rule, mock refused in beta, no token in responses, real provider with a fake
    transport); `EXPECTED_GUARDS` and the architecture table updated.

Browser check (local, mock): new member signs up via the mock page with
`DEV-WELCOME` carried from `/signup?code=`; a wrong code is refused; the
login screen has no password field; `/login/password` has; the admin links
Google from Profile and signs in by `sub` with a changed email; a Google
account whose email matches `dev@ctrl.ai` is not let in. Phone width found
an older overflow on Admin › Members (fixed, fbe5654).

## Review round 1 — 13 findings (1 high, 3 medium, 9 low)

Fixed:
- **High — a Google-only member could not withdraw** (withdrawal re-checks a
  password they do not have): they now type their username instead
  (`has_password` on `/api/auth/me`; `WithdrawRequest.confirm_username`).
- Medium — password sign-in had no limit: `login_attempts`, 10 failures per
  15 minutes per address and per username.
- Medium — an unverified Google email could create an account and take the
  address: refused at setup.
- Low-medium — linking now requires the same member to still be signed in,
  and is audited (`account.google_linked`).
- Low — the state row is taken with an atomic `DELETE … RETURNING`; at most
  500 sign-ins in progress at once; Google's answers that are not JSON, not
  an object, or carry a bad `exp` / foreign `azp` become a failed sign-in,
  not a 500; anonymisation deletes the Google link; e-mail comparisons are
  case-insensitive; abandoned pending sign-ups are pruned on every visit;
  `?google=constructor` no longer renders a function.

Left as decisions for the owner:
- **No "unlink Google"** yet. A Google-only member who unlinked would have no
  way in; adding it needs a password-setting step first.
- **An admin created through Google has no password**, so the emergency
  `/login/password` does not exist for that admin. Today's beta admin was
  made by `bootstrap` with a password, so this only matters on a fresh
  server.
- The setup screen says when the visitor's own Google email already has an
  account (before any invite code is checked). It reveals only their own
  address; kept, because the alternative is a dead end with no explanation.
