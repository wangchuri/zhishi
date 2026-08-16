"""题库 schemas（对齐前端 Question/QuestionListResult/PageQuestionResult）。"""

from __future__ import annotations
from datetime import datetime

from typing import Optional

from pydantic import BaseModel


class QuestionOption(BaseModel):
    key: str
    text: str


class AnswerParam(BaseModel):
    key: str
    label: str
    type: str = "text"  # text/number/textarea


class Question(BaseModel):
    id: str
    stem: str
    question_type: str
    options: Optional[list[QuestionOption]] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None
    tags: list[str] = []
    source_type: Optional[str] = None
    document_id: Optional[str] = None
    collection_id: Optional[str] = None
    created_at: Optional[datetime] = None
    user_answer_status: Optional[str] = None  # correct/wrong/unknown/null
    attempt_count: Optional[int] = None
    html_content: Optional[str] = None
    answer_params: Optional[str] = None


class QuestionListResult(BaseModel):
    questions: list[Question]
    total: int
    document_id: Optional[str] = None
    collection_id: Optional[str] = None
    answered_count: Optional[int] = None
    correct_count: Optional[int] = None
    wrong_count: Optional[int] = None
    unknown_count: Optional[int] = None
    best_streak: Optional[int] = None


class PageQuestionResult(BaseModel):
    document_id: str
    page_numbers: list[int]
    mode: str
    question_gen_status: Optional[str] = None
    questions_created: int = 0
    questions_reused: int = 0
    total_questions: int = 0


class GenerateRequest(BaseModel):
    document_id: str
    page_numbers: list[int] = []
    questions_per_page: Optional[int] = None


class GenerateWholeRequest(BaseModel):
    document_id: str
    questions_per_page: Optional[int] = None


class DeleteBulkRequest(BaseModel):
    document_id: Optional[str] = None
    collection_id: Optional[str] = None
    question_ids: Optional[list[str]] = None


class DeleteResult(BaseModel):
    deleted_count: int
    document_id: Optional[str] = None
