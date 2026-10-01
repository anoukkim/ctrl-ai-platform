---
name: verify
description: How to get Ctrl AI running and drive its real surfaces for runtime verification.
---

# Verifying Ctrl AI at runtime

Two surfaces are available: the **GUI** (Next.js, `http://localhost:3000`) and the
**HTTP API** (FastAPI, `http://localhost:8000`). Use both — the API is the fastest
way to probe invariants, the GUI is the only way to prove a member can reach them.

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

`init_db` refuses to run before migrations. Do **not** reset the database.

## Reading the live route table

Never guess API paths — ask the running app:

```bash
curl -s http://localhost:8000/openapi.json \
  | python -c "import json,sys; d=json.load(sys.stdin); [print(f'{m.upper():6} {p}') for p,o in sorted(d['paths'].items()) for m in o]"
```

`requestBody: null` on an endpoint means it takes **no body** — e.g.
`POST /api/video/projects/{id}/versions` snapshots the project's current prompt
and model rather than accepting them. A body sent there is silently ignored, so a
probe that passes one proves nothing.

## Seeded dev state

One user (`@dev`, admin, `get_current_user` returns them unconditionally —
there is no login). Quarters 2026-Q1/Q3 closed, 2026-Q4 `application_open`.
Three video models: kling + seedance visible, wan-3.0 disabled/hidden.

## Probes that actually bite

- **Split rule** — needs an open quarter with *no* existing application, otherwise
  the duplicate check (409) fires before the percentage check. Create one:
  `POST /api/admin/quarters` (note: it ignores the `status` you send and always
  creates `draft`; `PATCH` it to `application_open`). Then 60/60 → 400 naming the
  real sum, 33/67 → 33,000 + 67,000 = exactly 100,000.
- **Model allowlist** — enforced on `PATCH /api/video/projects/{id}`
  (`selected_model_id: 3` → 400), not on version creation.
- **Ownership isolation** — *cannot* be exercised at runtime: there is one user and
  no auth, so another member's row is unreachable through the running app.
- **Missing project** — `/builder/99999` renders a Korean error card with a way back.
- **Search** — a no-match query shows `검색 결과가 없습니다` and a `0개 / 전체 N개` counter.

## Known mock surfaces (do not mistake for breakage)

`Usage` and the Admin **회원 관리** table still render `lib/mock-data.ts` and will
contradict the live allocation shown on Profile. There is no usage route in the
API at all — confirm against `openapi.json` before reporting a mismatch as a bug.

## Korean typing

The Chrome `type` action drives the IME correctly; `isComposing` guards are in
place, so Enter does not submit mid-composition.
