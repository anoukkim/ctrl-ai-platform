#!/usr/bin/env bash
# Back up the CTRL+AI database to ~/backups/ctrlai-<UTC date-time>.sql.gz.
#
#   ./deploy/backup.sh
#
# Run before every update (deploy/update.sh does it for you). The file is
# then copied OFF the VM — see docs/deployment.md, "백업". A backup that only
# lives on the same disk is lost together with that disk.
#
# The dump is plain SQL with DROP ... IF EXISTS in front of every object,
# so restoring it replaces what is there (docs/deployment.md, "복원").
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -f docker-compose.prod.yml)

mkdir -p "$HOME/backups"
chmod 700 "$HOME/backups"
file="$HOME/backups/ctrlai-$(date -u +%Y%m%d-%H%M%S).sql.gz"

"${compose[@]}" exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  | gzip > "$file"
chmod 600 "$file"

# A dump of an empty or unreachable database is a few bytes; refuse to call
# that a backup.
if [ "$(gzip -dc "$file" | wc -c)" -lt 1000 ]; then
  echo "백업 파일이 너무 작습니다. 데이터베이스가 켜져 있는지 확인하세요: $file" >&2
  exit 1
fi

echo "백업 완료: $file ($(du -h "$file" | cut -f1))"

# Tell Admin › System (admin-consolidation v3 (4)). Only the file's name and
# size go in; a failure here never fails the backup.
"${compose[@]}" exec -T api python -m app.db.record_backup local "$(basename "$file")" "$(stat -c %s "$file")" >/dev/null 2>&1 \
  || echo "(Admin에 백업 기록을 남기지 못했습니다 — 백업 파일은 그대로 있습니다)"
