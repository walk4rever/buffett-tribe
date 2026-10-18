#!/usr/bin/env bash
# Weekly FX refresh, invoked by mini crontab (see CRON.md).
#
# Runs after the Sunday US stock-price update and before the Monday 03:15
# hourly onboarding batch. Refreshes only the currencies needed by registered
# company reporting/trading currency pairs.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

export PATH="/Users/rafael/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
mkdir -p .cache

PID_FILE=".cache/update-fx-rates.pid"
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[$(date -Iseconds)] FX refresh already running with PID ${OLD_PID}. Exiting."
    exit 0
  fi
  echo "[$(date -Iseconds)] Removing stale FX PID file (${OLD_PID:-empty})."
  rm -f "$PID_FILE"
fi

echo $$ > "$PID_FILE"

fx_finish() {
  local exit_code=$?
  rm -f "$PID_FILE"
  echo "=== END $(date -Iseconds) status=${exit_code} ==="
}
trap fx_finish EXIT

echo "=== $(date -Iseconds) : refreshing latest FX rates ==="
node --env-file=.env.local ./node_modules/.bin/tsx scripts/update-fx-rates.ts
echo "=== $(date -Iseconds) : FX refresh complete ==="
