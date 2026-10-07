"""Scheduled jobs.

Each job is a module with a `run(db)` function and a `__main__` entry
point, so it is started from outside the web server:

    python -m app.jobs.anonymise_withdrawn

Deliberately not a scheduler inside the app. Something running inside
uvicorn would run once per worker, and not at all while the server is
down or scaled to zero. A job run from cron locally — and from Cloud
Scheduler in Phase 9 — runs once, whenever it is due, and is safe to run
again: every job here must be idempotent.
"""
