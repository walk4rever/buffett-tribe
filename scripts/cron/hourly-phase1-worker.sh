#!/usr/bin/env bash
# Hourly Phase 1 Onboarding Batch Worker
#
# Runs every hour via crontab on mini.
# Pulls a batch of Phase 0 companies from the master universe and processes Phase 1.
#
# Usage:
#   scripts/cron/hourly-phase1-worker.sh [batch_size] [market] [extra_args...]

set -euo pipefail

BATCH_SIZE="${1:-20}"
MARKET="${2:-all}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

export PATH="/Users/rafael/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p logs

echo "=== $(date '+%Y-%m-%d %H:%M:%S') : Starting Hourly Phase 1 Worker (batch=${BATCH_SIZE}, market=${MARKET}) ==="

npm run worker:phase1 -- --batch-size "$BATCH_SIZE" --market "$MARKET" --delay 2000 --timeout-mins 35 "${@:3}"
