"""SQLAlchemy 引擎与会话（单用户，SQLite 默认）。

沿用已修复的 SQLite 并发配置：
- journal_mode=WAL
- busy_timeout=10000
- synchronous=1
- foreign_keys=ON
- NullPool：避免后台长任务占满 QueuePool（默认 5+10）导致全站 500
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from .config import config


class Base(DeclarativeBase):
    pass


_database_url = config.database_url
_is_sqlite = _database_url.startswith("sqlite")

_engine_kwargs: dict = {"echo": False}
if _is_sqlite:
    # SQLite + 多线程后台任务：不要用 QueuePool。
    # MinerU/出题等会长时间占着 Session，默认池（5+10）一满，
    # 后续 profile/tasks 等请求就会 QueuePool TimeoutError。
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs["pool_recycle"] = 3600
    _engine_kwargs["pool_pre_ping"] = True
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20

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
    except Exception:
        db.rollback()
        raise
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


def _sync_sqlite_schema() -> None:
    """给已有 SQLite 表补上 ORM 新增列。

    create_all 不会 ALTER 已存在的表；旧库缺列时查询/写入会直接 500。
    """
    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            db_cols = {c["name"]: c for c in insp.get_columns(table.name)}
            orm_cols = {c.name: c for c in table.columns}
            for name, col in orm_cols.items():
                if name in db_cols:
                    continue
                col_type = col.type.compile(dialect=engine.dialect)
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{name}" {col_type}'
                if col.server_default is not None:
                    ddl += f" DEFAULT {col.server_default.arg}"
                elif not col.nullable:
                    python_default = col.default.arg if (col.default is not None and getattr(col.default, "is_scalar", False)) else None
                    if python_default is False:
                        ddl += " DEFAULT 0"
                    elif python_default is True:
                        ddl += " DEFAULT 1"
                    elif isinstance(python_default, (int, float)):
                        ddl += f" DEFAULT {python_default}"
                    elif isinstance(python_default, str):
                        ddl += f" DEFAULT '{python_default}'"
                conn.execute(text(ddl))


def init_db() -> None:
    """创建全部 ORM 表，并同步已有 SQLite 表结构。"""
    if _is_sqlite:
        db_path = _sqlite_db_path()
        if db_path != Path(":memory:"):
            db_path.parent.mkdir(parents=True, exist_ok=True)

    import src.models  # noqa: F401  注册所有 model 到 Base.metadata

    Base.metadata.create_all(bind=engine)
    if _is_sqlite:
        _sync_sqlite_schema()
