#!/usr/bin/env bash
# 本地冒烟测试 — 先确保 npm run dev 已在另一个终端启动
set -e

BASE="http://localhost:3456"
SECRET="local-test-secret"

echo "=== /health ==="
curl -sf "$BASE/health" | python3 -m json.tool

echo ""
echo "=== /chat (SSE stream) ==="
curl -N -s \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Secret: $SECRET" \
  -d '{"message": "巴菲特在哪封信里谈到了护城河的概念？"}' \
  --max-time 60
