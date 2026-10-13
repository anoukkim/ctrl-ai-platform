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
git pull --ff-only

echo "== 3/5 새 이미지 받기"
"${compose[@]}" pull

echo "== 4/5 데이터베이스 마이그레이션"
"${compose[@]}" run --rm api alembic upgrade head

echo "== 5/5 다시 시작"
"${compose[@]}" up -d --remove-orphans
docker image prune -f > /dev/null

"${compose[@]}" ps
echo "끝났습니다. https://$(grep -E '^SITE_DOMAIN=' .env | cut -d= -f2) 를 열어 확인하세요."
