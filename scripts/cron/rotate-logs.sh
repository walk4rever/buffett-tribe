#!/usr/bin/env bash
# Weekly log rotation. Keeps the active file in place and compresses older
# content into logs/buffett-tribe/archive/.
set -euo pipefail

LOG_DIR="${LOG_DIR:-/Users/rafael/logs/buffett-tribe}"
ARCHIVE_DIR="${ARCHIVE_DIR:-${LOG_DIR}/archive}"
MAX_BYTES="${MAX_BYTES:-10485760}"
KEEP_DAYS="${KEEP_DAYS:-28}"
LOCK_DIR="${LOG_DIR}/.rotate-logs.lock"

mkdir -p "$ARCHIVE_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  old_pid="$(cat "${LOCK_DIR}/pid" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    echo "rotate-logs already running with PID ${old_pid}"
    exit 0
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo $$ > "${LOCK_DIR}/pid"

rotate_finish() {
  local exit_code=$?
  rm -rf "$LOCK_DIR"
  echo "=== END $(date -Iseconds) status=${exit_code} ==="
}
trap rotate_finish EXIT

echo "=== START $(date -Iseconds) ==="

for file in "$LOG_DIR"/*.log; do
  [ -f "$file" ] || continue
  [ "$(basename "$file")" = "rotate-logs.log" ] && continue

  size="$(stat -f%z "$file")"
  if [ "$size" -le "$MAX_BYTES" ]; then
    continue
  fi

  base="$(basename "$file" .log)"
  stamp="$(date +%Y%m%d-%H%M%S)"
  archive="${ARCHIVE_DIR}/${base}-${stamp}.log.gz"

  echo "Rotating ${file} (${size} bytes) -> ${archive}"
  gzip -c "$file" > "$archive"
  : > "$file"
done

find "$ARCHIVE_DIR" -type f -name '*.log.gz' -mtime +"$KEEP_DAYS" -delete
echo "=== COMPLETE $(date -Iseconds) ==="
