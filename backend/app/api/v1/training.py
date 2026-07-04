"""针对训练 API"""
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.schemas.training import TargetedTrainingStartOut
from app.services import training_service

router = APIRouter(tags=["针对训练"])


@router.post(
    "/targeted/start",
    response_model=TargetedTrainingStartOut,
    status_code=status.HTTP_201_CREATED,
)
def start_targeted_training(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """读取最新报告与薄弱 tag，从题库检索题目并创建刷题会话。"""
    result = training_service.start_targeted_training(db, current_user["user_id"])
    db.commit()
    return result
