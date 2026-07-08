#!/usr/bin/env bash
# Copies filing-section extraction logic from the main repo's scripts/lib into
# pi-gateway's own tree. pi-gateway is deployed independently (deploy.sh rsyncs
# only services/pi-gateway/), so it cannot import across that boundary directly.
#
# Source of truth: scripts/lib/extract-10k-sections.ts (repo root).
# Destination is git-ignored — always regenerated, never edited by hand.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SRC="${REPO_ROOT}/scripts/lib/extract-10k-sections.ts"
DEST="${SCRIPT_DIR}/../src/shared/extract-10k-sections.ts"

mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"
echo "[sync-shared-lib] extract-10k-sections.ts → services/pi-gateway/src/shared/"
