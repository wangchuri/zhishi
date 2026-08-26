"""提醒 / 计划 / 成就 API。"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..schemas import learning as l_schemas
from ..services.tracking import tracking_service

router = APIRouter(prefix="/api/v1", tags=["tracking"])


# ---- 提醒 ----

@router.get("/reminders", response_model=l_schemas.ReminderList)
def list_reminders(filter: str = "today", db: Session = Depends(get_db)):
    return tracking_service.list_reminders(db, filter)


@router.post("/reminders", response_model=l_schemas.Reminder)
def create_reminder(body: l_schemas.ReminderCreate, db: Session = Depends(get_db)):
    r = tracking_service.create_reminder(db, body.title, body.remind_date)
    return l_schemas.Reminder(id=r.id, title=r.title, remind_date=r.remind_date, done=r.done)


@router.patch("/reminders/{reminder_id}", response_model=l_schemas.Reminder)
def update_reminder(reminder_id: str, body: l_schemas.ReminderUpdate, db: Session = Depends(get_db)):
    r = tracking_service.update_reminder(db, reminder_id, body.title, body.remind_date, body.done)
    return l_schemas.Reminder(id=r.id, title=r.title, remind_date=r.remind_date, done=r.done)


@router.delete("/reminders/{reminder_id}", response_model=l_schemas.DeletedResult)
def delete_reminder(reminder_id: str, db: Session = Depends(get_db)):
    tracking_service.delete_reminder(db, reminder_id)
    return {"deleted": True}


# ---- 计划 ----

@router.get("/plans", response_model=l_schemas.StudyPlanList)
def list_plans(db: Session = Depends(get_db)):
    return tracking_service.list_plans(db)


@router.post("/plans", response_model=l_schemas.StudyPlan)
def create_plan(body: l_schemas.StudyPlanCreate, db: Session = Depends(get_db)):
    p = tracking_service.create_plan(db, body.title, body.goal)
    return l_schemas.StudyPlan(id=p.id, title=p.title, goal=p.goal, task_count=0, done_count=0)


@router.delete("/plans/{plan_id}", response_model=l_schemas.DeletedResult)
def delete_plan(plan_id: str, db: Session = Depends(get_db)):
    tracking_service.delete_plan(db, plan_id)
    return {"deleted": True}


@router.get("/plans/tasks/month")
def list_tasks_by_month(month: str, db: Session = Depends(get_db)):
    tasks = tracking_service.list_tasks_by_month(db, month)
    return [_task_out(t) for t in tasks]


@router.post("/plans/{plan_id}/tasks")
def create_task(plan_id: str, body: l_schemas.PlanTaskCreate, db: Session = Depends(get_db)):
    t = tracking_service.create_task(db, plan_id, body.title, body.due_date)
    return _task_out(t)


@router.patch("/plans/tasks/{task_id}")
def update_task(task_id: str, body: l_schemas.PlanTaskUpdate, db: Session = Depends(get_db)):
    t = tracking_service.update_task(db, task_id, body.title, body.due_date, body.done)
    return _task_out(t)


@router.delete("/plans/tasks/{task_id}", response_model=l_schemas.DeletedResult)
def delete_task(task_id: str, db: Session = Depends(get_db)):
    tracking_service.delete_task(db, task_id)
    return {"deleted": True}


def _task_out(t) -> dict:
    return {
        "id": t.id,
        "plan_id": t.plan_id,
        "title": t.title,
        "due_date": t.due_date,
        "done": t.done,
        "position": t.position,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


# ---- 成就 ----

@router.get("/achievements", response_model=l_schemas.AchievementList)
def list_achievements(db: Session = Depends(get_db)):
    return tracking_service.list_achievements(db)
