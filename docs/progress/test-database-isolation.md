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

## Status (self-review against the diff)

1. ✅ `backend/tests/pg.py` `configured_url()` — env, then `.env`, then the default.
2. ✅ `pg.same_database` / `pg.refusal` (host, port, name; passwords hidden);
   raised as `pytest.UsageError` in `conftest.pytest_sessionstart`, and again
   in the `pg_engine` fixture; `pg.prove_separate` checks the server itself
   before anything is dropped (review round 1).
3. ✅ `pg_engine` skips with the URL shown (password hidden) when unreachable.
4. ✅ `pg.migrate` → `alembic upgrade head`; `test_the_test_database_is_built_by_the_migrations`.
5. ✅ `pg.reset_schema` at the start and the end of the run.
6. ✅ `alembic/env.py` reads `config.attributes["database_url"]`.
7. ✅ `conftest.pytest_sessionstart/finish` snapshot; proved by
   `test_a_run_that_changes_the_developer_database_fails` and
   `test_a_run_that_leaves_the_developer_database_alone_passes`.
8. ✅ `test_the_same_database_written_two_ways_is_recognised`,
   `test_the_run_refuses_to_start_on_the_developer_database`,
   `test_urls_that_could_reach_another_database_are_refused`.
9. ✅ `test_usage.test_concurrent_charges_cannot_overspend(pg_engine)`.
10. ✅ `test_invites.test_the_last_use_cannot_be_taken_twice_at_once(pg_engine)`.
11. ✅ `.env.example`, `docs/development.md`, README. CI: no PostgreSQL → 6 skips.

Review round 1: 6 findings (1 high, 1 medium, 4 low) — all fixed or
documented (the row-level limit of the after-run check, finding 4).
