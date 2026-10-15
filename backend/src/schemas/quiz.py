"""刷题与辅导 schemas（对齐前端 QuizSession/QuizAnswerResult/TutorSession）。"""

from __future__ import annotations
from datetime import datetime

from typing import Optional

from pydantic import BaseModel


class QuizQuestionMaterial(BaseModel):
    id: str
    kind: str
    title: Optional[str] = None
    content: Optional[str] = None
    pages: Optional[list[int]] = None
    chapter_id: Optional[str] = None


class QuizSessionQuestion(BaseModel):
    question_id: str
    order_index: int
    stem: str
    question_type: str
    options: Optional[list] = None
    source_type: Optional[str] = None
    html_content: Optional[str] = None
    answer_params: Optional[str] = None
    # 材料题：所属材料（阅读/完形）+ 子题序号
    material_id: Optional[str] = None
    sub_index: Optional[int] = None
    material: Optional[QuizQuestionMaterial] = None
    last_time_spent_seconds: Optional[int] = None


class QuizSession(BaseModel):
    id: str
    title: Optional[str] = None
    status: str = "active"
    document_id: Optional[str] = None
    collection_id: Optional[str] = None
    group_id: Optional[str] = None
    total_questions: int = 0
    answered_count: int = 0
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    questions: list[QuizSessionQuestion] = []


class QuizSessionCreate(BaseModel):
    document_id: Optional[str] = None
    collection_id: Optional[str] = None
    group_id: Optional[str] = None
    question_ids: Optional[list[str]] = None
    chapter_id: Optional[str] = None  # 按书本章节刷题（仅取该章题目）
    sort: Optional[str] = None  # "type"=按题型排序（单选→…→应用），同类型内保持原顺序
    title: Optional[str] = None
    filter: Optional[str] = "all"  # all/undone/wrong/unknown
    tags: Optional[list[str]] = None  # 知识点；不传=全部；多选为并集（任一命中）
    # 试卷模式：按题型配额随机组卷，键为题型（material 表示材料题），值为数量
    type_counts: Optional[dict[str, int]] = None
    resume: bool = True  # 同一批题有未完成会话则续刷
    task_id: Optional[str] = None  # 今日刷题任务 id，续刷后回写 href


class QuizQuestionNoteCreate(BaseModel):
    content_md: str
    document_id: Optional[str] = None
    title: Optional[str] = None


class QuizAnswerSubmit(BaseModel):
    question_id: str
    user_answer: Optional[str] = None
    status: Optional[str] = None  # unknown 标记"我不会"
    time_spent_seconds: Optional[int] = None
    request_ai_grade: Optional[bool] = None
    document_id: Optional[str] = None
    chat_message_id: Optional[str] = None
    attachments: list[str] = []  # AI 判题时随答案一起提交的图片（手写解答照片等）


class QuizAnswerResult(BaseModel):
    question_id: str
    status: str  # correct/wrong/unknown/partial
    correct_answer: Optional[str] = None
    explanation: Optional[str] = None
    citation: Optional[dict] = None
    grade_method: Optional[str] = None  # string/ai
    string_match_status: Optional[str] = None
    ai_reason: Optional[str] = None
    attachments: list[str] = []  # 拍照作答的图片（上传 id）
    answered_count: int = 0
    total_questions: int = 0
    session_status: str = "active"
    current_streak: Optional[int] = None
    completed_tasks: Optional[list[dict]] = None


class QuizReviewItem(BaseModel):
    question_id: str
    stem: str
    user_answer: Optional[str] = None
    status: str = "wrong"
    correct_answer: Optional[str] = None
    explanation: Optional[str] = None
    citation: Optional[dict] = None
    attachments: list[str] = []  # 拍照作答的图片（上传 id）


class QuizResults(BaseModel):
    session_id: str
    status: str
    total_questions: int
    correct_count: int = 0
    wrong_count: int = 0
    unknown_count: int = 0
    total_time_spent_seconds: int = 0
    items: list[QuizReviewItem] = []


class TutorMessage(BaseModel):
    role: str  # user/assistant
    content: str
    reasoning_content: Optional[str] = None
    created_at: Optional[datetime] = None


class TutorSessionCreate(BaseModel):
    question_id: str
    quiz_session_id: Optional[str] = None
    quiz_answer_id: Optional[str] = None


class TutorSession(BaseModel):
    id: str
    question_id: str
    document_id: Optional[str] = None
    segment_id: Optional[str] = None
    quiz_answer_id: Optional[str] = None
    status: str = "active"
    question_stem: Optional[str] = None
    segment_context: Optional[dict] = None
    messages: list[TutorMessage] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class TutorMessageSend(BaseModel):
    content: str
    stream: bool = False
    attachments: list[str] = []  # 上传图片 id
