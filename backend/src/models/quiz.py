"""刷题 + 辅导：会话、会话题目、答题记录、苏格拉底辅导。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class QuizSession(Base):
    """刷题会话。"""

    __tablename__ = "quiz_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # 旧库 quiz_sessions.user_id NOT NULL；单用户默认 1
    user_id: Mapped[int] = mapped_column(Integer, default=1)
    collection_id: Mapped[str | None] = mapped_column(String(36), index=True)
    document_id: Mapped[str | None] = mapped_column(String(36), index=True)
    group_id: Mapped[str | None] = mapped_column(String(36), index=True)
    title: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active/completed
    # 作答方式：instant=每答一题立刻判题看解析；deferred=先答完，最后统一结算
    mode: Mapped[str] = mapped_column(String(20), default="instant")
    # 做题游标：用户当前做到第几题（0-based）。多端/多入口靠它对齐位置，
    # 比"第一道未答的题"更贴合「继续上次」的语义（跳着答也不会回退）。
    progress_index: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)


class QuizSessionQuestion(Base):
    """会话题目（order_index 保持顺序）。"""

    __tablename__ = "quiz_session_questions"

    session_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    question_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)


class QuizAnswer(Base):
    """答题记录。"""

    __tablename__ = "quiz_answers"
    # 同一场会话里一道题只能有一条记录：多端同时提交时，靠这个约束避免插入重复行
    # （重复行会让 answered_count 虚高，出现「手机 100 题、平板 80 题」）
    __table_args__ = (
        UniqueConstraint("session_id", "question_id", name="uq_quiz_answers_session_question"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # 旧库 quiz_answers.user_id NOT NULL；单用户默认 1
    user_id: Mapped[int] = mapped_column(Integer, default=1)
    session_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    question_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    user_answer: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # correct/wrong/unknown/partial
    grade_method: Mapped[str | None] = mapped_column(String(20))  # string/ai
    string_match_status: Mapped[str | None] = mapped_column(String(20))
    ai_reason: Mapped[str | None] = mapped_column(Text)
    time_spent_seconds: Mapped[int | None] = mapped_column(Integer)
    attachments: Mapped[str | None] = mapped_column(Text)  # JSON：拍照作答的图片（上传 id 列表）
    answered_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class TutorSession(Base):
    """苏格拉底辅导会话。"""

    __tablename__ = "tutor_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # 旧库 tutor_sessions.user_id NOT NULL；单用户默认 1
    user_id: Mapped[int] = mapped_column(Integer, default=1)
    question_id: Mapped[str] = mapped_column(String(36), nullable=False)
    document_id: Mapped[str | None] = mapped_column(String(36), index=True)
    segment_id: Mapped[str | None] = mapped_column(String(36))
    quiz_answer_id: Mapped[str | None] = mapped_column(String(36))
    quiz_session_id: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class TutorMessage(Base):
    """辅导会话里的一条消息。

    消息必须落库：Agent 的上下文只活在进程内存里，后端一重启、
    或者用户从刷题页「继续刷题」重进，聊天记录就全没了。
    """

    __tablename__ = "tutor_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user / assistant
    content: Mapped[str | None] = mapped_column(Text)
    reasoning_content: Mapped[str | None] = mapped_column(Text)
    attachments: Mapped[str | None] = mapped_column(Text)  # JSON：图片附件 id 列表
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
