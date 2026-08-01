from fastapi import APIRouter, Depends, Query
from typing import Optional
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.schemas.analytics import LearningStatsOut, TagStatsListOut
from app.schemas.report import LearningReportGenerateOut
from app.services import analytics_service, report_service

router = APIRouter(tags=["学习分析"])


@router.get("/stats", response_model=LearningStatsOut)
def get_learning_stats(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """汇总文档、题库与刷题进度，供学习分析页展示。"""
    return analytics_service.get_learning_stats(db, current_user["user_id"])


@router.get("/tag-stats", response_model=TagStatsListOut)
def get_tag_stats(
    document_id: Optional[str] = Query(None, description="限定到单个文档"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """按 tag 与题型聚合错题统计。支持 document_id 参数限定到特定文档。"""
    return analytics_service.get_tag_stats(
        db, current_user["user_id"], document_id=document_id
    )


@router.post("/learning-report", response_model=LearningReportGenerateOut)
def generate_learning_report(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """生成 LLM 学习报告并保存到笔记（别名路由）。"""
    result = report_service.generate_learning_report(db, current_user["user_id"])
    db.commit()
    return result