# test-database-isolation — checklist

Branch `fix-test-database-isolation`. Spec: `docs/BACKLOG.md` ›
test-database-isolation.

## Requirements

1. A dedicated test database from its own setting, `TEST_DATABASE_URL`,
   defaulting to `postgresql+psycopg://ctrlai:ctrlai@localhost:5432/ctrlai_test`.
2. Refuse to run when it resolves to the same database as `DATABASE_URL`,
   comparing the parsed host (localhost / 127.0.0.1 / ::1 alike), port and
   database name, not the raw string. The failure is loud and names both URLs.
3. Skip politely when no test database is reachable (suite runs with Docker down).
4. The schema comes from migrations (`alembic upgrade head`), not `create_all`.
5. Drop or truncate what the tests created afterwards.
6. Alembic accepts a URL handed to it, so migrations can target the test
   database without touching `DATABASE_URL`.

## Tests named by the spec

7. The suite leaves `DATABASE_URL`'s database untouched — the table list
   and `alembic_version` compared before and after a full run.
8. The guard refuses when both URLs name the same database, including when
   spelled differently.
9. The row-lock test still proves overspending is impossible (now on the
   test database).
10. (Also) the invite-code race test moves to the same fixture.

## Docs

11. `.env.example`, `docs/development.md` (operator note replaced),
    README's test warning, `.github/workflows/images.yml` unaffected (no
    PostgreSQL in CI → the two tests skip).

## Status

(filled in at step 6)
