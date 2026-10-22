#!/usr/bin/env bash
# Redeploy after an item is merged into main and GitHub Actions has built
# the new images (the "images" workflow shows a green check).
#
#   ./deploy/update.sh
#
# 1. back up the database   2. fetch the new compose/Caddy files
# 3. pull the new images    4. migrate the database   5. restart
#
# Step 5 is gapless for members (chore-gapless-deploy, 2026-10-22): api is
# replaced on its own while the old web keeps serving pages, then web while
# the new api answers; caddy holds a request for the seconds a container is
# away (deploy/Caddyfile, lb_try_duration) and only shows the 503 page
# (deploy/maintenance.html) when the hold runs out. Every `up` carries
# --wait, so a container that never gets healthy fails this script instead
# of a false 끝났습니다 — the old containers are already gone by then, so
# read `dc ps` and `dc logs api` (or web) and fix forward, or roll back
# with IMAGE_TAG= as docs/deployment.md § 9 says.
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -f docker-compose.prod.yml)
# Enough for api's imports plus its first probe (healthy ~6 s after start
# on the e2-medium) and web's; a container still not healthy after this is
# broken, not slow.
up=("${compose[@]}" up -d --wait --wait-timeout 120)

env_value() {  # env_value NAME — the value of NAME in .env (empty if unset)
  grep -E "^$1=" .env | head -n 1 | cut -d= -f2- || true
}

echo "== 1/5 데이터베이스 백업"
./deploy/backup.sh

echo "== 2/5 저장소 업데이트 (git pull)"
before=$(git rev-parse HEAD)
git pull --ff-only
# deploy/ is bind-mounted as a directory, so the running caddy can read a
# changed Caddyfile; it is reloaded (no restart, no gap) at the end of
# step 5. Validate it NOW, before anything is touched: a Caddyfile with a
# mistake must never take the site down. The check runs in a throwaway
# container of the same image, with only the two values the file uses.
caddyfile_changed=false
if ! git diff --quiet "$before" HEAD -- deploy/Caddyfile; then
  caddyfile_changed=true
  echo "   Caddyfile가 바뀌었어요 — 먼저 검사합니다"
  max_upload=$(env_value MAX_UPLOAD_MB)
  if ! docker run --rm -v "$PWD/deploy:/etc/caddy:ro" \
      -e "SITE_DOMAIN=$(env_value SITE_DOMAIN)" \
      -e "MAX_UPLOAD_MB=${max_upload:-20}" \
      caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    echo "Caddyfile에 오류가 있어요. 아직 아무것도 바꾸지 않았습니다 — 고친 뒤 다시 ./deploy/update.sh" >&2
    exit 1
  fi
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
# One service at a time, in the order the requests flow. `up api` touches
# api alone (--no-deps: db is running and is not re-checked); the old web
# keeps serving pages meanwhile and caddy holds /api/* requests until the
# new api answers. Then web, while the new api is already healthy. A full
# `up` of everything at once removes BOTH old containers before the new
# api is up — about 9 s with nothing listening (measured 2026-10-22).
echo "   api"
"${up[@]}" --no-deps api
echo "   web"
"${up[@]}" web
# Everything else: a changed db/caddy/thumbs definition, an orphan from a
# removed service. Nothing happens here on an ordinary deploy.
"${up[@]}" --remove-orphans
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
    "${up[@]}" --no-deps --force-recreate "$service"
  fi
done
if [ "$caddyfile_changed" = true ]; then
  # Validated in step 2. `caddy reload` swaps the configuration inside the
  # running process: open connections finish, the certificate stays, and
  # nothing is unreachable for even a moment. If the reload fails anyway
  # (an old caddy container that still mounts the single file, say), fall
  # back to recreating caddy — the one case with a short gap.
  echo "   Caddyfile가 바뀌어 caddy를 다시 읽게 합니다"
  if ! "${compose[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
    echo "   다시 읽기에 실패해 caddy를 다시 만듭니다"
    "${up[@]}" --force-recreate caddy
  fi
fi
docker image prune -f > /dev/null

"${compose[@]}" ps
echo "끝났습니다. https://$(env_value SITE_DOMAIN) 를 열어 확인하세요."
