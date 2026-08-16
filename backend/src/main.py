"""知拾后端入口。

启动：python -m src.main
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

# 确保 backend/ 在 sys.path（python -m src.main 时 cwd=backend）
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import config
from .core.database import init_db

app = FastAPI(title="知拾", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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


def main() -> None:
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=7777, reload=True)


if __name__ == "__main__":
    main()
