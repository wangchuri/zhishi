#!/bin/sh
set -e

# 若未挂载 tina.env，则用环境变量生成（勿把密钥打进镜像）
TINA_ENV="${TINA_ENV_PATH:-/app/backend/tina.env}"
if [ ! -f "$TINA_ENV" ]; then
  if [ -z "${LLM_API_KEY:-}" ]; then
    echo "警告: 未找到 $TINA_ENV，且未设置 LLM_API_KEY；对话等 LLM 功能将不可用。" >&2
  else
    umask 077
    cat > "$TINA_ENV" <<EOF
LLM_API_KEY=${LLM_API_KEY}
BASE_URL=${BASE_URL:-https://api.deepseek.com/chat/completions}
MODEL_NAME=${MODEL_NAME:-deepseek-v4-flash}
EOF
    echo "已根据环境变量写入 $TINA_ENV"
  fi
fi

mkdir -p /app/data /app/backend/storage /app/backend/storage/images

exec "$@"
