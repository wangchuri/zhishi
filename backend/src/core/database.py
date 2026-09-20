"""SQLAlchemy 引擎与会话（单用户，SQLite 默认）。

沿用已修复的 SQLite 并发配置：
- journal_mode=WAL
- busy_timeout=10000
- synchronous=1
- foreign_keys=ON
- NullPool：避免后台长任务占满 QueuePool（默认 5+10）导致全站 500
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool
from sqlalchemy.schema import CreateIndex

from .config import config

logger = logging.getLogger(__name__)


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

            # 补 ORM 声明了、但旧表没有的索引（ADD COLUMN 不会带索引）
            db_indexes = {ix.get("name") for ix in insp.get_indexes(table.name)}
            for index in table.indexes:
                if index.name and index.name not in db_indexes:
                    conn.execute(CreateIndex(index))


_CONSTRAINT_KEYWORDS = ("primary", "foreign", "unique", "check", "constraint")


def _split_sql_list(body: str) -> list[str]:
    """按顶层逗号切分 DDL 括号内的列/约束定义（忽略括号与引号内的逗号）。"""
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    quote: str | None = None
    for ch in body:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            buf.append(ch)
        elif ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf))
    return parts


def _strip_not_null(create_sql: str, columns: set[str]) -> str:
    """在既有 CREATE TABLE 语句中，去掉指定列的 NOT NULL（保留其余原样）。"""
    lparen = create_sql.find("(")
    rparen = create_sql.rfind(")")
    if lparen < 0 or rparen < 0:
        raise ValueError("无法解析建表语句")
    head, body = create_sql[:lparen], create_sql[lparen + 1:rparen]
    rebuilt: list[str] = []
    for part in _split_sql_list(body):
        stripped = part.strip()
        first = stripped.split(None, 1)[0].strip('"[]`').lower() if stripped else ""
        if first in _CONSTRAINT_KEYWORDS:
            rebuilt.append(part)
            continue
        match = re.match(r'\s*["`\[]?(\w+)', part)
        name = match.group(1) if match else ""
        if name in columns:
            part = re.sub(r"\s+NOT\s+NULL\b", "", part, count=1, flags=re.I)
        rebuilt.append(part)
    return head + "(" + ",".join(rebuilt) + ")"


def _rebuild_without_not_null(cur, table: str, columns: set[str]) -> None:
    row = cur.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    if not row or not row[0]:
        return
    new_sql = _strip_not_null(row[0], columns)
    indexes = [
        r[0]
        for r in cur.execute(
            "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
            (table,),
        ).fetchall()
    ]
    col_names = [c[1] for c in cur.execute(f'PRAGMA table_info("{table}")').fetchall()]
    col_list = ", ".join(f'"{c}"' for c in col_names)
    backup = f"__{table}_migrate_old"
    cur.execute(f'DROP TABLE IF EXISTS "{backup}"')
    # legacy_alter_table=ON：重命名时不改写其它表对本表的引用
    cur.execute(f'ALTER TABLE "{table}" RENAME TO "{backup}"')
    cur.execute(new_sql)
    cur.execute(f'INSERT INTO "{table}" ({col_list}) SELECT {col_list} FROM "{backup}"')
    # 先删旧表（连同旧索引名释放），再重建索引，避免索引重名
    cur.execute(f'DROP TABLE "{backup}"')
    for index_sql in indexes:
        cur.execute(index_sql)
    logger.warning("已迁移表 %s：放宽 NOT NULL 列 %s", table, ", ".join(sorted(columns)))


def _relax_legacy_not_null() -> None:
    """让已有 SQLite 表结构与 ORM 对齐：ORM 可空、但旧库仍 NOT NULL 的列，改为可空。

    create_all 只建新表、_sync_sqlite_schema 只补新列，都无法修改列的 NOT NULL，
    所以模型把列改成可选后，旧库写入 NULL 会直接 500。
    """
    insp = inspect(engine)
    existing = set(insp.get_table_names())
    plan: list[tuple[str, set[str]]] = []
    for table in Base.metadata.sorted_tables:
        if table.name not in existing:
            continue
        db_cols = {c["name"]: c for c in insp.get_columns(table.name)}
        # 旧库可能还有 ORM 未定义的遗留列；重建时按原 DDL 照搬，不受影响
        drift = {
            c.name
            for c in table.columns
            if c.name in db_cols
            and c.nullable
            and db_cols[c.name].get("nullable") is False
            and not c.primary_key
        }
        if drift:
            plan.append((table.name, drift))

    if not plan:
        return

    raw = engine.raw_connection()
    driver = raw.driver_connection
    previous_isolation = driver.isolation_level
    driver.isolation_level = None  # 手动控制事务，便于切换 PRAGMA
    cur = driver.cursor()
    try:
        cur.execute("PRAGMA foreign_keys=OFF")
        cur.execute("PRAGMA legacy_alter_table=ON")
        cur.execute("BEGIN")
        for table_name, columns in plan:
            _rebuild_without_not_null(cur, table_name, columns)
        cur.execute("COMMIT")
    except Exception:
        try:
            cur.execute("ROLLBACK")
        except Exception:
            pass
        logger.exception("SQLite 结构迁移失败，已回滚")
        raise
    finally:
        try:
            cur.execute("PRAGMA legacy_alter_table=OFF")
            cur.execute("PRAGMA foreign_keys=ON")
        finally:
            cur.close()
            driver.isolation_level = previous_isolation
            raw.close()


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
        _relax_legacy_not_null()
