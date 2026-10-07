# Deployment

> **The beta's hosting is decided** — `ctrlai.my` on one Google Cloud
> e2-micro VM with Docker Compose. See
> [`BACKLOG.md` › prep-beta-launch › Hosting decisions](BACKLOG.md#hosting-decisions--2026-10-07).
> `prep-beta-launch` replaces this file with the full beginner's guide.
> Everything below is the earlier README section, moved here unchanged
> on 2026-10-07.

## Anthropic credit — decided 2026-10-07

Real Claude (`CLAUDE_PROVIDER=anthropic`) is paid from **prepaid Anthropic
credit**, not from the budgets in the app — those are what members are
*charged*, in won; the credit is what the club *pays*. To start:

- buy a **small prepaid credit**: the free sign-up credit if the account
  gets one, otherwise about **$5–10**;
- keep **auto-reload OFF** in the Anthropic Console, so nothing is topped
  up without a decision;
- set a **monthly spend limit** in the Console (also a condition of the
  beta-only `.env` exception in `CLAUDE.md` section 17).

At the default model (Sonnet 5.5) a typical reply costs about 17원, so $5
covers several hundred replies.

---

**Nothing is deployed, and no cloud resource has been created.** Going live
is **Phase 9** — domain, HTTPS, hosting, managed PostgreSQL, Secret Manager
and switching providers from mock to real. Every phase before it is built
and tested locally with no keys and no domain.

What follows is only about an optional **frontend-only preview deploy** for
gathering feedback on the product concept. It is not Phase 9 and does not
replace it.

> **No longer true since Phase 1a.** The app now requires sign-in, and the
> browser reaches the backend through the Next.js `/api/*` rewrite. A
> frontend-only deploy shows the login screen and nothing else. Reviewing
> the product now means running both halves locally, or doing the full
> Phase 9 deployment.

## Frontend — Vercel

Every route still builds, and the production build passes.

| Setting                    | Value       | Why                                             |
| -------------------------- | ----------- | ----------------------------------------------- |
| Root Directory             | `frontend`  | This is a monorepo; do not build from the root  |
| Framework                  | Next.js     | Auto-detected                                   |
| `NEXT_PUBLIC_API_BASE_URL` | leave unset | Only the Admin status card calls the backend    |

## Backend — now required

Since Phase 1a the backend is no longer optional: sign-in, every project
list and every admin screen go through it.

Deploying the backend properly is Phase 9. In outline it needs:

- bind to the platform's port: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- set `BACKEND_ORIGIN` so the frontend's `/api/*` rewrite reaches it
- set `CORS_ALLOW_ORIGINS` to the deployed frontend's origin
- point `DATABASE_URL` at a managed PostgreSQL instance
- set `SESSION_COOKIE_SECURE=true`
- run `alembic upgrade head` as part of deployment

Alembic already owns the schema and `create_all` is gone, so that last point
is a deployment step rather than a code change.

## When the backend is unavailable

This is the normal case for a frontend-only deploy, and it is handled:

- every screen except `/admin` is unaffected
- the status card fails fast (8-second timeout) and shows **연결 안 됨**
- the card explains, in Korean, that the rest of the prototype works without it
