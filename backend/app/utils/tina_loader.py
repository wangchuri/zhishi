"""
Tina 配置路径辅助 — tina 已通过 pip install 安装，无需 sys.path 操作。

用法:
    from app.utils.tina_loader import tina_env_path
    from tina import Agent
    from tina.llm import BaseAPI

    llm = BaseAPI(env_path=tina_env_path())
"""
from __future__ import annotations

from pathlib import Path


def tina_env_path() -> str:
    """返回 backend/tina.env 绝对路径。"""
    # app/utils/ -> 上两级 = backend/
    return str(Path(__file__).resolve().parents[2] / "tina.env")


__all__ = ["tina_env_path"]