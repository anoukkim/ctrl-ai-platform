#!/usr/bin/env bash
# The monthly restore test (offsite-backups): prove a backup restores,
# WITHOUT touching the live database.
#
#   ./deploy/restore-test.sh            # the newest file in ~/backups
#   ./deploy/restore-test.sh bucket     # the newest copy in the bucket
#
# Restores into a throwaway PostgreSQL container (no published port, no
# volume, removed at the end), then compares a few row counts with the
# live database. Prints 복원 시험 통과 / 실패. docs/deployment.md, "복원 시험".
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -f docker-compose.prod.yml)
work=$(mktemp -d)
container="ctrlai-restore-test-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

if [ "${1:-}" = "bucket" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.ctrlai-offsite"
  export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="$BACKUP_KEY_FILE"
  export CLOUDSDK_CORE_DISABLE_PROMPTS=1
  newest=$(gcloud storage ls "gs://${BACKUP_BUCKET}/db/" | sort | tail -n 1)
  [ -n "$newest" ] || { echo "버킷에 백업이 없습니다." >&2; exit 1; }
  gcloud storage cp "$newest" "$work/backup.sql.gz" >/dev/null
  source_name="$newest"
else
  latest=$(ls -1t "$HOME"/backups/ctrlai-*.sql.gz | head -n 1)
  cp "$latest" "$work/backup.sql.gz"
  source_name="$latest"
fi
echo "시험할 백업: $source_name"

docker run -d --name "$container" -e POSTGRES_PASSWORD=restore-test \
  -e POSTGRES_USER=ctrlai -e POSTGRES_DB=ctrlai postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$container" pg_isready -U ctrlai -d ctrlai >/dev/null 2>&1 && break
  sleep 1
done

gunzip -c "$work/backup.sql.gz" \
  | docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U ctrlai -d ctrlai >/dev/null

count_sql="select (select count(*) from users) || ' ' || (select count(*) from usage_events) || ' ' || (select count(*) from builder_projects) || ' ' || (select version_num from alembic_version)"
restored=$(docker exec "$container" psql -At -U ctrlai -d ctrlai -c "$count_sql")
live=$("${compose[@]}" exec -T db sh -c "psql -At -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"$count_sql\"" </dev/null)

echo "복원본  (회원 · 사용 기록 · 프로젝트 · 스키마): $restored"
echo "지금 DB (회원 · 사용 기록 · 프로젝트 · 스키마): $live"
read -r r_users r_events r_projects r_schema <<<"$restored"
read -r l_users l_events l_projects l_schema <<<"$live"
# The live database may have grown since the backup; it must not have less,
# and the schema must be the same or the backup is from before a migration.
if [ "$r_users" -le "$l_users" ] && [ "$r_events" -le "$l_events" ] \
  && [ "$r_projects" -le "$l_projects" ] && [ "$r_users" -gt 0 ]; then
  echo "복원 시험 통과 — 백업이 복원되고, 내용이 지금 데이터와 맞습니다."
  [ "$r_schema" = "$l_schema" ] || echo "(참고: 백업의 스키마 $r_schema, 지금 $l_schema — 복원 뒤 'dc run --rm api alembic upgrade head'가 필요합니다.)"
else
  echo "복원 시험 실패 — 위 숫자를 확인하세요." >&2
  exit 1
fi
