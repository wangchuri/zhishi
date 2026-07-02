import fnmatch
import json
import logging
import os
import time

import redis

logger = logging.getLogger(__name__)


class MemoryCache:
    """进程内缓存，仅用于本地开发（无 Redis 时 auth token / 验证码等）。"""

    def __init__(self):
        self._data: dict[str, tuple[str, float | None]] = {}
        self._lists: dict[str, list[str]] = {}

    def _purge_expired_key(self, key: str) -> None:
        if key not in self._data:
            return
        _, expiry = self._data[key]
        if expiry is not None and time.monotonic() > expiry:
            del self._data[key]

    def _purge_expired(self) -> None:
        for key in list(self._data.keys()):
            self._purge_expired_key(key)

    def set_session(self, token: str, user_data: dict, ttl: int = 604800):
        self.set_value(f"auth:token:{token}", json.dumps(user_data), ttl)

    def get_session(self, token: str):
        data = self.get_value(f"auth:token:{token}")
        return json.loads(data) if data else None

    def set_value(self, key: str, value: str, ttl: int = None):
        expiry = (time.monotonic() + ttl) if ttl is not None else None
        self._data[key] = (value, expiry)

    def get_value(self, key: str):
        self._purge_expired_key(key)
        if key not in self._data:
            return None
        return self._data[key][0]

    def delete_key(self, key: str):
        self._data.pop(key, None)
        self._lists.pop(key, None)

    def scan_keys(self, pattern: str):
        self._purge_expired()
        seen: set[str] = set()
        for key in list(self._data.keys()) + list(self._lists.keys()):
            if key in seen:
                continue
            if fnmatch.fnmatch(key, pattern):
                seen.add(key)
                yield key

    def lpush(self, key: str, *values):
        self._lists.setdefault(key, [])
        for value in reversed(values):
            self._lists[key].insert(0, value)
        return len(self._lists[key])

    def rpush(self, key: str, *values):
        self._lists.setdefault(key, []).extend(values)
        return len(self._lists[key])

    def lrange(self, key: str, start: int, end: int):
        items = self._lists.get(key, [])
        if end == -1:
            return items[start:]
        return items[start : end + 1]

    def lrem(self, key: str, count: int, value: str):
        items = self._lists.get(key, [])
        removed = 0
        if count == 0:
            while value in items:
                items.remove(value)
                removed += 1
        elif count > 0:
            for item in items[:count]:
                if item == value:
                    items.remove(value)
                    removed += 1
        else:
            for item in reversed(items):
                if removed >= abs(count):
                    break
                if item == value:
                    items.remove(value)
                    removed += 1
        return removed


class RedisCache:
    def __init__(self):
        host = os.getenv("REDIS_HOST", "localhost")
        port = int(os.getenv("REDIS_PORT", 6379))
        db = int(os.getenv("REDIS_DB", 0))

        self.pool = redis.ConnectionPool(
            host=host,
            port=port,
            db=db,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
        )
        self.client = redis.Redis(connection_pool=self.pool)

        try:
            self.client.config_set("save", "60 1")
        except Exception:
            pass

    def set_session(self, token: str, user_data: dict, ttl: int = 604800):
        try:
            self.client.setex(f"auth:token:{token}", ttl, json.dumps(user_data))
        except redis.exceptions.RedisError as exc:
            raise ConnectionError(f"Redis 连接失败: {exc}")

    def get_session(self, token: str):
        try:
            data = self.client.get(f"auth:token:{token}")
        except redis.exceptions.RedisError as exc:
            raise ConnectionError(f"Redis 连接失败: {exc}")
        return json.loads(data) if data else None

    def set_value(self, key: str, value: str, ttl: int = None):
        try:
            if ttl is not None:
                self.client.setex(key, ttl, value)
            else:
                self.client.set(key, value)
        except redis.exceptions.RedisError as exc:
            raise ConnectionError(f"Redis 连接失败: {exc}")

    def get_value(self, key: str):
        try:
            return self.client.get(key)
        except redis.exceptions.RedisError as exc:
            raise ConnectionError(f"Redis 连接失败: {exc}")

    def delete_key(self, key: str):
        try:
            self.client.delete(key)
        except redis.exceptions.RedisError as exc:
            raise ConnectionError(f"Redis 连接失败: {exc}")

    def scan_keys(self, pattern: str):
        try:
            return self.client.scan_iter(pattern)
        except redis.exceptions.RedisError as exc:
            raise ConnectionError(f"Redis 连接失败: {exc}")

    def lpush(self, key: str, *values):
        try:
            return self.client.lpush(key, *values)
        except redis.exceptions.RedisError as exc:
            raise ConnectionError(f"Redis 连接失败: {exc}")

    def rpush(self, key: str, *values):
        try:
            return self.client.rpush(key, *values)
        except redis.exceptions.RedisError as exc:
            raise ConnectionError(f"Redis 连接失败: {exc}")

    def lrange(self, key: str, start: int, end: int):
        try:
            return self.client.lrange(key, start, end)
        except redis.exceptions.RedisError as exc:
            raise ConnectionError(f"Redis 连接失败: {exc}")

    def lrem(self, key: str, count: int, value: str):
        try:
            return self.client.lrem(key, count, value)
        except redis.exceptions.RedisError as exc:
            raise ConnectionError(f"Redis 连接失败: {exc}")


def _allow_memory_fallback() -> bool:
    if os.getenv("CACHE_BACKEND", "").lower() == "memory":
        return True
    if os.getenv("DEV_MODE", "").lower() == "true":
        return True
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url or "sqlite" in db_url.lower():
        return True
    return False


def _create_cache():
    if os.getenv("CACHE_BACKEND", "").lower() == "memory":
        logger.warning("CACHE_BACKEND=memory，使用进程内缓存（仅开发）")
        return MemoryCache()

    try:
        redis_cache = RedisCache()
        redis_cache.client.ping()
        return redis_cache
    except Exception as exc:
        if _allow_memory_fallback():
            logger.warning("Redis 不可用 (%s)，回退到进程内缓存（仅开发）", exc)
            return MemoryCache()
        raise ConnectionError(f"Redis 连接失败: {exc}") from exc


cache = _create_cache()
