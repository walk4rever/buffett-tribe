#!/usr/bin/env bash
# Deploy the buffett-tribe repo checkout used to run scheduled jobs on air7.
# This is a shared home for cron jobs (stock-price update today, more later) —
# not a standalone service like services/pi-gateway/deploy.sh. The wrapper
# scripts each job's crontab entry calls live in scripts/cron/ and are synced
# as part of this same checkout.
#
# Usage: ./scripts/deploy-cron-job.sh [--skip-install]
set -euo pipefail

REMOTE="air7"
REMOTE_DIR="/root/cron-job-buffett-tribe"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SKIP_INSTALL=false
for arg in "$@"; do
  [[ "$arg" == "--skip-install" ]] && SKIP_INSTALL=true
done

echo "→ Syncing repo to ${REMOTE}:${REMOTE_DIR} ..."
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.next' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.venv' \
  --exclude='.cache' \
  "${REPO_ROOT}/" "${REMOTE}:${REMOTE_DIR}/"

if [[ "$SKIP_INSTALL" == false ]]; then
  echo "→ Installing dependencies ..."
  ssh "$REMOTE" "cd ${REMOTE_DIR} && npm install"

  echo "→ Generating Prisma client ..."
  ssh "$REMOTE" "cd ${REMOTE_DIR} && npx prisma generate"

  echo "→ Ensuring python venv + yfinance + edgartools ..."
  ssh "$REMOTE" "cd ${REMOTE_DIR} && ( [ -x .venv/bin/python ] || python3 -m venv .venv ) && .venv/bin/pip install -q yfinance -r requirements-edgartools.txt"
fi

echo "→ Making cron wrapper scripts executable ..."
ssh "$REMOTE" "chmod +x ${REMOTE_DIR}/scripts/cron/*.sh"

echo ""
echo "✓ Deploy complete."
echo "  Remember: ${REMOTE_DIR}/.env.local (DATABASE_URL/DIRECT_URL) is not synced by rsync — place it manually on ${REMOTE}."
