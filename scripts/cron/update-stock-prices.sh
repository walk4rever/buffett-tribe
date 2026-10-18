#!/usr/bin/env bash
# Weekly StockPrice update, invoked by mini crontab (see CRON.md for the
# registered schedule). Runs the same authoritative entry point as
# manual/local usage (npm run import:company-stock-prices:yf), just scoped to
# one market group. No --start is passed: the script resolves each ticker's
# own resume date from its last stored StockPrice row, so a ticker that's been
# stale for months still gets fully caught up instead of only the last N days.
#
# Usage: update-stock-prices.sh <market-list>   e.g. "cn,hk" or "us"
set -euo pipefail

MARKETS="${1:?market list required, e.g. cn,hk or us}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

source "$REPO_DIR/scripts/cron/lib/cron-common.sh"
trap cron_finish EXIT

if ! acquire_maintenance_lock 300; then
  echo "Deferred: data-maintenance lock is busy."
  exit 2
fi

CHECKPOINT_SUFFIX="$(echo "$MARKETS" | tr ',' '-')"

echo "=== $(date -Iseconds) : updating stock prices for market(s)=$MARKETS ==="

npm run import:company-stock-prices:yf -- \
  --market "$MARKETS" \
  --checkpoint-file ".cache/stock-prices-yf/checkpoints-${CHECKPOINT_SUFFIX}.json"
