"""知拾后端入口。

启动：python -m src.main
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

# 确保 backend/ 在 sys.path（python -m src.main 时 cwd=backend）
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.kb import router as kb_router
from .api.questions import router as questions_router
from .api.quiz import router as quiz_router
from .api.tutor import router as tutor_router
from .api.chat import router as chat_router
from .api.companion import router as companion_router
from .api.analytics import router as analytics_router
from .api.tracking import router as tracking_router
from .api.learning import router as learning_router
from .api.parse import router as parse_router
from .api.tasks import router as tasks_router
from .api.onboarding import router as onboarding_router
from .core.config import config
from .core.database import SessionLocal, init_db
from .core.errors import AppError
from .services.kb import ensure_default_collections, reset_stale_processing

import logging

logger = logging.getLogger(__name__)

_FRONTEND_DIST = _BACKEND_DIR.parent / "frontend" / "dist"

app = FastAPI(title="知拾", version="0.1.0")


@app.exception_handler(AppError)
async def _app_error_handler(request: Request, exc: AppError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(kb_router)
app.include_router(questions_router)
app.include_router(quiz_router)
app.include_router(tutor_router)
app.include_router(chat_router)
app.include_router(companion_router)
app.include_router(analytics_router)
app.include_router(tracking_router)
app.include_router(learning_router)
app.include_router(parse_router)
app.include_router(tasks_router)
app.include_router(onboarding_router)

_START_TIME = time.time()


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "uptime_seconds": int(time.time() - _START_TIME),
        "max_concurrency": config.max_concurrency,
    }


@app.on_event("startup")
def _on_startup() -> None:
    config.ensure_dirs()
    init_db()
    db = SessionLocal()
    try:
        ensure_default_collections(db)
        n = reset_stale_processing(db)
        if n:
            logger.warning("已重置 %s 个中断的解析任务为 failed", n)
    finally:
        db.close()


async def _poll_task_completion() -> None:
    """每隔几分钟扫一次任务完成。上传/出题/刷题成功时也会立刻检查。"""
    from .services.task import evaluate

    while True:
        await asyncio.sleep(180)
        db = SessionLocal()
        try:
            evaluate(db)
        except Exception:
            logger.exception("定时检查任务完成失败")
        finally:
            db.close()


@app.on_event("startup")
async def _start_task_poll() -> None:
    asyncio.create_task(_poll_task_completion())


_NO_STORE = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
}
_NO_CACHE_FILES = {"index.html", "sw.js", "registerSW.js", "manifest.webmanifest"}


@app.get("/api/v1/pwa-reset", include_in_schema=False)
def pwa_reset():
    """旧 Service Worker 会锁住过期前端；此地址在 /api 下，SW 不会拦截。"""
    return HTMLResponse(
        content="""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>刷新缓存</title></head>
<body>
<p>正在清除离线缓存并重新加载…</p>
<script>
(async () => {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch (e) {}
  location.replace("/");
})();
</script>
</body>
</html>""",
        headers={**_NO_STORE, "Clear-Site-Data": '"cache", "storage"'},
    )


def _mount_frontend() -> None:
    """托管 frontend/dist：访问 7777 即打开网页版。"""
    if not _FRONTEND_DIST.is_dir() or not (_FRONTEND_DIST / "index.html").is_file():
        logger.warning("未找到前端产物 %s，跳过静态托管（请先在 frontend 执行 npm run build）", _FRONTEND_DIST)
        return

    assets = _FRONTEND_DIST / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        if full_path.startswith("api/") or full_path == "health":
            raise HTTPException(status_code=404)
        target = (_FRONTEND_DIST / full_path).resolve()
        try:
            target.relative_to(_FRONTEND_DIST.resolve())
        except ValueError:
            raise HTTPException(status_code=404)
        if full_path and target.is_file():
            if target.name in _NO_CACHE_FILES:
                return FileResponse(target, headers=_NO_STORE)
            return FileResponse(target)
        return FileResponse(_FRONTEND_DIST / "index.html", headers=_NO_STORE)

    logger.info("前端静态托管已启用: %s", _FRONTEND_DIST)


_mount_frontend()


def main() -> None:
    import uvicorn

    print()
    print("=============== 知拾 访问地址 ===============")
    print("  本机访问:   http://127.0.0.1:7777")
    print("  局域网:     同一 WiFi 下用本机 IP:7777")
    print("=============================================")
    print()
    uvicorn.run("src.main:app", host="0.0.0.0", port=7777, reload=True)


if __name__ == "__main__":
    main()
