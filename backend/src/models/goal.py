"""目标与每日任务（程序判定完成，不复用 study_plans / plan_tasks）。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[int] = mapped_column(Integer, default=1, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    attributes_json: Mapped[str | None] = mapped_column(Text)
    valid_until: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active/paused/completed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class UserProfile(Base):
    """单用户档案：名字、身份、引导状态。"""

    __tablename__ = "user_profiles"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    nickname: Mapped[str | None] = mapped_column(String(100))
    role: Mapped[str | None] = mapped_column(String(200))
    onboarding_status: Mapped[str] = mapped_column(String(20), default="pending")
    onboarding_session_id: Mapped[str | None] = mapped_column(String(36))
    task_closed_on: Mapped[date | None] = mapped_column(Date)  # 任务 Agent 认为这天不用再派
    task_refill_round: Mapped[int] = mapped_column(Integer, default=0)  # 今日加派评估轮次
    task_refill_round_on: Mapped[date | None] = mapped_column(Date)
    # Tina 说话风格：default | tsundere（/tina 切换傲娇）
    tina_style: Mapped[str] = mapped_column(String(20), default="default")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class DailyTask(Base):
    __tablename__ = "daily_tasks"
    __table_args__ = (
        UniqueConstraint("user_id", "for_date", "fingerprint", name="uq_daily_tasks_fingerprint"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[int] = mapped_column(Integer, default=1, index=True)
    goal_id: Mapped[str | None] = mapped_column(String(36), index=True)
    for_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # upload/generate/quiz/learn
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    checker: Mapped[str] = mapped_column(String(32), nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/completed/expired
    href: Mapped[str | None] = mapped_column(String(500))
    due_at: Mapped[datetime | None] = mapped_column(DateTime)  # 当天结束，过了标记超时
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    expired_at: Mapped[datetime | None] = mapped_column(DateTime)
    evidence_json: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
