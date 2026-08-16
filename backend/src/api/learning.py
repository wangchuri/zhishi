"""报告 / 训练 / Dashboard API。"""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models import (
    Document,
    GlobalQuestion,
    QuestionProvenance,
    QuestionRef,
    QuizAnswer,
    QuizSession,
    QuizSessionQuestion,
    TrainingPlan,
)
from ..schemas import learning as l_schemas
from ..services.analytics import analytics_service
from ..services.quiz import quiz_service
from ..services.report import report_service

router = APIRouter(prefix="/api/v1", tags=["learning"])


# ---- 报告 ----

@router.post("/reports/generate")
async def generate_report(db: Session = Depends(get_db)):
    report, saved = await report_service.generate_report(db)
    return {"report": report, "saved_to_notes": saved}


@router.get("/reports")
def list_reports(db: Session = Depends(get_db)):
    return report_service.list_reports(db)


@router.get("/reports/latest")
def latest_report(db: Session = Depends(get_db)):
    return report_service.get_latest_report(db)


@router.get("/reports/{report_id}")
def get_report(report_id: str, db: Session = Depends(get_db)):
    return report_service.get_report(db, report_id)


# ---- 针对训练 ----

def _weak_tags(db: Session, report_id: Optional[str]) -> list[dict]:
    stats = analytics_service.get_tag_stats(db)
    weak = [t for t in stats["by_tag"] if t["total_attempts"] > 0 and t["accuracy_rate"] < 0.6]
    weak.sort(key=lambda x: x["accuracy_rate"])
    return weak[:5]


def _pick_questions(db: Session, weak_tags: list[dict], limit: int = 10) -> list[str]:
    """从弱标签对应的题目中选错题/不会的。"""
    tag_names = [t["tag"] for t in weak_tags]
    picked: list[str] = []
    refs = db.query(QuestionRef).filter(QuestionRef.last_status.in_(["wrong", "unknown"])).all()
    refs.sort(key=lambda r: (r.wrong_count or 0) + (r.unknown_count or 0), reverse=True)
    for ref in refs:
        gq = db.get(GlobalQuestion, ref.question_id)
        if not gq:
            continue
        qtags = json.loads(gq.tags) if gq.tags else []
        if any(t in tag_names for t in qtags):
            picked.append(ref.question_id)
        if len(picked) >= limit:
            break
    return picked


@router.post("/training/targeted/start", response_model=l_schemas.TargetedTrainingResult)
def start_targeted(body: l_schemas.TargetedTrainingStart, db: Session = Depends(get_db)):
    # 已有活跃训练会话则复用
    if not body.force_new:
        active = db.query(TrainingPlan).filter(TrainingPlan.quiz_session_id.isnot(None)).first()
        if active and active.quiz_session_id:
            sess = db.get(QuizSession, active.quiz_session_id)
            if sess and sess.status == "active":
                return _training_out(db, active, sess)

    weak = _weak_tags(db, body.report_id)
    question_ids = _pick_questions(db, weak)

    if not question_ids:
        # 无弱标签则用全部题
        refs = db.query(QuestionRef).all()
        question_ids = [r.question_id for r in refs][:10]

    session = quiz_service.create_session(
        db, document_id=None, collection_id=None, question_ids=question_ids,
        title="针对训练", filter_mode="all",
    )

    training = TrainingPlan(
        quiz_session_id=session.id,
        weak_tags_json=json.dumps([{"tag": t["tag"], "wrong_count": t["wrong_count"], "correct_count": t["correct_count"], "accuracy_rate": t["accuracy_rate"]} for t in weak], ensure_ascii=False),
        question_ids_json=json.dumps(question_ids),
        report_id=body.report_id,
    )
    db.add(training)
    db.commit()
    db.refresh(training)

    return _training_out(db, training, session)


def _training_out(db: Session, training: TrainingPlan, session: QuizSession) -> dict:
    session_out = quiz_service._session_out(db, session)
    weak = json.loads(training.weak_tags_json) if training.weak_tags_json else []
    question_ids = json.loads(training.question_ids_json) if training.question_ids_json else []
    return {
        "session": session_out,
        "weak_tags": weak,
        "question_ids": question_ids,
        "report_id": training.report_id,
        "rationale": training.rationale,
        "agent_session_id": training.agent_session_id,
    }


@router.get("/training/targeted/reports/{report_id}/active-session", response_model=l_schemas.TargetedTrainingActiveSession)
def active_session(report_id: str, db: Session = Depends(get_db)):
    training = db.query(TrainingPlan).filter(TrainingPlan.report_id == report_id, TrainingPlan.quiz_session_id.isnot(None)).first()
    if not training or not training.quiz_session_id:
        return None
    sess = db.get(QuizSession, training.quiz_session_id)
    if not sess or sess.status != "active":
        return None
    answered = db.query(QuizAnswer).filter(QuizAnswer.session_id == sess.id).count()
    total = db.query(QuizSessionQuestion).filter(QuizSessionQuestion.session_id == sess.id).count()
    return {
        "session_id": sess.id,
        "report_id": training.report_id,
        "answered_count": answered,
        "total_questions": total,
        "agent_session_id": training.agent_session_id,
        "status": sess.status,
    }


@router.get("/training/targeted/sessions/{session_id}")
def resume_session(session_id: str, db: Session = Depends(get_db)):
    sess = quiz_service.get_session(db, session_id)
    training = db.query(TrainingPlan).filter(TrainingPlan.quiz_session_id == session_id).first()
    return _training_out(db, training, sess) if training else {"session": quiz_service._session_out(db, sess), "weak_tags": [], "question_ids": [], "report_id": None, "rationale": None, "agent_session_id": None}


@router.post("/training/targeted/tutor/{agent_session_id}")
async def training_tutor(agent_session_id: str, body: l_schemas.TrainingTutorSend, db: Session = Depends(get_db)):
    """针对训练的辅导（简化为直接 LLM 回复）。"""
    from ..core.llm import create_agent
    agent = create_agent(system_prompt="你是针对训练的辅导老师，结合学生的错题进行讲解。用中文，引导式教学。")
    content = ""
    async for chunk in agent.apredict(body.content):
        c = chunk.get("content", "")
        if c:
            content += c
    if body.stream:
        async def gen():
            yield f"data: {json.dumps({'content': content}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")
    return {"role": "assistant", "content": content, "agent_session_id": agent_session_id}


# ---- Dashboard ----

@router.get("/dashboard/suggestions", response_model=l_schemas.SuggestionsResult)
async def suggestions(db: Session = Depends(get_db)):
    stats = analytics_service.get_stats(db)
    suggestions = []
    if stats["documents"]["total"] == 0:
        suggestions.append("上传你的第一份学习资料，开始构建知识库")
    if stats["questions"]["answered"] == 0 and stats["questions"]["total"] > 0:
        suggestions.append("文档已生成题目，去刷几道题巩固吧")
    if stats["documents"]["processing"] > 0:
        suggestions.append("有文档正在处理中，稍后回来查看")
    if not suggestions:
        suggestions.append("继续加油，保持学习节奏")
    return {"suggestions": suggestions}
