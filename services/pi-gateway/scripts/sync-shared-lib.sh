#!/usr/bin/env bash
# Copies filing-section extraction/aliasing logic from the main repo's
# scripts/lib into pi-gateway's own tree. pi-gateway is deployed independently
# (deploy.sh rsyncs only services/pi-gateway/), so it cannot import across
# that boundary directly.
#
# Source of truth: scripts/lib/*.ts (repo root).
# Destination is git-ignored — always regenerated, never edited by hand.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
DEST_DIR="${SCRIPT_DIR}/../src/shared"
mkdir -p "$DEST_DIR"

for name in extract-10k-sections filing-section-aliases; do
  cp "${REPO_ROOT}/scripts/lib/${name}.ts" "${DEST_DIR}/${name}.ts"
  echo "[sync-shared-lib] ${name}.ts → services/pi-gateway/src/shared/"
done
