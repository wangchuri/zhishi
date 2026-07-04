"""针对训练 — 基于 Agent 制定计划并创建刷题会话"""
import json
import logging
import re
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.crud import note as note_crud
from app.crud import question as question_crud
from app.crud import training_plan as training_plan_crud
from app.schemas.quiz import QuizSessionCreate
from app.schemas.training import TargetedTrainingStartOut, WeakTagOut
from app.services import analytics_service, quiz_service
from app.services.training_agent import (
    MAX_TRAINING_QUESTIONS,
    TrainingPlanResult,
    training_agent_manager,
)
from app.services.training_tools import (
    get_user_wrong_stats_by_tag,
    search_questions_by_tags,
)

logger = logging.getLogger(__name__)


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


def _fallback_plan(
    db: Session, user_id: int, report_content: Optional[str] = None
) -> TrainingPlanResult:
    """规则回退：无 Agent 或 Agent 未提交计划时使用。"""
    weak_tag_names = _pick_weak_tags(db, user_id, report_content)
    if not weak_tag_names:
        tag_stats = analytics_service.get_tag_stats(db, user_id)
        weak_tag_names = [t.tag for t in tag_stats.by_tag[:5] if t.tag]

    question_ids = search_questions_by_tags(
        db, user_id, weak_tag_names, limit=MAX_TRAINING_QUESTIONS
    )
    if not question_ids:
        rows = question_crud.list_user_questions(db, user_id)
        question_ids = [q.id for _, q in rows[:MAX_TRAINING_QUESTIONS]]

    rationale = (
        f"根据你的错题统计，本轮重点巩固：{'、'.join(weak_tag_names[:5]) or '综合练习'}。"
        "题目从题库中按相关 tag 匹配选取。"
    )
    return TrainingPlanResult(
        question_ids=question_ids,
        weak_tags=weak_tag_names,
        rationale=rationale,
    )


def _build_weak_tags_out(
    db: Session, user_id: int, weak_tag_names: List[str]
) -> List[WeakTagOut]:
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
    return weak_tags_out


def start_targeted_training(db: Session, user_id: int) -> TargetedTrainingStartOut:
    latest = note_crud.get_latest_note(db, user_id, note_type="report")
    report_content = latest.content_md if latest else None
    report_id = latest.id if latest else None
    report_title = latest.title if latest else None

    coach = training_agent_manager.create_agent(user_id, db)
    plan: TrainingPlanResult

    if coach.is_ready:
        plan = coach.plan_training(
            report_content=report_content,
            report_title=report_title,
        )
        if not plan.question_ids:
            logger.info("TrainingCoachAgent 未提交计划，回退规则选题")
            fallback = _fallback_plan(db, user_id, report_content)
            plan.question_ids = fallback.question_ids
            plan.weak_tags = fallback.weak_tags
            if not plan.rationale:
                plan.rationale = fallback.rationale
            coach.inject_plan_context(
                plan.rationale, plan.weak_tags, plan.question_ids
            )
    else:
        plan = _fallback_plan(db, user_id, report_content)
        plan.agent_session_id = coach.agent_session_id

    if not plan.weak_tags:
        plan.weak_tags = _pick_weak_tags(db, user_id, report_content)

    if not plan.question_ids:
        raise HTTPException(status_code=409, detail="题库为空，请先生成题目")

    weak_tags_out = _build_weak_tags_out(db, user_id, plan.weak_tags)

    session = quiz_service.create_quiz_session(
        db,
        user_id,
        QuizSessionCreate(
            question_ids=plan.question_ids[:MAX_TRAINING_QUESTIONS],
            title="针对训练",
        ),
    )

    training_plan_crud.create_training_plan(
        db,
        user_id=user_id,
        quiz_session_id=session.id,
        agent_session_id=plan.agent_session_id or coach.agent_session_id,
        question_ids=plan.question_ids[:MAX_TRAINING_QUESTIONS],
        weak_tags=plan.weak_tags,
        rationale=plan.rationale,
        report_id=report_id,
    )

    return TargetedTrainingStartOut(
        session=session,
        weak_tags=weak_tags_out,
        question_ids=plan.question_ids[:MAX_TRAINING_QUESTIONS],
        report_id=report_id,
        rationale=plan.rationale,
        agent_session_id=plan.agent_session_id or coach.agent_session_id,
    )


def _resolve_coach_agent(
    db: Session, user_id: int, agent_session_id: str
):
    from app.services.training_agent import TrainingCoachAgent

    coach = training_agent_manager.get_agent(agent_session_id, user_id)
    if coach:
        return coach

    plan_row = training_plan_crud.get_by_agent_session(db, user_id, agent_session_id)
    if not plan_row:
        raise HTTPException(status_code=404, detail="训练 Agent 会话不存在")

    coach = TrainingCoachAgent(user_id, agent_session_id, db)
    if not coach.is_ready:
        raise HTTPException(status_code=503, detail="AI 教练暂时不可用")

    question_ids = json.loads(plan_row.question_ids_json or "[]")
    weak_tags = json.loads(plan_row.weak_tags_json or "[]")
    coach.inject_plan_context(plan_row.rationale or "", weak_tags, question_ids)
    training_agent_manager.register_agent(agent_session_id, coach)
    return coach


def stream_training_tutor(
    db: Session,
    user_id: int,
    agent_session_id: str,
    message: str,
):
    """针对训练页 AI 辅导 SSE 流。"""
    coach = _resolve_coach_agent(db, user_id, agent_session_id)
    for chunk in coach.tutor_stream(message):
        yield chunk
