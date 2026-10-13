---
name: verify
description: How to get Ctrl AI running and drive its real surfaces for runtime verification.
---

# Verifying Ctrl AI at runtime

Two surfaces: the **GUI** (Next.js, `http://localhost:3000`) and the
**HTTP API** (FastAPI, `http://localhost:8000`). Use both — the API is the
fastest way to probe invariants, the GUI is the only way to prove a member
can reach them. Everything needs a signed-in session now; there is no
"always the dev user" shortcut any more.

## Getting a handle

```bash
docker compose ps                      # ctrlai-postgres must be healthy
netstat -ano | grep -E ":3000|:8000"   # servers are often already up
```

If they are not running:

```bash
docker compose up -d db
cd backend && alembic upgrade head && python -m app.db.init_db
cd backend && uvicorn app.main:app --port 8000      # :8000
cd frontend && npm run dev                           # :3000
```

`init_db` refuses to run before migrations and outside development. Do
**not** reset the database without asking; `python -m app.db.reset_dev
--yes` wipes and reseeds (development + localhost only).

## Signing in

Development seed (`init_db` / `reset_dev`):

| Account | Password | What it is |
| ------- | -------- | ---------- |
| `dev` | `devpassword` | admin, participant in the current quarter |
| `pw_member` | `memberpassword` | member, password only |
| `google_member` | — | member, Google only (use the mock consent page) |
| `both_member` | `memberpassword` | member, password + Google |

Invite codes: `DEV-WELCOME` (many uses), `DEV-TRY-ONCE` (one use).
Google로 계속하기 goes to a **mock Google page** in development
(`GOOGLE_LOGIN_PROVIDER=mock`) where any email can be typed.

For the API, keep the HttpOnly session cookie in a jar:

```bash
curl -s -c /tmp/cj -H "Content-Type: application/json" \
  -d '{"username":"dev","password":"devpassword"}' http://localhost:8000/api/auth/login
curl -s -b /tmp/cj http://localhost:8000/api/auth/me
```

## Money: one wallet, and how to get one

A fresh seed gives the dev user **membership but no 동아리 지원 wallet**,
so every paid action (Chat, video, the starter app) is refused with
"이번 분기 지원금이 부족합니다" until a wallet exists. Make one as the
member + admin in one: Profile → 이번 분기 참여 → Admin › Applications →
승인 — approving writes the 80,000원 wallet (the quarter's
`subsidy_limit_krw`). Personal top-ups are **off everywhere**
(`PERSONAL_TOPUP_ENABLED=false`, personal-topup-off 2026-10-14): members
see no 개인 잔액 anywhere, and `POST /api/quarters/me/top-ups` is the
probe below.

## Reading the live route table

Never guess API paths — ask the running app:

```bash
curl -s http://localhost:8000/openapi.json \
  | python -c "import json,sys; d=json.load(sys.stdin); [print(f'{m.upper():6} {p}') for p,o in sorted(d['paths'].items()) for m in o]"
```

## Probes that actually bite

- **Top-ups are off** — `POST /api/quarters/me/top-ups` → 403 "지금은
  개인 충전을 쓸 수 없습니다…"; `PATCH /api/quarters/me/wallet` with
  `{"overage_enabled": true}` → 403. `/api/usage/me` has `"personal": null`.
- **Ownership isolation** — sign in as `pw_member`, GET a project id that
  belongs to `dev` → **404**, not 403 (existence is not revealed).
- **Participation gate** — `pw_member` has no membership row: every
  creating route (`POST /api/builder/projects`, a chat message) → 403;
  reads of their own work still answer.
- **Chat spends the wallet** — with a wallet, `POST
  /api/chat/conversations/{id}/messages` streams SSE (`start` / `delta` /
  `done`) with a canned Korean mock reply and `done.charged_krw` > 0; the
  same amount appears in `/api/usage/me`. Rate limit: 10 messages/min → 429.
- **AI model catalogue** — `PATCH /api/admin/chat-models/{deepseek-id}`
  with `{"visibility":"members"}` → 400 "연결 준비 중…" (a provider with
  no adapter can be priced, never opened); a model the member may not use
  is refused at send time with a Korean 400.
- **Video allowlist** — a hidden/disabled model id on
  `PATCH /api/video/projects/{id}` → 400.
- **Soft delete** — a member's `DELETE /api/builder/projects/{id}` makes
  every member route answer 404 while `GET /api/admin/deleted-items`
  still lists it (restore from Admin › Deleted Items).
- **Search** — a no-match query shows `검색 결과가 없습니다` and a
  `0개 / 전체 N개` counter.
- **Missing project** — `/builder/99999` renders a Korean error card with
  a way back.

## Known mock surfaces (do not mistake for breakage)

- **Chat replies** are a real conversation flow but the words come from
  the mock Claude provider (`CLAUDE_PROVIDER=mock`) — deterministic
  Korean answers; charging, trimming and the ledger are all real.
- **Video generation** records real versions and charges, but the asset
  is a placeholder **GIF** from the mock provider.
- **CtrlAIApps and CtrlAITube listings** are mock data until Phases 5
  and 8.
- **Google sign-in** is the mock consent page in development.

The "회원 관리 is mock" era is over: Usage, Admin members, budgets,
applications, invites and the audit log are all real data.

## Korean typing

The Chrome `type` action drives the IME correctly; `isComposing` guards
are in place, so Enter does not submit mid-composition.

## Browser checks

Check changed screens at **1280px and 390px, dark and light** (the theme
toggle is in the sidebar footer; `localStorage` key `ctrlai-theme`), and
read the console for errors before calling a screen done.
