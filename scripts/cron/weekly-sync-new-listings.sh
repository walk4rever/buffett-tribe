#!/usr/bin/env bash
# Weekly Sync of New Listings (CN A-shares, HK stocks, US stocks)
#
# Runs every Saturday morning via crontab on mini.
# Fetches the latest active exchange listings from:
#   1. CN A-shares via akshare (SSE, SZSE, BSE)
#   2. HK stocks via akshare (HKEX)
#   3. US stocks via SEC EDGAR company_tickers_exchange.json
#
# Detects newly listed IPOs / newly listed companies and inserts them into
# Entity table as onboardPhase: 0, adding them to the general universe pool
# for the hourly priority worker to discover and onboard.
#
# Usage:
#   scripts/cron/weekly-sync-new-listings.sh [--dry-run]

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

export PATH="/Users/rafael/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p logs data

PY="python3"
if [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
fi

echo "======================================================="
echo "=== $(date '+%Y-%m-%d %H:%M:%S') : Starting Weekly New Listings Sync ==="
echo "======================================================="

# Step 1: Fetch latest CN A-shares catalog
echo ""
echo "[1/3] Fetching latest CN A-shares catalog via akshare..."
"$PY" scripts/fetch-all-a-stocks.py --out data/all-a-share-stocks.json

# Step 2: Fetch latest HK stocks catalog
echo ""
echo "[2/3] Fetching latest HK stocks catalog via akshare..."
"$PY" scripts/fetch-all-hk-stocks.py --out data/all-hk-stocks.json

# Step 3: Run master universe sync (fetches US directly from SEC and diffs CN/HK/US)
echo ""
echo "[3/3] Syncing new listings into database (Entity onboardPhase: 0)..."
npm run seed:master-universe -- "$@"

echo ""
echo "=== $(date '+%Y-%m-%d %H:%M:%S') : Weekly New Listings Sync Complete ==="
echo "======================================================="
