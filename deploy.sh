#!/usr/bin/env bash
# 知拾部署脚本：从 GitHub 拉最新代码 → 编译前端 → 重启服务
#
# 用法：sudo ./deploy.sh
#
# 前置：/srv/zhishi 已是 git clone 的仓库
# 保留在仓库内但不入库的本地文件（靠 .gitignore 保护）：
#   data/             SQLite + chroma
#   .venv/            Python 虚拟环境
#   backend/tina.env  密钥
#   backend/config.yml
#   backend/storage/  上传文件
#   backend/logs/
#   frontend/dist/    构建产物
#   frontend/node_modules/

set -euo pipefail

APP_DIR=/srv/zhishi
BRANCH=master
RUN_USER=ifapp

cd "$APP_DIR"

echo "=== 1) 记录当前版本 ==="
OLD_SHA=$(sudo -u "$RUN_USER" git rev-parse --short HEAD)
echo "  $OLD_SHA"

echo "=== 2) 检查本地改动（应为空；有改动说明有人手改过服务器代码）==="
if ! sudo -u "$RUN_USER" git diff --quiet; then
  echo "  ✗ 工作区有未提交改动，先处理："
  sudo -u "$RUN_USER" git status --short
  exit 1
fi
echo "  干净"

echo "=== 3) 拉取 ==="
sudo -u "$RUN_USER" git fetch origin "$BRANCH"
sudo -u "$RUN_USER" git reset --hard "origin/$BRANCH"
NEW_SHA=$(sudo -u "$RUN_USER" git rev-parse --short HEAD)
echo "  $OLD_SHA → $NEW_SHA"

if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  echo "  已是最新，是否仍要重新构建？(y/N)"
  read -r ans
  [ "$ans" = "y" ] || exit 0
fi

echo "=== 4) 依赖变化检查 ==="
CHANGED=$(sudo -u "$RUN_USER" git diff --name-only "$OLD_SHA" "$NEW_SHA")
if echo "$CHANGED" | grep -q "^backend/requirements.txt$"; then
  echo "  requirements.txt 变了，更新 Python 依赖"
  sudo -u "$RUN_USER" "$APP_DIR/.venv/bin/pip" install -r backend/requirements.txt
fi
if echo "$CHANGED" | grep -q "^frontend/package.json$"; then
  echo "  package.json 变了，更新 node 依赖"
  sudo -u "$RUN_USER" bash -c "cd frontend && npm install --no-audit --no-fund"
fi

echo "=== 5) 编译前端 ==="
sudo -u "$RUN_USER" env HOME=/var/lib/infinite-franchise PATH=/usr/local/bin:/usr/bin:/bin \
  bash -c "cd $APP_DIR/frontend && npm run build"

echo "=== 6) 重启 ==="
systemctl restart zhishi
sleep 12
systemctl is-active zhishi

echo "=== 7) 验证 ==="
curl -s -m 10 http://127.0.0.1:17777/health || { echo "  ✗ 健康检查失败"; exit 1; }
echo
sudo -u "$RUN_USER" "$APP_DIR/.venv/bin/python" -c "
import sqlite3
c = sqlite3.connect('$APP_DIR/data/zhishi.db')
for t in ['documents','global_questions','quiz_sessions','quiz_answers']:
    try: print(f'  {t}: ' + str(c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]))
    except Exception as e: print(f'  {t}: {e}')
"
echo "=== 完成：$NEW_SHA ==="
