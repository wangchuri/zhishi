"""目标与今日任务 API。没有勾选完成接口。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..schemas.task import GoalOut, GoalUpdate, RestoreTaskOut, TaskHistoryOut, TodayTasksOut
from ..services.task import (
    ensure_today_tasks,
    evaluate,
    get_active_goal,
    goal_out,
    history_bundle,
    restore_task,
    task_out,
    today_bundle,
    upsert_active_goal,
)

router = APIRouter(prefix="/api/v1", tags=["tasks"])


@router.get("/me/goal")
def read_goal(db: Session = Depends(get_db)):
    row = get_active_goal(db)
    if not row:
        return None
    return goal_out(row)


@router.put("/me/goal", response_model=GoalOut)
def put_goal(body: GoalUpdate, db: Session = Depends(get_db)):
    try:
        row = upsert_active_goal(db, body.text, body.attributes, body.valid_until)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return goal_out(row)


@router.get("/tasks/today", response_model=TodayTasksOut)
def get_today(db: Session = Depends(get_db)):
    return today_bundle(db)


@router.post("/tasks/today/ensure", response_model=TodayTasksOut)
def ensure_today(db: Session = Depends(get_db)):
    evaluate(db)
    ensure_today_tasks(db)
    return today_bundle(db)


@router.get("/tasks/history", response_model=TaskHistoryOut)
def get_history(days: int = Query(60, ge=1, le=180), db: Session = Depends(get_db)):
    return history_bundle(db, days=days)


@router.post("/tasks/{task_id}/restore", response_model=RestoreTaskOut)
def restore(task_id: str, db: Session = Depends(get_db)):
    try:
        row, newly = restore_task(db, task_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"task": task_out(row), "completed_tasks": newly or None}
