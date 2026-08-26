# 知拾 — 多阶段构建：前端产物 + FastAPI 同镜像托管
# 构建：docker build -t zhishi:latest .
# 运行见 docker-compose.yml

# ─── Stage 1: 前端 ───────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: 运行时 ─────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      curl \
      libjpeg62-turbo \
      zlib1g \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# 依赖（含本地 tina wheel）
COPY backend/requirements.txt /app/backend/requirements.txt
COPY backend/3rdParty /app/backend/3rdParty
WORKDIR /app/backend
RUN pip install --upgrade pip \
 && pip install -r requirements.txt

# 应用代码与配置
COPY backend/src /app/backend/src
COPY backend/prompts /app/backend/prompts
COPY backend/config.yml /app/backend/config.yml
COPY docker/entrypoint.sh /app/entrypoint.sh

# 前端静态资源（main.py 从 ../frontend/dist 托管）
COPY --from=frontend-build /src/frontend/dist /app/frontend/dist

RUN chmod +x /app/entrypoint.sh \
 && mkdir -p /app/data /app/backend/storage /app/backend/storage/images /app/.cache/huggingface

WORKDIR /app/backend

EXPOSE 7777

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7777/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "7777"]
