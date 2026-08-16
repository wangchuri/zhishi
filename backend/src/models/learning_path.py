"""学习路径：每文档一条，由 Agent 依据目录结构生成。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class DocumentLearningPath(Base):
    """文档学习路径（书本目录结构，Agent 生成）。"""

    __tablename__ = "document_learning_paths"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    path_json: Mapped[str | None] = mapped_column(Text)  # JSON: {title, chapters:[...]}
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/generated/failed
    model: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
