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
    rationale: Optional[str] = None
    agent_session_id: Optional[str] = None


class TrainingTutorMessageCreate(BaseModel):
    content: str
    stream: bool = True


class TrainingTutorReplyOut(BaseModel):
    role: str = "assistant"
    content: str
    agent_session_id: str
