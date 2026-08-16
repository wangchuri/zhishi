"""学习域 schemas：分析 / 提醒 / 计划 / 成就 / 报告 / 训练 / dashboard。"""

from __future__ import annotations
from datetime import datetime

from typing import Optional

from pydantic import BaseModel


# ---- 分析 ----

class DocumentStats(BaseModel):
    total: int = 0
    indexed: int = 0
    processing: int = 0
    failed: int = 0
    study_zone: int = 0
    with_questions: int = 0


class QuestionStats(BaseModel):
    total: int = 0
    answered: int = 0
    correct: int = 0
    wrong: int = 0
    unknown: int = 0
    accuracy_rate: float = 0.0


class DocumentProgress(BaseModel):
    document_id: str
    document_name: str
    question_total: int = 0
    answered_count: int = 0
    correct_count: int = 0
    wrong_count: int = 0
    unknown_count: int = 0
    accuracy_rate: float = 0.0


class RecentSession(BaseModel):
    id: str
    document_id: Optional[str] = None
    document_name: Optional[str] = None
    status: str = "active"
    total_questions: int = 0
    answered_count: int = 0
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class RecentAnswer(BaseModel):
    question_id: str
    stem: str = ""
    status: str = ""
    document_id: Optional[str] = None
    document_name: Optional[str] = None
    answered_at: Optional[datetime] = None


class LearningStats(BaseModel):
    documents: Optional[DocumentStats] = None
    questions: Optional[QuestionStats] = None
    document_progress: list[DocumentProgress] = []
    recent_sessions: list[RecentSession] = []
    recent_answers: list[RecentAnswer] = []


class TagStats(BaseModel):
    tag: str
    question_type: str = ""
    correct_count: int = 0
    wrong_count: int = 0
    unknown_count: int = 0
    total_attempts: int = 0
    accuracy_rate: float = 0.0


class TagStatsResult(BaseModel):
    by_tag: list[TagStats] = []
    by_question_type: list[TagStats] = []


class ActivityStats(BaseModel):
    today_active_seconds: int = 0
    total_active_seconds: int = 0
    today_quiz_seconds: int = 0
    total_quiz_seconds: int = 0
    due_review_count: int = 0
    unorganized_doc_count: int = 0


class HeatmapDay(BaseModel):
    date: str
    seconds: int = 0


class StreakStats(BaseModel):
    active_days: int = 0
    current_streak: int = 0
    best_streak: int = 0
    heatmap: list[HeatmapDay] = []


class ReportActivityIn(BaseModel):
    seconds: int


# ---- 提醒 ----

class Reminder(BaseModel):
    id: str
    title: str
    remind_date: str
    done: bool = False
    created_at: Optional[datetime] = None


class ReminderCreate(BaseModel):
    title: str
    remind_date: str


class ReminderUpdate(BaseModel):
    title: Optional[str] = None
    remind_date: Optional[str] = None
    done: Optional[bool] = None


class AutoReview(BaseModel):
    count: int = 0
    document_names: list[str] = []


class ReminderList(BaseModel):
    reminders: list[Reminder] = []
    auto_review: Optional[AutoReview] = None


# ---- 计划 ----

class StudyPlan(BaseModel):
    id: str
    title: str
    goal: Optional[str] = None
    task_count: int = 0
    done_count: int = 0
    created_at: Optional[datetime] = None


class StudyPlanCreate(BaseModel):
    title: str
    goal: Optional[str] = None


class PlanTask(BaseModel):
    id: str
    plan_id: str
    title: str
    due_date: Optional[str] = None
    done: bool = False
    position: int = 0
    completed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class PlanTaskCreate(BaseModel):
    title: str
    due_date: Optional[str] = None


class PlanTaskUpdate(BaseModel):
    title: Optional[str] = None
    due_date: Optional[str] = None
    done: Optional[bool] = None


class StudyPlanList(BaseModel):
    plans: list[StudyPlan] = []


class DeletedResult(BaseModel):
    deleted: bool = True


# ---- 成就 ----

class Achievement(BaseModel):
    id: str
    name: str
    description: str
    icon: str = ""
    target: int = 0
    progress: int = 0
    unlocked: bool = False
    unlocked_at: Optional[datetime] = None


class AchievementList(BaseModel):
    achievements: list[Achievement] = []
    newly_unlocked: list[str] = []


# ---- 报告 ----

class LearningReport(BaseModel):
    id: str
    title: str
    content_md: str
    collection_id: Optional[str] = None
    note_type: Optional[str] = "report"
    created_at: Optional[datetime] = None


class ReportGenerateResult(BaseModel):
    report: LearningReport
    saved_to_notes: bool = True


class LearningReportList(BaseModel):
    reports: list[LearningReport] = []
    total: int = 0


# ---- 训练 ----

class WeakTag(BaseModel):
    tag: str
    wrong_count: int = 0
    correct_count: int = 0
    accuracy_rate: float = 0.0


class TargetedTrainingStart(BaseModel):
    report_id: Optional[str] = None
    force_new: bool = False


class TargetedTrainingResult(BaseModel):
    session: Optional[dict] = None
    weak_tags: list[WeakTag] = []
    question_ids: list[str] = []
    report_id: Optional[str] = None
    rationale: Optional[str] = None
    agent_session_id: Optional[str] = None


class TargetedTrainingActiveSession(BaseModel):
    session_id: str
    report_id: Optional[str] = None
    answered_count: int = 0
    total_questions: int = 0
    agent_session_id: Optional[str] = None
    status: str = "active"


class TrainingTutorSend(BaseModel):
    content: str
    stream: bool = False


# ---- Dashboard ----

class SuggestionsResult(BaseModel):
    suggestions: list[str] = []
