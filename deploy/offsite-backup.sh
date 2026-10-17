#!/usr/bin/env bash
# Copy the newest database backup OFF the VM, to a Cloud Storage bucket
# in Seoul (offsite-backups). Run daily by deploy/daily-jobs.sh.
#
#   ./deploy/offsite-backup.sh
#
# Settings live in ~/.ctrlai-offsite (chmod 600), written once by the owner
# (docs/deployment.md, "백업을 서버 밖으로"):
#
#   BACKUP_BUCKET=ctrlai-backups-xxxx          # the bucket's name, no gs://
#   BACKUP_KEY_FILE=/home/ctrlai_platform/.config/ctrlai-backup-key.json
#
# The key belongs to a service account that may only create and read
# objects in that one bucket. The VM's own account cannot write to
# Cloud Storage (its access scope is read-only), which is why a key is
# used instead of the VM's identity. The bucket's lifecycle rule deletes
# copies after 30 days.
#
# Without ~/.ctrlai-offsite this says so and exits 0, so the daily jobs
# keep running before the bucket exists.
set -euo pipefail

config="$HOME/.ctrlai-offsite"
if [ ! -f "$config" ]; then
  echo "오프사이트 백업이 아직 설정되지 않았습니다 ($config 없음). 건너뜁니다."
  exit 0
fi
# shellcheck disable=SC1090
. "$config"
: "${BACKUP_BUCKET:?BACKUP_BUCKET이 $config 에 없습니다}"
: "${BACKUP_KEY_FILE:?BACKUP_KEY_FILE이 $config 에 없습니다}"
if [ ! -r "$BACKUP_KEY_FILE" ]; then
  echo "서비스 계정 키를 읽을 수 없습니다: $BACKUP_KEY_FILE" >&2
  exit 1
fi

latest=$(ls -1t "$HOME"/backups/ctrlai-*.sql.gz 2>/dev/null | head -n 1 || true)
if [ -z "$latest" ]; then
  echo "올릴 백업 파일이 없습니다 (~/backups)." >&2
  exit 1
fi

name=$(basename "$latest")
target="gs://${BACKUP_BUCKET}/db/${name}"

# The key is used for these two commands only; the VM's own gcloud login
# is left as it is.
export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="$BACKUP_KEY_FILE"
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

if gcloud storage ls "$target" >/dev/null 2>&1; then
  echo "이미 올라가 있습니다: $target"
  exit 0
fi
gcloud storage cp --no-clobber "$latest" "$target" >/dev/null
# Read it back: a copy that is not there is not a backup.
size=$(gcloud storage ls -l "$target" | awk 'NR==1 {print $1}')
local_size=$(stat -c %s "$latest")
if [ "$size" != "$local_size" ]; then
  echo "올린 파일의 크기가 다릅니다 (서버 $local_size, 버킷 $size): $target" >&2
  exit 1
fi
echo "서버 밖 백업 완료: $target ($local_size bytes)"

# Tell Admin › System (admin-consolidation v3 (4)); never fails the upload.
(cd "$(dirname "$0")/.." && docker compose -f docker-compose.prod.yml exec -T api \
  python -m app.db.record_backup offsite "$name" "$local_size" >/dev/null 2>&1) \
  || echo "(Admin에 백업 기록을 남기지 못했습니다 — 버킷의 파일은 그대로 있습니다)"
