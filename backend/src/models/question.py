"""题库：全局题（tag 全局）、题目溯源、文档级刷题统计。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class GlobalQuestion(Base):
    """全局题目（内容 hash 去重，tag 全局共享）。"""

    __tablename__ = "global_questions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    content_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    stem: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(20), nullable=False)
    options: Mapped[str | None] = mapped_column(Text)  # JSON: [{"key","text"}]
    answer: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[str | None] = mapped_column(Text)  # JSON 数组
    source_type: Mapped[str] = mapped_column(String(20), default="generated")
    difficulty: Mapped[int | None] = mapped_column(Integer)
    html_content: Mapped[str | None] = mapped_column(Text)
    answer_params: Mapped[str | None] = mapped_column(Text)  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class QuestionProvenance(Base):
    """题目溯源：题目 ↔ 文档 / 分段。"""

    __tablename__ = "question_provenance"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    question_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    document_id: Mapped[str | None] = mapped_column(String(36), index=True)
    segment_id: Mapped[str | None] = mapped_column(String(36), index=True)
    excerpt: Mapped[str | None] = mapped_column(Text)


class QuestionRef(Base):
    """文档级题目记录 + 刷题统计（该文档下这道题的数据）。"""

    __tablename__ = "question_refs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    question_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    document_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    collection_id: Mapped[str | None] = mapped_column(String(36), index=True)

    # 刷题统计：未写过时各计数为 0
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, default=0)
    unknown_count: Mapped[int] = mapped_column(Integer, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_status: Mapped[str | None] = mapped_column(String(20))
    last_answered_at: Mapped[datetime | None] = mapped_column(DateTime)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
