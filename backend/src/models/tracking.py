"""学习记录与追踪：活跃时长、成就、笔记/报告、提醒、学习计划、针对训练。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class DailyActivity(Base):
    """每日活跃/刷题时长 + 连对天数。"""

    __tablename__ = "daily_activity"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 旧库 daily_activity.user_id NOT NULL；单用户默认 1
    user_id: Mapped[int] = mapped_column(Integer, default=1)
    activity_date: Mapped[date] = mapped_column(Date, nullable=False)  # YYYY-MM-DD
    active_seconds: Mapped[int] = mapped_column(Integer, default=0)
    quiz_seconds: Mapped[int] = mapped_column(Integer, default=0)
    current_streak: Mapped[int] = mapped_column(Integer, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class UserAchievement(Base):
    """成就解锁记录（含进度）。"""

    __tablename__ = "user_achievements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    achievement_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    target: Mapped[int] = mapped_column(Integer, default=0)
    unlocked: Mapped[bool] = mapped_column(Boolean, default=False)
    unlocked_at: Mapped[datetime | None] = mapped_column(DateTime)


class UserNote(Base):
    """笔记 / tip / 报告。"""

    __tablename__ = "user_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # 旧库 user_notes.user_id NOT NULL；单用户默认 1
    user_id: Mapped[int] = mapped_column(Integer, default=1)
    collection_id: Mapped[str | None] = mapped_column(String(36), index=True)
    document_id: Mapped[str | None] = mapped_column(String(36), index=True)
    page_number: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str | None] = mapped_column(String(255))
    content_md: Mapped[str | None] = mapped_column(Text)
    note_type: Mapped[str] = mapped_column(String(20), default="manual")  # manual/tip/report
    # 用户给 tip 打的分类 tag，不是资料/题目上的知识点 tag
    user_tags: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class Reminder(Base):
    """智能提醒。"""

    __tablename__ = "reminders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    remind_date: Mapped[str] = mapped_column(String(20), nullable=False)  # YYYY-MM-DD
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class StudyPlan(Base):
    """学习计划。"""

    __tablename__ = "study_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    goal: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PlanTask(Base):
    """计划任务。"""

    __tablename__ = "plan_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    plan_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    due_date: Mapped[str | None] = mapped_column(String(20))  # YYYY-MM-DD
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class TrainingPlan(Base):
    """针对训练计划（错题强化）。"""

    __tablename__ = "training_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # 旧库 training_plans.user_id NOT NULL；单用户默认 1
    user_id: Mapped[int] = mapped_column(Integer, default=1)
    quiz_session_id: Mapped[str | None] = mapped_column(String(36))
    agent_session_id: Mapped[str | None] = mapped_column(String(36))
    question_ids_json: Mapped[str | None] = mapped_column(Text)
    weak_tags_json: Mapped[str | None] = mapped_column(Text)
    rationale: Mapped[str | None] = mapped_column(Text)
    report_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
