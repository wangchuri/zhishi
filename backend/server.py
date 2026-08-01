"""
知拾 KT 后端服务 — FastAPI
启动方式（任选其一）:
    cd backend && uvicorn server:app --host 127.0.0.1 --port 8765
    cd backend && python server.py
    项目根目录: dev.bat 或 backend\\run.bat
"""

import sys
from pathlib import Path

# 保证从项目根 python -m backend.server 或任意 cwd 均可导入 lekt_service / app
_BACKEND_ROOT = Path(__file__).resolve().parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.core import paddle_env  # noqa: F401

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. 初始化数据库
    try:
        from app.core.database import init_db
        init_db()
        logger.info("数据库初始化成功")
    except Exception as e:
        logger.error(f"数据库初始化失败: {e}")

    # 1.5 去鉴权模式：确保默认本地用户与分区存在
    try:
        from app.core.database import SessionLocal
        from app.services.bootstrap_service import bootstrap_default_user
        with SessionLocal() as _db:
            default_user = bootstrap_default_user(_db)
            logger.info(f"本地默认用户就绪: id={default_user['user_id']} email={default_user['email']}")
    except Exception as e:
        logger.error(f"默认用户初始化失败: {e}")
    # 2. 初始化 AgentManager（按用户维度管理 ZhishiAgent 实例）
    try:
        from app.core.agent_manager import AgentManager

        app.state.agent_manager = AgentManager()
        print("[Server] AgentManager 就绪")
    except Exception as e:
        logger.error(f"AgentManager 初始化失败: {e}")
        app.state.agent_manager = None

    yield

    # 退出时清理资源
    logger.info("服务关闭")


app = FastAPI(title="知拾 KT 后端", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """确保未捕获异常也返回 JSON，便于 CORSMiddleware 附加 CORS 头。"""
    if isinstance(exc, HTTPException):
        raise exc
    logger.exception("Unhandled error %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误，请稍后重试"},
    )


# ─── 健康检查 ───

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "zhishi",
    }


# ─── 业务路由 ───

from app.api.v1.router import api_router
app.include_router(api_router, prefix="/api/v1")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
