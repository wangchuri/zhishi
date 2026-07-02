"""
文件存储服务 — 统一存取接口

使用方式：
    from app.services.storage_service import storage_service

    # 保存文件
    path = storage_service.save_file(user_id, filename, content_bytes)
    # 读取文件
    data = storage_service.get_file(user_id, filename)
    # 列表
    files = storage_service.list_user_files(user_id)
    # 删除
    storage_service.delete_file(user_id, filename)

配置：
    USE_OSS=False → 本地存储 (storage/{user_id}/)
    USE_OSS=True  → OSS 存储（未实现）
"""
import logging
import shutil
from pathlib import Path
from typing import Optional, List

from app.core.config import USE_OSS, LOCAL_STORAGE_DIR

logger = logging.getLogger(__name__)


class LocalStorage:
    """本地文件系统存储"""

    def __init__(self, base_dir: str):
        self.base = Path(base_dir).resolve()
        self.base.mkdir(parents=True, exist_ok=True)

    def _user_dir(self, user_id: int, subdir: str = "original") -> Path:
        d = self.base / str(user_id) / subdir
        d.mkdir(parents=True, exist_ok=True)
        return d

    def save_file(self, user_id: int, filename: str, content: bytes) -> str:
        """保存文件，返回完整路径"""
        d = self._user_dir(user_id, "original")
        safe_name = Path(filename).name
        path = d / safe_name
        path.write_bytes(content)
        logger.info(f"LocalStorage.save_file: {path} ({len(content)} bytes)")
        return str(path)

    def save_text(self, user_id: int, filename: str, content: str) -> str:
        """保存文本文件（用于解析缓存）"""
        d = self._user_dir(user_id, "parsed")
        safe_name = Path(filename).name
        path = d / safe_name
        path.write_text(content, encoding="utf-8")
        logger.info(f"LocalStorage.save_text: {path} ({len(content)} chars)")
        return str(path)

    def get_file(self, user_id: int, filename: str) -> Optional[bytes]:
        """读取原始文件字节"""
        d = self._user_dir(user_id, "original")
        path = d / Path(filename).name
        if path.exists():
            return path.read_bytes()
        return None

    def get_parsed(self, user_id: int, filename: str) -> Optional[str]:
        """读取解析后的文本缓存"""
        d = self._user_dir(user_id, "parsed")
        path = d / Path(filename).name
        if path.exists():
            return path.read_text(encoding="utf-8")
        return None

    def delete_file(self, user_id: int, filename: str) -> bool:
        """删除原始文件（同时尝试删除对应的 parsed 缓存）"""
        d = self._user_dir(user_id, "original")
        path = d / Path(filename).name
        deleted = False
        if path.exists():
            path.unlink()
            deleted = True

        # 同时删除同名 parsed 缓存
        pd = self._user_dir(user_id, "parsed")
        ppath = pd / Path(filename).name
        if ppath.exists():
            ppath.unlink()
        return deleted

    def delete_user_storage(self, user_id: int) -> bool:
        """删除用户整个存储目录"""
        d = self.base / str(user_id)
        if d.exists():
            try:
                shutil.rmtree(str(d))
                logger.info(f"LocalStorage.delete_user_storage: 已删除 {d}")
                return True
            except OSError as e:
                logger.error(f"LocalStorage.delete_user_storage 失败: {e}")
                return False
        return False

    def list_user_files(self, user_id: int) -> List[dict]:
        """列出用户所有原始文件"""
        d = self._user_dir(user_id, "original")
        files = []
        for p in d.iterdir():
            if p.is_file():
                stat = p.stat()
                files.append({
                    "filename": p.name,
                    "size": stat.st_size,
                    "modified_at": stat.st_mtime,
                })
        return files

    # ─── 聊天记录文件 ─────────────────────────────────────

    def save_chat_history(self, user_id: int, session_id: str, data: dict) -> str:
        """保存会话的完整消息历史及元信息到 JSON 文件"""
        import json as _json
        d = self._user_dir(user_id, "history")
        path = d / f"{session_id}.json"
        path.write_text(_json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(path)

    def load_chat_history(self, user_id: int, session_id: str) -> Optional[dict]:
        """读取会话的完整消息历史"""
        import json as _json
        d = self._user_dir(user_id, "history")
        path = d / f"{session_id}.json"
        if not path.exists():
            return None
        try:
            return _json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def delete_chat_history(self, user_id: int, session_id: str) -> bool:
        """删除单个会话的文件"""
        d = self._user_dir(user_id, "history")
        path = d / f"{session_id}.json"
        if path.exists():
            path.unlink()
            return True
        return False

    def list_chat_sessions(self, user_id: int) -> List[dict]:
        """列出用户所有历史会话（从文件名 + 文件内 meta 提取）"""
        import json as _json
        d = self._user_dir(user_id, "history")
        sessions = []
        for p in sorted(d.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
            try:
                data = _json.loads(p.read_text(encoding="utf-8"))
                sessions.append({
                    "id": p.stem,
                    "title": (data.get("meta") or {}).get("title", "会话"),
                    "created_at": (data.get("meta") or {}).get("created_at", ""),
                    "updated_at": (data.get("meta") or {}).get("updated_at", ""),
                })
            except Exception:
                sessions.append({
                    "id": p.stem,
                    "title": "会话",
                    "created_at": "",
                    "updated_at": "",
                })
        return sessions


class FileStorageService:
    """
    文件存储服务门面

    USE_OSS=False → LocalStorage
    USE_OSS=True  → OSSStorage（未实现）
    """

    def __init__(self):
        if USE_OSS:
            # TODO: 未来接入 OSS
            raise NotImplementedError("OSS 存储暂未实现，请设置 USE_OSS=false")
        self._backend = LocalStorage(LOCAL_STORAGE_DIR)
        logger.info(f"FileStorageService 初始化: 本地存储 ({LOCAL_STORAGE_DIR})")

    # ─── 原始文件 ──────────────────────────────────────

    def save_file(self, user_id: int, filename: str, content: bytes) -> str:
        return self._backend.save_file(user_id, filename, content)

    def get_file(self, user_id: int, filename: str) -> Optional[bytes]:
        return self._backend.get_file(user_id, filename)

    def delete_file(self, user_id: int, filename: str) -> bool:
        return self._backend.delete_file(user_id, filename)

    def list_user_files(self, user_id: int) -> List[dict]:
        return self._backend.list_user_files(user_id)

    def delete_user_storage(self, user_id: int) -> bool:
        return self._backend.delete_user_storage(user_id)

    # ─── 解析缓存 ─────────────────────────────────────

    def save_parsed(self, user_id: int, filename: str, content: str) -> str:
        return self._backend.save_text(user_id, filename, content)

    def get_parsed(self, user_id: int, filename: str) -> Optional[str]:
        return self._backend.get_parsed(user_id, filename)

    # ─── 聊天记录 ─────────────────────────────────────

    def save_chat_history(self, user_id: int, session_id: str, data: dict) -> str:
        return self._backend.save_chat_history(user_id, session_id, data)

    def load_chat_history(self, user_id: int, session_id: str) -> Optional[dict]:
        return self._backend.load_chat_history(user_id, session_id)

    def delete_chat_history(self, user_id: int, session_id: str) -> bool:
        return self._backend.delete_chat_history(user_id, session_id)

    def list_chat_sessions(self, user_id: int) -> List[dict]:
        return self._backend.list_chat_sessions(user_id)


# 全局单例
storage_service = FileStorageService()