"""学习分析 API — 聚合知识库与刷题统计"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.schemas.analytics import LearningStatsOut
from app.services import analytics_service

router = APIRouter(tags=["学习分析"])


@router.get("/stats", response_model=LearningStatsOut)
def get_learning_stats(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """汇总文档、题库与刷题进度，供学习分析页展示。"""
    return analytics_service.get_learning_stats(db, current_user["user_id"])
