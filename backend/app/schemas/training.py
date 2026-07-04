from typing import List, Optional

from pydantic import BaseModel

from app.schemas.quiz import QuizSessionOut


class WeakTagOut(BaseModel):
    tag: str
    wrong_count: int
    correct_count: int
    accuracy_rate: Optional[int] = None


class TargetedTrainingStartOut(BaseModel):
    session: QuizSessionOut
    weak_tags: List[WeakTagOut] = []
    question_ids: List[str] = []
    report_id: Optional[str] = None
