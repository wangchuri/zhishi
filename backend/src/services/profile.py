"""单用户档案：名字、身份、引导状态。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models.goal import UserProfile
from .task import USER_ID, get_active_goal, goal_out


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_or_create_profile(db: Session) -> UserProfile:
    row = db.get(UserProfile, USER_ID)
    if row:
        return row
    row = UserProfile(user_id=USER_ID, onboarding_status="pending")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def profile_out(db: Session, row: Optional[UserProfile] = None) -> dict[str, Any]:
    row = row or get_or_create_profile(db)
    goal = get_active_goal(db)
    style = (row.tina_style or "default").strip() or "default"
    return {
        "user_id": row.user_id,
        "nickname": row.nickname,
        "role": row.role,
        "onboarding_status": row.onboarding_status or "pending",
        "has_goal": bool(goal and goal.text),
        "goal": goal_out(goal) if goal else None,
        "onboarding_session_id": row.onboarding_session_id,
        "tina_style": style,
        "task_max_daily_count": row.task_max_daily_count if (row.task_max_daily_count or 0) > 0 else None,
        "task_max_study_minutes": row.task_max_study_minutes if (row.task_max_study_minutes or 0) > 0 else None,
    }


def get_tina_style(db: Session) -> str:
    row = get_or_create_profile(db)
    style = (row.tina_style or "default").strip() or "default"
    return style if style in ("default", "tsundere") else "default"


def toggle_tina_style(db: Session) -> str:
    """在 default ↔ tsundere 之间切换，返回切换后的风格。"""
    row = get_or_create_profile(db)
    current = get_tina_style(db)
    nxt = "default" if current == "tsundere" else "tsundere"
    row.tina_style = nxt
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return nxt


def update_profile(
    db: Session,
    *,
    nickname: Optional[str] = None,
    role: Optional[str] = None,
    onboarding_status: Optional[str] = None,
    onboarding_session_id: Optional[str] = None,
    tina_style: Optional[str] = None,
    task_max_daily_count: Optional[int] = None,
    task_max_study_minutes: Optional[int] = None,
    set_task_max_daily_count: bool = False,
    set_task_max_study_minutes: bool = False,
) -> UserProfile:
    row = get_or_create_profile(db)
    if nickname is not None:
        text = nickname.strip()
        row.nickname = text or None
    if role is not None:
        text = role.strip()
        row.role = text or None
    if onboarding_status is not None:
        row.onboarding_status = onboarding_status
    if onboarding_session_id is not None:
        row.onboarding_session_id = onboarding_session_id
    if tina_style is not None:
        style = tina_style.strip() or "default"
        row.tina_style = style if style in ("default", "tsundere") else "default"
    if set_task_max_daily_count:
        try:
            n = int(task_max_daily_count or 0)
        except (TypeError, ValueError):
            n = 0
        row.task_max_daily_count = n if n > 0 else None
    if set_task_max_study_minutes:
        try:
            n = int(task_max_study_minutes or 0)
        except (TypeError, ValueError):
            n = 0
        row.task_max_study_minutes = n if n > 0 else None
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return row
