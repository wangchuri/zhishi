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
    # MinerU：local=本机 mineru-api；cloud=mineru.net 云端 API
    "mineru_mode": "local",
    "mineru_api_token": "",
    "mineru_api_base": "https://mineru.net",
    "mineru_model_version": "vlm",
}

class Config:
    """全局配置。模块级单例：import 时自动加载一次。"""

    def __init__(self) -> None:
        self._data: dict = dict(_DEFAULTS)
        self._config_path: Path | None = None
        self._load_yml()

    def config_path(self) -> Path:
        """当前读写的 config.yml 路径。"""
        if self._config_path is not None:
            return self._config_path
        env = os.environ.get("ZHISHI_CONFIG", "").strip()
        if env:
            return Path(env)
        primary = _BACKEND_DIR / "config.yml"
        if primary.is_file() or not is_frozen():
            return primary
        return runtime_dir() / "config.yml"

    def _load_yml(self) -> None:
        env = os.environ.get("ZHISHI_CONFIG", "").strip()
        candidates = []
        if env:
            candidates.append(Path(env))
        candidates.append(_BACKEND_DIR / "config.yml")
        candidates.append(runtime_dir() / "config.yml")
        path = next((p for p in candidates if p.is_file()), None)
        if path is None:
            return
        self._config_path = path
        with open(path, "r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
        for key, value in loaded.items():
            self._data[key] = value

    def reload(self) -> None:
        self._data = dict(_DEFAULTS)
        self._load_yml()

    def update_values(self, updates: dict) -> None:
        """更新内存并写回 config.yml（只改传入的键）。"""
        for key, value in updates.items():
            self._data[key] = value
        self._save_yml()

    def _save_yml(self) -> None:
        path = self.config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        # 保留已有键顺序：先读旧文件键，再合并
        existing: dict = {}
        if path.is_file():
            with open(path, "r", encoding="utf-8") as f:
                existing = yaml.safe_load(f) or {}
        for key, value in self._data.items():
            existing[key] = value
        header = (
            "# 知拾本地配置\n"
            "# 说明：本机自用单用户，无需鉴权。相对路径均以 backend/ 为基准。\n"
            "# 也可在设置页修改 MinerU 等项；保存后立即生效。\n\n"
        )
        with open(path, "w", encoding="utf-8") as f:
            f.write(header)
            yaml.safe_dump(existing, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
        self._config_path = path

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

    @property
    def mineru_mode(self) -> str:
        raw = (os.environ.get("MINERU_MODE") or self._data.get("mineru_mode") or "local")
        mode = str(raw).strip().lower()
        return mode if mode in {"local", "cloud"} else "local"

    @property
    def mineru_api_token(self) -> str:
        env = (os.environ.get("MINERU_API_TOKEN") or "").strip()
        if env:
            return env
        return str(self._data.get("mineru_api_token") or "").strip()

    @property
    def mineru_api_base(self) -> str:
        raw = (
            os.environ.get("MINERU_API_BASE")
            or self._data.get("mineru_api_base")
            or "https://mineru.net"
        )
        return str(raw).strip().rstrip("/") or "https://mineru.net"

    @property
    def mineru_model_version(self) -> str:
        raw = (
            os.environ.get("MINERU_MODEL_VERSION")
            or self._data.get("mineru_model_version")
            or "vlm"
        )
        ver = str(raw).strip().lower()
        return ver if ver in {"pipeline", "vlm"} else "vlm"

    def mineru_settings_public(self) -> dict:
        """给前端的配置视图（含 token，本机单用户）。"""
        return {
            "mode": self.mineru_mode,
            "api_token": self.mineru_api_token,
            "api_base": self.mineru_api_base,
            "model_version": self.mineru_model_version,
            "config_path": str(self.config_path()),
        }

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
