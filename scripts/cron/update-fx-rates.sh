#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

echo "=== $(date -Iseconds) : refreshing latest FX rates ==="
npx tsx scripts/update-fx-rates.ts
