"""SQLAlchemy 引擎与会话（单用户，SQLite 默认）。

沿用已修复的 SQLite 并发配置：
- journal_mode=WAL
- busy_timeout=10000
- synchronous=1
- foreign_keys=ON
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import config


class Base(DeclarativeBase):
    pass


_database_url = config.database_url
_is_sqlite = _database_url.startswith("sqlite")

_engine_kwargs: dict = {"echo": False}
if _is_sqlite:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    _engine_kwargs["pool_recycle"] = 3600

engine = create_engine(_database_url, **_engine_kwargs)


if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.execute("PRAGMA synchronous=1")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db():
    """FastAPI 依赖：每个请求一个独立会话。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _sqlite_db_path() -> Path:
    url_path = _database_url.replace("sqlite:///", "", 1)
    if url_path in (":memory:", ""):
        return Path(":memory:")
    p = Path(url_path)
    if not p.is_absolute():
        p = (Path.cwd() / p).resolve()
    return p


def init_db() -> None:
    """创建全部 ORM 表。"""
    if _is_sqlite:
        db_path = _sqlite_db_path()
        if db_path != Path(":memory:"):
            db_path.parent.mkdir(parents=True, exist_ok=True)

    import src.models  # noqa: F401  注册所有 model 到 Base.metadata

    Base.metadata.create_all(bind=engine)
