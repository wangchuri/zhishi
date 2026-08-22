"""全局配置（模块级单例）。

从 backend/config.yml 加载基础配置，并提供解析后的路径等便捷属性。
模块导入时即创建唯一的 config 实例，全程序复用。
"""

from __future__ import annotations

import os
from pathlib import Path

import yaml

# backend/ 目录（config.yml 所在位置）作为相对路径基准
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent

_DEFAULTS = {
    "storage_dir": "./storage",
    "image_base_dir": "./storage/images",
    "database_url": "sqlite:///./data/zhishi.db",
    "max_concurrency": 1,
    "question_gen_max_concurrency": 3,
    "question_gen_max_pages": 30,
}


class Config:
    """全局配置。模块级单例：import 时自动加载一次。"""

    def __init__(self) -> None:
        self._data: dict = dict(_DEFAULTS)
        self._load_yml()

    def _load_yml(self) -> None:
        cfg_path = os.environ.get("ZHISHI_CONFIG", str(_BACKEND_DIR / "config.yml"))
        path = Path(cfg_path)
        if not path.is_file():
            return
        with open(path, "r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
        for key, value in loaded.items():
            self._data[key] = value

    # ---- 基础配置项 ----

    @property
    def storage_dir(self) -> Path:
        """本地存储根目录（原始文件、解析产物等）。"""
        return self._resolve(self._data["storage_dir"])

    @property
    def image_base_dir(self) -> Path:
        """图床路径：markdown 中所有图片都会落盘到此目录。"""
        return self._resolve(self._data["image_base_dir"])

    @property
    def database_url(self) -> str:
        """SQLAlchemy 数据库连接串。"""
        url = self._data["database_url"]
        if url.startswith("sqlite:///./"):
            # 解析为项目根 data/ 下的绝对路径，避免依赖运行时 cwd
            rel = url.replace("sqlite:///./", "")
            return f"sqlite:///{_BACKEND_DIR.parent / rel}"
        return url

    @property
    def max_concurrency(self) -> int:
        """学习路径等后台任务并发，默认 1。"""
        return int(self._data.get("max_concurrency", 1))

    @property
    def question_gen_max_concurrency(self) -> int:
        """出题页 Agent 并行数，默认 3；未配置时回退到 max_concurrency。"""
        raw = self._data.get("question_gen_max_concurrency")
        if raw is None:
            return max(1, self.max_concurrency)
        return max(1, int(raw))

    @property
    def question_gen_max_pages(self) -> int:
        """单次出题最多页数。"""
        return max(1, int(self._data.get("question_gen_max_pages", 30)))

    # ---- 便捷路径 ----

    def _resolve(self, value: str) -> Path:
        p = Path(value)
        if not p.is_absolute():
            p = _BACKEND_DIR / p
        return p.resolve()

    def ensure_dirs(self) -> None:
        """确保存储 / 图床目录存在。"""
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.image_base_dir.mkdir(parents=True, exist_ok=True)


# 模块级单例：import 时创建，全程序共享
config = Config()
