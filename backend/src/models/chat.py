"""AI 对话与伴学历史（入 DB，替代旧 JSON 文件）。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ChatSession(Base):
    """AI 对话会话。"""

    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(200), default="对话")
    kind: Mapped[str | None] = mapped_column(String(20), default="chat")  # chat/onboarding
    crisis: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class ChatMessage(Base):
    """对话消息。"""

    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user/assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    reasoning_content: Mapped[str | None] = mapped_column(Text)
    citations: Mapped[str | None] = mapped_column(Text)  # JSON
    payload: Mapped[str | None] = mapped_column(Text)  # JSON：对话内答题卡等
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class CompanionSession(Base):
    """伴学对话（按文档持久化）。"""

    __tablename__ = "companion_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    document_name: Mapped[str | None] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class CompanionMessage(Base):
    """伴学消息。"""

    __tablename__ = "companion_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
