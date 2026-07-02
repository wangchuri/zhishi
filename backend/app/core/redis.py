import redis
import json
import os

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
            retry_on_timeout=True
        )
        self.client = redis.Redis(connection_pool=self.pool)

        # 启用 RDB 持久化：每 60 秒至少 1 个 key 变更则保存到磁盘
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

cache = RedisCache()
