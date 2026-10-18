#!/usr/bin/env bash
# Hourly Priority & Onboarding Batch Worker
#
# Runs every hour via crontab on mini.
# Pulls priority fast-track companies, then balances remaining slots from standard pool
# (~10 P0->P1 base profiling + ~5 P1->P2 deep analysis, balanced across US, HK, and CN).
#
# Usage:
#   scripts/cron/hourly-priority-worker.sh [batch_size] [market] [extra_args...]

set -euo pipefail

BATCH_SIZE="${1:-15}"
MARKET="${2:-all}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

source "$REPO_DIR/scripts/cron/lib/cron-common.sh"
trap cron_finish EXIT

export PATH="/Users/rafael/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p logs .cache

if maintenance_lock_live; then
  echo "[$(date -Iseconds)] Deferred: data-maintenance is running."
  exit 2
fi

PID_FILE=".cache/pipeline-priority-worker.pid"
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[$(date -Iseconds)] Worker is already running with PID ${OLD_PID}. Exiting to prevent overlap."
    exit 2
  else
    echo "[$(date -Iseconds)] Found stale PID file (${OLD_PID:-empty} is dead). Removing ${PID_FILE}."
    rm -f "$PID_FILE"
  fi
fi

echo "=== $(date -Iseconds) : Starting Hourly Priority Worker (batch=${BATCH_SIZE}, market=${MARKET}) ==="

npm run worker:priority -- --batch-size "$BATCH_SIZE" --market "$MARKET" --delay 1000 --timeout-mins 48 "${@:3}"

