#!/usr/bin/env bash
# Redeploy after an item is merged into main and GitHub Actions has built
# the new images (the "images" workflow shows a green check).
#
#   ./deploy/update.sh
#
# 1. back up the database   2. fetch the new compose/Caddy files
# 3. pull the new images    4. migrate the database   5. restart
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -f docker-compose.prod.yml)

echo "== 1/5 데이터베이스 백업"
./deploy/backup.sh

echo "== 2/5 저장소 업데이트 (git pull)"
before=$(git rev-parse HEAD)
git pull --ff-only
# The Caddyfile is bind-mounted as a single file. `git pull` replaces it
# with a new file, and the running caddy keeps reading the old one, so a
# changed Caddyfile needs caddy recreated (found 2026-10-14, add-on D).
caddyfile_changed=false
if ! git diff --quiet "$before" HEAD -- deploy/Caddyfile; then
  caddyfile_changed=true
fi

echo "== 3/5 새 이미지 받기"
"${compose[@]}" pull

echo "== 4/5 데이터베이스 마이그레이션"
# A migration gives up after a few seconds when a table is busy (a Builder
# run going; backend/alembic/env.py, lock_timeout) instead of holding up
# the whole site — and is tried again here, for about 5 minutes.
migrated=false
for attempt in $(seq 1 30); do
  if "${compose[@]}" run --rm api alembic upgrade head; then
    migrated=true
    break
  fi
  echo "   표가 사용 중이라 마이그레이션을 다시 시도합니다 ($attempt/30)"
  sleep 10
done
if [ "$migrated" != true ]; then
  echo "마이그레이션을 끝내지 못했어요. 사이트는 그대로 예전 버전으로 돌아가요." >&2
  exit 1
fi

echo "== 5/5 다시 시작"
"${compose[@]}" up -d --remove-orphans
if [ "$caddyfile_changed" = true ]; then
  echo "   Caddyfile가 바뀌어 caddy를 다시 만듭니다"
  "${compose[@]}" up -d --force-recreate caddy
fi
# compose can leave a container on the old image when `latest` moved to a
# new image id with the same content (seen 2026-10-14 with an unchanged
# frontend). Make sure api and web run exactly the image just pulled.
# thumbs (thumbnail-render-worker) only runs with COMPOSE_PROFILES=thumbs
# in .env; without the profile `ps -q thumbs` is empty and it is skipped.
for service in api web thumbs; do
  want=$(docker image inspect --format '{{.Id}}' "$("${compose[@]}" config --images | grep -- "-$service:" | head -n 1)" 2>/dev/null || true)
  have=$(docker inspect --format '{{.Image}}' "$("${compose[@]}" ps -q "$service")" 2>/dev/null || true)
  if [ -n "$want" ] && [ "$want" != "$have" ]; then
    echo "   $service가 새 이미지로 바뀌지 않아 다시 만듭니다"
    "${compose[@]}" up -d --force-recreate "$service"
  fi
done
docker image prune -f > /dev/null

"${compose[@]}" ps
echo "끝났습니다. https://$(grep -E '^SITE_DOMAIN=' .env | cut -d= -f2) 를 열어 확인하세요."
