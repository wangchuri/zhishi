#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -x .venv/bin/python ]]; then
  echo "[错误] 未找到 .venv。请先在仓库根目录运行 ./install.sh"
  exit 1
fi

echo "知拾后端  http://127.0.0.1:7777"
echo "开发前端请另开终端:  cd frontend && npm run dev"
echo
cd backend
exec ../.venv/bin/python -m src.main
