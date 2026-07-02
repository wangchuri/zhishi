"""
知拾 KT 后端服务 — FastAPI
启动方式:
    uvicorn server:app --host 127.0.0.1 --port 8765
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from lekt_service import LEKTService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 技能名称映射
SKILL_NAMES = {
    0: "加法",
    1: "减法",
    2: "乘法",
    3: "除法",
    4: "一元一次方程",
    5: "函数基础",
    6: "微积分入门",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. 初始化数据库
    try:
        from app.core.database import init_db
        init_db()
        logger.info("数据库初始化成功")
    except Exception as e:
        logger.error(f"数据库初始化失败: {e}")

    # 2. 加载 LEKT 推理模型
    print("[Server] 正在加载 LEKT 服务...")
    lekt = LEKTService("logic_matrix.npy", skill_names=SKILL_NAMES)
    app.state.lekt = lekt
    if lekt.is_loaded:
        print(f"[Server] LEKT 服务就绪，{lekt.num_skills} 个技能")
    else:
        print("[Server] 警告: LEKT 服务未加载（.pyd 文件缺失 or 矩阵不存在）")

    # 3. 初始化 AgentManager（按用户维度管理 ZhishiAgent 实例）
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


def _get_lekt() -> LEKTService:
    return app.state.lekt


# ─── 健康检查 ───

@app.get("/health")
async def health():
    lekt = _get_lekt()
    return {
        "status": "ok" if lekt.is_loaded else "degraded",
        "skills_count": lekt.num_skills,
        "model_loaded": lekt.is_loaded,
    }


# ─── 业务路由 ───

from app.api.v1.router import api_router
app.include_router(api_router, prefix="/api/v1")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
