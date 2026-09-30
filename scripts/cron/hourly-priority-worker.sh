#!/usr/bin/env bash
# Hourly Priority & Onboarding Batch Worker
#
# Runs every hour via crontab on mini.
# Pulls priority fast-track companies, then balances remaining slots from standard pool
# (50% P1->P2 deep analysis + 50% P0->P1 base profiling, balanced across US, HK, and CN).
#
# Usage:
#   scripts/cron/hourly-priority-worker.sh [batch_size] [market] [extra_args...]

set -euo pipefail

BATCH_SIZE="${1:-10}"
MARKET="${2:-all}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

export PATH="/Users/rafael/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p logs

echo "=== $(date '+%Y-%m-%d %H:%M:%S') : Starting Hourly Priority Worker (batch=${BATCH_SIZE}, market=${MARKET}) ==="

npm run worker:priority -- --batch-size "$BATCH_SIZE" --market "$MARKET" --delay 2000 --timeout-mins 35 "${@:3}"
