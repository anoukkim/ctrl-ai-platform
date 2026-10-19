#!/usr/bin/env bash
# Daily background jobs, run by the host's cron (docs/deployment.md, "cron").
#
# 1. A database backup (deploy/backup.sh), and its copy off the VM to the
#    Cloud Storage bucket (deploy/offsite-backup.sh — skipped, with a note,
#    until the owner has set the bucket up). The last 14 local backups are
#    kept; the bucket keeps 30 days by its lifecycle rule (offsite-backups).
# 2. Anonymising accounts withdrawn more than 30 days ago
#    (app/jobs/anonymise_withdrawn.py).
# 3. Today's USD→KRW rate from the configured source (app/jobs/refresh_fx.py,
#    owner-polish-3): applied under the 5% rule, or held back with a note in
#    Admin › System; a failed fetch keeps the last rate.
#
# Every step is idempotent, so a missed or repeated day does no harm. A
# failed backup does not stop the anonymising job, but the script still
# exits non-zero so the failure shows in the log.
set -uo pipefail

cd "$(dirname "$0")/.."
echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ)"
status=0

backup_ok=true
./deploy/backup.sh || { status=1; backup_ok=false; }
if [ "$status" -eq 0 ]; then
  ./deploy/offsite-backup.sh || { status=1; backup_ok=false; }
fi
# Local copies: the newest 14 stay on the VM.
ls -1t "$HOME"/backups/ctrlai-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --

failed=()
docker compose -f docker-compose.prod.yml exec -T api python -m app.jobs.anonymise_withdrawn || { status=1; failed+=("탈퇴 계정 익명화"); }
docker compose -f docker-compose.prod.yml exec -T api python -m app.jobs.refresh_fx || { status=1; failed+=("환율 갱신"); }

# A failure used to reach only ~/ctrlai-jobs.log, which nobody reads
# (fix-stream-db-sessions audit, 2026-10-19). Write one line to the same
# Cloud Logging name error-watch.sh uses, so the "CTRL+AI 서버 오류" alert
# mails it. A failure to write it never hides the job's own exit code.
if [ "$status" -ne 0 ]; then
  [ "$backup_ok" = true ] || failed=("백업" ${failed[@]+"${failed[@]}"})
  CLOUDSDK_CORE_DISABLE_PROMPTS=1 gcloud logging write ctrlai-app-errors \
    "CTRL+AI 매일 작업 실패: ${failed[*]+"${failed[*]}"} — 서버의 ~/ctrlai-jobs.log를 보세요" \
    --severity=ERROR >/dev/null 2>&1 || echo "(Cloud Logging에 실패를 남기지 못했습니다)"
fi

exit "$status"
