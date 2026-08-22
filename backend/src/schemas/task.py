"""目标 / 每日任务 schemas。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel


class CompletedTask(BaseModel):
    id: str
    title: str


class GoalOut(BaseModel):
    id: str
    text: str
    attributes: Optional[dict[str, Any]] = None
    valid_until: Optional[date] = None
    status: str
    created_at: Optional[datetime] = None


class GoalUpdate(BaseModel):
    text: str
    attributes: Optional[dict[str, Any]] = None
    valid_until: Optional[date] = None


class DailyTaskOut(BaseModel):
    id: str
    goal_id: Optional[str] = None
    for_date: date
    title: str
    description: Optional[str] = None
    kind: str
    payload: dict[str, Any] = {}
    checker: str
    status: str
    href: Optional[str] = None
    action: str = "去完成"
    due_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    expired_at: Optional[datetime] = None


class TodayTasksOut(BaseModel):
    goal: Optional[GoalOut] = None
    tasks: list[DailyTaskOut]
    pending_count: int
    expired_count: int = 0
    onboarding_session_id: Optional[str] = None
    completed_tasks: Optional[list[CompletedTask]] = None
    day_complete: bool = False
    refill_pending: bool = False


class TaskHistoryOut(BaseModel):
    tasks: list[DailyTaskOut]
    completed_tasks: Optional[list[CompletedTask]] = None


class RestoreTaskOut(BaseModel):
    task: DailyTaskOut
    completed_tasks: Optional[list[CompletedTask]] = None


class ProfileOut(BaseModel):
    user_id: int = 1
    nickname: Optional[str] = None
    role: Optional[str] = None
    onboarding_status: str = "pending"
    has_goal: bool = False
    onboarding_session_id: Optional[str] = None


class ProfileUpdate(BaseModel):
    nickname: Optional[str] = None
    role: Optional[str] = None
    onboarding_status: Optional[str] = None

