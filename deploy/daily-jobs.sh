#!/usr/bin/env bash
# Daily background jobs, run by the host's cron (docs/deployment.md, "cron").
#
# Today there is one: anonymising accounts withdrawn more than 30 days ago
# (app/jobs/anonymise_withdrawn.py). It is idempotent, so a missed or
# repeated day does no harm.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose -f docker-compose.prod.yml exec -T api python -m app.jobs.anonymise_withdrawn
