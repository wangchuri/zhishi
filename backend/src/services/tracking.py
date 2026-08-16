"""提醒 / 学习计划 / 成就 服务。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.errors import NotFoundError
from ..models import (
    DailyActivity,
    PlanTask,
    QuestionRef,
    Reminder,
    StudyPlan,
    UserAchievement,
    UserNote,
)

# 成就定义
ACHIEVEMENTS = [
    {"id": "first_quiz", "name": "初次刷题", "description": "完成第一道题", "icon": "🎯", "target": 1},
    {"id": "quiz_10", "name": "刷题入门", "description": "累计答对 10 题", "icon": "📚", "target": 10},
    {"id": "quiz_50", "name": "刷题达人", "description": "累计答对 50 题", "icon": "🏆", "target": 50},
    {"id": "quiz_100", "name": "百题斩", "description": "累计答对 100 题", "icon": "💯", "target": 100},
    {"id": "streak_3", "name": "三天打鱼", "description": "连续学习 3 天", "icon": "🔥", "target": 3},
    {"id": "streak_7", "name": "一周坚持", "description": "连续学习 7 天", "icon": "📅", "target": 7},
    {"id": "streak_30", "name": "月月坚持", "description": "连续学习 30 天", "icon": "⭐", "target": 30},
    {"id": "first_note", "name": "记录灵感", "description": "写下第一篇笔记", "icon": "✍️", "target": 1},
]


# ---- 提醒 ----

def list_reminders(db: Session, filter_mode: str = "today") -> dict:
    today = datetime.now(timezone.utc).date().isoformat()
    q = db.query(Reminder)
    if filter_mode == "today":
        q = q.filter(Reminder.remind_date == today)
    elif filter_mode == "week":
        from datetime import timedelta
        end = (datetime.now(timezone.utc).date() + timedelta(days=7)).isoformat()
        q = q.filter(Reminder.remind_date >= today, Reminder.remind_date <= end)
    elif filter_mode == "done":
        q = q.filter(Reminder.done == True)  # noqa: E712
    elif filter_mode == "all":
        pass
    reminders = q.order_by(Reminder.remind_date).all()
    return {
        "reminders": [{
            "id": r.id, "title": r.title, "remind_date": r.remind_date,
            "done": r.done,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in reminders],
        "auto_review": None,
    }


def create_reminder(db: Session, title: str, remind_date: str) -> Reminder:
    r = Reminder(title=title, remind_date=remind_date)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def update_reminder(db: Session, reminder_id: str, title: Optional[str], remind_date: Optional[str], done: Optional[bool]) -> Reminder:
    r = db.get(Reminder, reminder_id)
    if not r:
        raise NotFoundError("提醒不存在")
    if title is not None:
        r.title = title
    if remind_date is not None:
        r.remind_date = remind_date
    if done is not None:
        r.done = done
    db.commit()
    db.refresh(r)
    return r


def delete_reminder(db: Session, reminder_id: str) -> None:
    r = db.get(Reminder, reminder_id)
    if not r:
        raise NotFoundError("提醒不存在")
    db.delete(r)
    db.commit()


# ---- 学习计划 ----

def list_plans(db: Session) -> dict:
    plans = db.query(StudyPlan).order_by(StudyPlan.created_at.desc()).all()
    result = []
    for p in plans:
        tasks = db.query(PlanTask).filter(PlanTask.plan_id == p.id).all()
        result.append({
            "id": p.id,
            "title": p.title,
            "goal": p.goal,
            "task_count": len(tasks),
            "done_count": sum(1 for t in tasks if t.done),
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })
    return {"plans": result}


def create_plan(db: Session, title: str, goal: Optional[str]) -> StudyPlan:
    p = StudyPlan(title=title, goal=goal)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def delete_plan(db: Session, plan_id: str) -> None:
    p = db.get(StudyPlan, plan_id)
    if not p:
        raise NotFoundError("计划不存在")
    db.query(PlanTask).filter(PlanTask.plan_id == plan_id).delete()
    db.delete(p)
    db.commit()


def list_tasks_by_month(db: Session, month: str) -> list[PlanTask]:
    tasks = db.query(PlanTask).filter(PlanTask.due_date.like(f"{month}%")).order_by(PlanTask.due_date).all()
    return tasks


def create_task(db: Session, plan_id: str, title: str, due_date: Optional[str]) -> PlanTask:
    plan = db.get(StudyPlan, plan_id)
    if not plan:
        raise NotFoundError("计划不存在")
    max_pos = db.query(PlanTask).filter(PlanTask.plan_id == plan_id).count()
    t = PlanTask(plan_id=plan_id, title=title, due_date=due_date, position=max_pos)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def update_task(db: Session, task_id: str, title: Optional[str] = None, due_date: Optional[str] = None, done: Optional[bool] = None) -> PlanTask:
    t = db.get(PlanTask, task_id)
    if not t:
        raise NotFoundError("任务不存在")
    if title is not None:
        t.title = title
    if due_date is not None:
        t.due_date = due_date
    if done is not None:
        t.done = done
        t.completed_at = datetime.now(timezone.utc) if done else None
    db.commit()
    db.refresh(t)
    return t


def delete_task(db: Session, task_id: str) -> None:
    t = db.get(PlanTask, task_id)
    if not t:
        raise NotFoundError("任务不存在")
    db.delete(t)
    db.commit()


# ---- 成就 ----

def _progress_map(db: Session) -> dict[str, int]:
    refs = db.query(QuestionRef).all()
    correct_total = sum(r.correct_count or 0 for r in refs)
    notes_count = db.query(UserNote).count()
    active_days = db.query(DailyActivity).count()
    return {
        "first_quiz": correct_total,
        "quiz_10": correct_total,
        "quiz_50": correct_total,
        "quiz_100": correct_total,
        "streak_3": active_days,
        "streak_7": active_days,
        "streak_30": active_days,
        "first_note": notes_count,
    }


def list_achievements(db: Session) -> dict:
    progress_map = _progress_map(db)
    existing = {a.achievement_id: a for a in db.query(UserAchievement).all()}
    newly_unlocked: list[str] = []
    result = []

    for ach in ACHIEVEMENTS:
        progress = progress_map.get(ach["id"], 0)
        unlocked = progress >= ach["target"]
        rec = existing.get(ach["id"])
        if unlocked and rec is None:
            rec = UserAchievement(
                achievement_id=ach["id"],
                progress=progress,
                target=ach["target"],
                unlocked=True,
                unlocked_at=datetime.now(timezone.utc),
            )
            db.add(rec)
            newly_unlocked.append(ach["id"])
        elif rec and unlocked and not rec.unlocked:
            rec.unlocked = True
            rec.unlocked_at = datetime.now(timezone.utc)
            newly_unlocked.append(ach["id"])
        elif rec:
            rec.progress = progress

        result.append({
            "id": ach["id"],
            "name": ach["name"],
            "description": ach["description"],
            "icon": ach["icon"],
            "target": ach["target"],
            "progress": progress,
            "unlocked": unlocked,
            "unlocked_at": rec.unlocked_at.isoformat() if rec and rec.unlocked_at else None,
        })

    db.commit()
    return {"achievements": result, "newly_unlocked": newly_unlocked}
