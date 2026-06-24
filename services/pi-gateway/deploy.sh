#!/usr/bin/env bash
# Deploy pi-gateway to air7.
# Usage: ./deploy.sh [--restart-only]
# Run from anywhere inside the buffett-tribe repo.

set -euo pipefail

REMOTE="air7"
REMOTE_DIR="/root/pi-gateway"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --restart-only: skip file sync, just restart PM2
RESTART_ONLY=false
for arg in "$@"; do
  [[ "$arg" == "--restart-only" ]] && RESTART_ONLY=true
done

if [[ "$RESTART_ONLY" == false ]]; then
  echo "→ Syncing files to ${REMOTE}:${REMOTE_DIR} ..."
  rsync -az --delete \
    --exclude='node_modules' \
    --exclude='.env' \
    --exclude='*.log' \
    "${SCRIPT_DIR}/" "${REMOTE}:${REMOTE_DIR}/"

  echo "→ Installing dependencies ..."
  ssh "$REMOTE" "cd ${REMOTE_DIR} && npm install --omit=dev --ignore-scripts"
fi

echo "→ Restarting pi-gateway via PM2 ..."
ssh "$REMOTE" "pm2 restart pi-gateway --update-env"

echo "→ Status:"
ssh "$REMOTE" "pm2 show pi-gateway | grep -E 'status|uptime|restarts|pid'"

echo ""
echo "✓ Deploy complete."
