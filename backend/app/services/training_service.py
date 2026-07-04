"""针对训练 — 基于薄弱 tag 从题库检索题目并创建刷题会话"""
import json
import logging
import re
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.crud import note as note_crud
from app.crud import question as question_crud
from app.schemas.quiz import QuizSessionCreate
from app.schemas.training import TargetedTrainingStartOut, WeakTagOut
from app.services import analytics_service, quiz_service
from app.services.training_tools import (
    get_user_wrong_stats_by_tag,
    search_questions_by_tags,
)

logger = logging.getLogger(__name__)

MAX_TRAINING_QUESTIONS = 20


def _extract_tags_from_report(content_md: str) -> List[str]:
    """从报告 Markdown 中提取可能的知识点 tag（启发式）。"""
    tags: List[str] = []
    for line in content_md.splitlines():
        if "薄弱" in line or "优先" in line or "tag" in line.lower():
            bold = re.findall(r"\*\*([^*]+)\*\*", line)
            tags.extend(bold)
        bullet_tags = re.findall(r"[-*]\s*\*\*([^*]+)\*\*", line)
        tags.extend(bullet_tags)
    seen = set()
    result = []
    for t in tags:
        t = t.strip()
        if t and t not in seen and len(t) < 50:
            seen.add(t)
            result.append(t)
    return result[:10]


def _pick_weak_tags(db: Session, user_id: int, report_content: Optional[str] = None) -> List[str]:
    if report_content:
        from_report = _extract_tags_from_report(report_content)
        if from_report:
            return from_report

    stats = get_user_wrong_stats_by_tag(db, user_id, min_wrong=1, limit=8)
    if stats:
        return [s["tag"] for s in stats]

    tag_stats = analytics_service.get_tag_stats(db, user_id)
    weak = sorted(
        tag_stats.by_tag,
        key=lambda x: (-x.wrong_count, x.accuracy_rate or 100),
    )
    return [t.tag for t in weak if t.wrong_count > 0][:8]


def start_targeted_training(db: Session, user_id: int) -> TargetedTrainingStartOut:
    latest = note_crud.get_latest_note(db, user_id, note_type="report")
    report_content = latest.content_md if latest else None
    report_id = latest.id if latest else None

    weak_tag_names = _pick_weak_tags(db, user_id, report_content)
    if not weak_tag_names:
        tag_stats = analytics_service.get_tag_stats(db, user_id)
        weak_tag_names = [t.tag for t in tag_stats.by_tag[:5] if t.tag]

    if not weak_tag_names:
        raise HTTPException(
            status_code=409,
            detail="暂无薄弱知识点数据，请先刷题并生成学习报告",
        )

    question_ids = search_questions_by_tags(
        db, user_id, weak_tag_names, limit=MAX_TRAINING_QUESTIONS
    )

    if not question_ids:
        rows = question_crud.list_user_questions(db, user_id)
        question_ids = [q.id for _, q in rows[:MAX_TRAINING_QUESTIONS]]

    if not question_ids:
        raise HTTPException(status_code=409, detail="题库为空，请先生成题目")

    wrong_stats = get_user_wrong_stats_by_tag(db, user_id, min_wrong=0, limit=20)
    stat_map = {s["tag"]: s for s in wrong_stats}
    weak_tags_out: List[WeakTagOut] = []
    for name in weak_tag_names:
        s = stat_map.get(name, {})
        graded = s.get("correct_count", 0) + s.get("wrong_count", 0)
        acc = round(s.get("correct_count", 0) / graded * 100) if graded else None
        weak_tags_out.append(
            WeakTagOut(
                tag=name,
                wrong_count=s.get("wrong_count", 0),
                correct_count=s.get("correct_count", 0),
                accuracy_rate=acc,
            )
        )

    session = quiz_service.create_quiz_session(
        db,
        user_id,
        QuizSessionCreate(
            question_ids=question_ids,
            title="针对训练",
        ),
    )

    return TargetedTrainingStartOut(
        session=session,
        weak_tags=weak_tags_out,
        question_ids=question_ids,
        report_id=report_id,
    )
