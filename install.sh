#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "================================================"
echo "  知拾 — 安装依赖"
echo "================================================"
echo

PY=""
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "[错误] 未找到 Python。请安装 Python 3.12（或 3.11）。"
  exit 1
fi

"$PY" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" || {
  echo "[错误] 需要 Python 3.11 或 3.12，当前版本过低。"
  "$PY" -c "import sys; print(sys.version)"
  exit 1
}

if ! command -v npm >/dev/null 2>&1; then
  echo "[错误] 未找到 npm。请安装 Node.js 20 或 22。"
  echo "       https://nodejs.org/"
  exit 1
fi

echo "[1/4] 创建虚拟环境 .venv"
if [[ ! -x .venv/bin/python ]]; then
  "$PY" -m venv .venv
else
  echo "      已存在，跳过创建"
fi

echo "[2/4] 安装 Python 依赖（必须在 backend 目录，才能找到 Tina wheel）"
echo "      含本地向量模型用的 PyTorch，默认是 CPU 版，不需要 CUDA。"
.venv/bin/python -m pip install --upgrade pip
(
  cd backend
  ../.venv/bin/python -m pip install -r requirements.txt
)

echo "[3/4] 安装前端依赖"
(
  cd frontend
  if ! npm ci; then
    echo "      npm ci 失败，改试 npm install"
    npm install
  fi
)

echo "[4/4] 准备 tina.env"
if [[ ! -f backend/tina.env ]]; then
  if [[ -f backend/tina.env.example ]]; then
    cp backend/tina.env.example backend/tina.env
    echo "      已复制 backend/tina.env.example → backend/tina.env"
    echo "      请编辑该文件，填入 LLM_API_KEY 后再启动对话功能。"
  else
    echo "      [警告] 没有 tina.env.example，请自行创建 backend/tina.env"
  fi
else
  echo "      backend/tina.env 已存在，未覆盖"
fi

echo
echo "安装完成。不需要 NVIDIA / CUDA。"
echo "下一步："
echo "  1. 编辑 backend/tina.env，填入 DeepSeek API 密钥"
echo "  2. 运行 ./start.sh 启动后端  (http://127.0.0.1:7777)"
echo "  3. 开发前端：另开终端 cd frontend && npm run dev  (http://127.0.0.1:5173)"
echo
