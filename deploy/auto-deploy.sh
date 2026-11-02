#!/usr/bin/env bash
# Deploys main by itself (feat-auto-deploy, 2026-11-02 — the owner will
# not be at a computer to run update.sh after every merge).
#
#   ./deploy/auto-deploy.sh           # from cron, every 10 minutes
#   ./deploy/auto-deploy.sh --status  # what it would do, nothing done
#
# Every 10 minutes: fetch origin/main; when the server is behind it AND
# the images workflow has published all three images for that exact
# commit (ghcr tags api/web/thumbs:<sha> — they exist only after the
# tests passed, .github/workflows/images.yml), run deploy/update.sh —
# the same backup → pull → migrate → gapless restart the owner ran by
# hand. Nothing else: a commit whose images are not there yet is left
# for the next run.
#
# Two things reach the owner by mail, through the "CTRL+AI 서버 오류"
# alert on the ctrlai-app-errors log (deploy/error-watch.sh, 6-1):
#   - a deploy that failed (update.sh exited non-zero — the site may be on
#     the old version, or a container may be unhealthy: read ~/ctrlai-autodeploy.log);
#   - a main commit older than 90 minutes whose images never appeared
#     (the build failed on GitHub, or the workflow is stuck) — once per
#     commit, not every 10 minutes.
# A deploy that worked writes only to the log; no mail.
#
# Safety: one run at a time (flock); update.sh keeps its own --ff-only and
# --wait checks; a server commit that is not an ancestor of main (someone
# deployed a branch by hand) is never overwritten — it is reported instead.
set -uo pipefail

cd "$(dirname "$0")/.."
log_file="$HOME/ctrlai-autodeploy.log"
state="$HOME/.ctrlai-auto-deploy"      # the last sha we reported as "no images"
log_name="ctrlai-app-errors"
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

env_value() { grep -E "^$1=" .env 2>/dev/null | head -n 1 | cut -d= -f2- || true; }
prefix=$(env_value IMAGE_PREFIX); prefix=${prefix:-ghcr.io/anoukkim/ctrl-ai-platform}

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$log_file"; }
report() {  # report MESSAGE — one line to Cloud Logging → the alert mails it
  log "알림: $*"
  gcloud logging write "$log_name" "CTRL+AI 자동 배포: $*" --severity=ERROR >/dev/null 2>&1 || true
}

# One at a time. A second run while update.sh is going just leaves.
exec 9>"$HOME/.ctrlai-auto-deploy.lock"
flock -n 9 || exit 0

if ! git fetch -q origin main; then
  log "git fetch 실패"
  exit 0  # the network blips; the next run tries again
fi
head=$(git rev-parse HEAD)
want=$(git rev-parse origin/main)

if [ "$head" = "$want" ]; then
  [ "${1:-}" = "--status" ] && echo "최신이에요 ($head)."
  exit 0
fi

if ! git merge-base --is-ancestor "$head" "$want"; then
  msg="서버의 커밋 ${head:0:7}이 main 위에 없어요 — 손으로 배포된 상태라 건드리지 않았어요"
  [ "${1:-}" = "--status" ] && { echo "$msg"; exit 0; }
  [ "$(cat "$state" 2>/dev/null)" = "$head" ] || { report "$msg"; echo "$head" > "$state"; }
  exit 0
fi

# All three images for exactly this commit must be there.
missing=""
for service in api web thumbs; do
  docker manifest inspect "$prefix-$service:$want" >/dev/null 2>&1 || missing="$missing $service"
done
if [ -n "$missing" ]; then
  age=$(( $(date +%s) - $(git show -s --format=%ct "$want") ))
  if [ "${1:-}" = "--status" ]; then
    echo "main ${want:0:7} 의 이미지가 아직 없어요 (없는 것:$missing, 커밋 $((age / 60))분 전)."
    exit 0
  fi
  if [ "$age" -gt 5400 ] && [ "$(cat "$state" 2>/dev/null)" != "$want" ]; then
    report "main ${want:0:7} 가 $((age / 60))분 전인데 이미지가 없어요 (없는 것:$missing) — GitHub Actions의 images 빌드를 보세요"
    echo "$want" > "$state"
  fi
  exit 0
fi

if [ "${1:-}" = "--status" ]; then
  echo "배포할 수 있어요: ${head:0:7} → ${want:0:7} (이미지 3개 있음)."
  exit 0
fi

log "배포 시작 ${head:0:7} → ${want:0:7}"
if ./deploy/update.sh >> "$log_file" 2>&1; then
  log "배포 끝 $(git rev-parse --short HEAD)"
else
  report "배포 실패 ${head:0:7} → ${want:0:7} — 서버에서 tail -50 ~/ctrlai-autodeploy.log, dc ps, dc logs api (docs/deployment.md 12단계)"
fi
