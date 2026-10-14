#!/usr/bin/env bash
# Daily background jobs, run by the host's cron (docs/deployment.md, "cron").
#
# 1. A database backup (deploy/backup.sh), and its copy off the VM to the
#    Cloud Storage bucket (deploy/offsite-backup.sh — skipped, with a note,
#    until the owner has set the bucket up). The last 14 local backups are
#    kept; the bucket keeps 30 days by its lifecycle rule (offsite-backups).
# 2. Anonymising accounts withdrawn more than 30 days ago
#    (app/jobs/anonymise_withdrawn.py).
#
# Every step is idempotent, so a missed or repeated day does no harm. A
# failed backup does not stop the anonymising job, but the script still
# exits non-zero so the failure shows in the log.
set -uo pipefail

cd "$(dirname "$0")/.."
echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ)"
status=0

./deploy/backup.sh || status=1
if [ "$status" -eq 0 ]; then
  ./deploy/offsite-backup.sh || status=1
fi
# Local copies: the newest 14 stay on the VM.
ls -1t "$HOME"/backups/ctrlai-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --

docker compose -f docker-compose.prod.yml exec -T api python -m app.jobs.anonymise_withdrawn || status=1

exit "$status"
