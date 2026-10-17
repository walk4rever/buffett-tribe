#!/usr/bin/env bash
# [DEPRECATED] Delegated to scripts/cron/hourly-priority-worker.sh
# Kept for backward compatibility with older crontab entries.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/hourly-priority-worker.sh" "$@"

