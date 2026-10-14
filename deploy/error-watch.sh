#!/usr/bin/env bash
# Error alerts (monitoring): look at the api and web logs since the last
# run and, if any error appeared, write ONE entry to Cloud Logging
# (log name `ctrlai-app-errors`). An alerting policy on that log name —
# set up by the owner in the console, docs/deployment.md "모니터링" —
# sends the email. Run every 5 minutes by cron.
#
#   ./deploy/error-watch.sh           # look and report
#   ./deploy/error-watch.sh --test    # write one test entry, to check the alert
#
# Uses the VM's own identity: its access scope already allows writing
# logs (logging.write), so no key is needed. Nothing is written when
# there is nothing to report. The entry carries only the count and the
# first line of up to three errors (cut to 200 characters) — never a
# whole traceback, which could hold a member's data.
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -f docker-compose.prod.yml)
state="$HOME/.ctrlai-error-watch"
log_name="ctrlai-app-errors"
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

if [ "${1:-}" = "--test" ]; then
  gcloud logging write "$log_name" \
    "테스트: 오류 알림이 제대로 오는지 확인하는 기록입니다 (deploy/error-watch.sh --test)" \
    --severity=ERROR >/dev/null
  echo "테스트 기록을 썼습니다 ($log_name). 몇 분 안에 알림 메일이 와야 합니다."
  exit 0
fi

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
since=$(cat "$state" 2>/dev/null || date -u -d '-5 minutes' +%Y-%m-%dT%H:%M:%SZ)

# What counts as an error: a Python traceback or an ERROR line from the
# api, and an error from the Next.js server. Access-log lines (", 500")
# are counted too — a 500 is an error even when nothing was logged.
pattern='Traceback \(most recent call last\)|^ERROR:|\bERROR\b.*Exception|" 5[0-9][0-9] |Error: |unhandledRejection'
errors=$("${compose[@]}" logs --no-color --no-log-prefix --since "$since" api web 2>/dev/null </dev/null \
  | grep -E "$pattern" || true)

echo "$now" > "$state"
count=$(printf '%s' "$errors" | grep -c . || true)
if [ "${count:-0}" -eq 0 ]; then
  exit 0
fi

sample=$(printf '%s\n' "$errors" | head -n 3 | cut -c1-200 | paste -sd '|' -)
gcloud logging write "$log_name" \
  "CTRL+AI 서버 오류 ${count}건 (${since} 이후): ${sample}" \
  --severity=ERROR >/dev/null
echo "$now 오류 ${count}건을 Cloud Logging에 남겼습니다."
