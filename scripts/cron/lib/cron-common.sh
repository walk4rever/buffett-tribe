#!/usr/bin/env bash
# Shared cron helpers. Source this file after REPO_DIR is set.

: "${REPO_DIR:?REPO_DIR must be set before sourcing cron-common.sh}"

CRON_LOCK_ROOT="${REPO_DIR}/.cache/cron-locks"
CRON_DATA_LOCK_DIR="${CRON_LOCK_ROOT}/data-maintenance.lock"
CRON_LOCK_OWNED=0

_cron_lock_pid() {
  cat "${CRON_DATA_LOCK_DIR}/pid" 2>/dev/null || true
}

acquire_maintenance_lock() {
  local wait_seconds="${1:-0}"
  local waited=0
  local pid

  mkdir -p "$CRON_LOCK_ROOT"

  while :; do
    if mkdir "$CRON_DATA_LOCK_DIR" 2>/dev/null; then
      echo $$ > "${CRON_DATA_LOCK_DIR}/pid"
      CRON_LOCK_OWNED=1
      return 0
    fi

    pid="$(_cron_lock_pid)"
    if [ -z "$pid" ]; then
      sleep 1
      pid="$(_cron_lock_pid)"
    fi

    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
      rm -rf "$CRON_DATA_LOCK_DIR"
      continue
    fi

    if [ "$waited" -ge "$wait_seconds" ]; then
      echo "[lock] data-maintenance held by PID ${pid}; waited ${waited}s; giving up"
      return 1
    fi

    sleep 5
    waited=$((waited + 5))
  done
}

release_maintenance_lock() {
  if [ "${CRON_LOCK_OWNED:-0}" = "1" ]; then
    rm -rf "$CRON_DATA_LOCK_DIR"
    CRON_LOCK_OWNED=0
  fi
}

cron_finish() {
  local exit_code=$?
  release_maintenance_lock
  echo "=== END $(date -Iseconds) status=${exit_code} ==="
}
