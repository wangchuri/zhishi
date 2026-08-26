"""全局配置（模块级单例）。

从 backend/config.yml 加载基础配置，并提供解析后的路径等便捷属性。
模块导入时即创建唯一的 config 实例，全程序复用。
"""

from __future__ import annotations

import os
from pathlib import Path

import yaml

from .paths import backend_dir, is_frozen, runtime_dir

# backend/ 目录（config.yml 所在位置）作为相对路径基准
_BACKEND_DIR = backend_dir()

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
            alt = runtime_dir() / "config.yml"
            if alt.is_file():
                path = alt
            else:
                return
        with open(path, "r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
        for key, value in loaded.items():
            self._data[key] = value

    @property
    def storage_dir(self) -> Path:
        return self._resolve(self._data["storage_dir"])

    @property
    def image_base_dir(self) -> Path:
        return self._resolve(self._data["image_base_dir"])

    @property
    def database_url(self) -> str:
        url = self._data["database_url"]
        if url.startswith("sqlite:///./"):
            rel = url.replace("sqlite:///./", "")
            return f"sqlite:///{runtime_dir() / rel}"
        return url

    @property
    def max_concurrency(self) -> int:
        return int(self._data.get("max_concurrency", 1))

    @property
    def question_gen_max_concurrency(self) -> int:
        raw = self._data.get("question_gen_max_concurrency")
        if raw is None:
            return max(1, self.max_concurrency)
        return max(1, int(raw))

    @property
    def question_gen_max_pages(self) -> int:
        return max(1, int(self._data.get("question_gen_max_pages", 30)))

    def _resolve(self, value: str) -> Path:
        p = Path(value)
        if not p.is_absolute():
            # 开发：相对 backend/；冻结 exe：相对 exe 目录
            base = runtime_dir() if is_frozen() else backend_dir()
            p = base / p
        return p.resolve()

    def ensure_dirs(self) -> None:
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.image_base_dir.mkdir(parents=True, exist_ok=True)
        (runtime_dir() / "data").mkdir(parents=True, exist_ok=True)


config = Config()
