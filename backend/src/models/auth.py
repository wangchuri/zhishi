"""登录鉴权：单账号 + 服务端会话。

- AuthUser：唯一的管理员账号（用户名 + scrypt 密码哈希）
- AuthSession：服务端会话令牌（存哈希，Cookie 只放原始 token），可撤销
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _utcnow_naive() -> datetime:
    """SQLite 存的是 naive 时间，统一用 naive UTC，便于比较。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AuthUser(Base):
    """管理员账号（单账号）。"""

    __tablename__ = "auth_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow_naive, onupdate=_utcnow_naive
    )


class AuthSession(Base):
    """服务端会话（token 只存哈希）。"""

    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
