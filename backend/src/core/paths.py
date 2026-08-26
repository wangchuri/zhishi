"""打包 / 开发环境下的路径解析。

- 开发：backend/ 与仓库根目录
- PyInstaller 冻结：只读资源在 sys._MEIPASS，可写数据在 exe 同目录
"""

from __future__ import annotations

import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"))


def resource_dir() -> Path:
    """只读资源根：prompts、默认 config、打包进的前端静态文件。"""
    if is_frozen():
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    # backend/
    return Path(__file__).resolve().parent.parent.parent


def runtime_dir() -> Path:
    """可写运行目录：数据库、storage、tina.env（用户可改）。"""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    # 仓库根目录
    return resource_dir().parent


def backend_dir() -> Path:
    """兼容旧语义：开发时为 backend/；冻结时等同 resource_dir。"""
    return resource_dir()


def frontend_dist_dir() -> Path:
    if is_frozen():
        return resource_dir() / "frontend_dist"
    return runtime_dir() / "frontend" / "dist"


def tina_env_path() -> Path:
    """优先 exe/仓库旁的可写配置，其次打包内嵌示例。"""
    candidates = [
        runtime_dir() / "tina.env",
        resource_dir() / "tina.env",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return candidates[0]
