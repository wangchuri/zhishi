"""学习分析服务：统计、tag 分析、活跃时长、连对天数。"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..models import (
    DailyActivity,
    Document,
    DocumentSegment,
    GlobalQuestion,
    QuestionProvenance,
    QuestionRef,
    QuizAnswer,
    QuizSession,
)


def _today() -> date:
    return datetime.now(timezone.utc).date()


# ---- 文档/题目统计 ----

def get_stats(db: Session) -> dict:
    documents = db.query(Document).all()
    doc_stats = {
        "total": len(documents),
        "indexed": sum(1 for d in documents if d.indexing_status == "completed"),
        "processing": sum(1 for d in documents if d.indexing_status in ("pending", "processing")),
        "failed": sum(1 for d in documents if d.indexing_status == "failed"),
        "study_zone": sum(1 for d in documents if d.zone == "study"),
        "with_questions": sum(1 for d in documents if d.question_gen_status == "completed"),
    }

    refs = db.query(QuestionRef).all()
    total_q = len(refs)
    answered = sum(1 for r in refs if r.attempt_count and r.attempt_count > 0)
    correct = sum(r.correct_count or 0 for r in refs)
    wrong = sum(r.wrong_count or 0 for r in refs)
    unknown = sum(r.unknown_count or 0 for r in refs)
    total_attempts = correct + wrong + unknown
    q_stats = {
        "total": total_q,
        "answered": answered,
        "correct": correct,
        "wrong": wrong,
        "unknown": unknown,
        "accuracy_rate": round(correct / total_attempts, 3) if total_attempts else 0.0,
    }

    # 每文档进度
    doc_progress = []
    for d in documents:
        doc_refs = db.query(QuestionRef).filter(QuestionRef.document_id == d.id).all()
        if not doc_refs:
            continue
        c = sum(r.correct_count or 0 for r in doc_refs)
        w = sum(r.wrong_count or 0 for r in doc_refs)
        u = sum(r.unknown_count or 0 for r in doc_refs)
        ans = sum(1 for r in doc_refs if r.attempt_count)
        total = len(doc_refs)
        doc_progress.append({
            "document_id": d.id,
            "document_name": d.display_name,
            "question_total": total,
            "answered_count": ans,
            "correct_count": c,
            "wrong_count": w,
            "unknown_count": u,
            "accuracy_rate": round(c / (c + w + u), 3) if (c + w + u) else 0.0,
        })
    doc_progress.sort(key=lambda x: x["question_total"], reverse=True)

    # 最近会话
    sessions = db.query(QuizSession).order_by(QuizSession.started_at.desc()).limit(5).all()
    recent_sessions = []
    for s in sessions:
        doc = db.get(Document, s.document_id) if s.document_id else None
        recent_sessions.append({
            "id": s.id,
            "document_id": s.document_id,
            "document_name": doc.display_name if doc else None,
            "status": s.status,
            "total_questions": db.query(DocumentSegment).filter(DocumentSegment.document_id == s.document_id).count() if False else 0,
            "answered_count": db.query(QuizAnswer).filter(QuizAnswer.session_id == s.id).count(),
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "finished_at": s.finished_at.isoformat() if s.finished_at else None,
        })

    # 最近答题
    answers = db.query(QuizAnswer).order_by(QuizAnswer.answered_at.desc()).limit(5).all()
    recent_answers = []
    for a in answers:
        gq = db.get(GlobalQuestion, a.question_id)
        doc = None
        if a.session_id:
            s = db.get(QuizSession, a.session_id)
            if s and s.document_id:
                doc = db.get(Document, s.document_id)
        recent_answers.append({
            "question_id": a.question_id,
            "stem": gq.stem if gq else "",
            "status": a.status,
            "document_id": doc.id if doc else None,
            "document_name": doc.display_name if doc else None,
            "answered_at": a.answered_at.isoformat() if a.answered_at else None,
        })

    return {
        "documents": doc_stats,
        "questions": q_stats,
        "document_progress": doc_progress,
        "recent_sessions": recent_sessions,
        "recent_answers": recent_answers,
    }


# ---- Tag 统计 ----

def get_tag_stats(db: Session, document_id: Optional[str] = None) -> dict:
    from ..models import QuestionRef

    q = db.query(QuestionRef)
    if document_id:
        q = q.filter(QuestionRef.document_id == document_id)
    refs = q.all()

    by_tag: dict[str, dict] = {}
    by_type: dict[str, dict] = {}
    for ref in refs:
        gq = db.get(GlobalQuestion, ref.question_id)
        if not gq:
            continue
        # 按 tag
        tags = json.loads(gq.tags) if gq.tags else []
        for tag in tags:
            stat = by_tag.setdefault(tag, {"correct_count": 0, "wrong_count": 0, "unknown_count": 0, "total_attempts": 0})
            stat["correct_count"] += ref.correct_count or 0
            stat["wrong_count"] += ref.wrong_count or 0
            stat["unknown_count"] += ref.unknown_count or 0
            stat["total_attempts"] += ref.attempt_count or 0
        # 按题型
        ttype = gq.question_type
        stat = by_type.setdefault(ttype, {"correct_count": 0, "wrong_count": 0, "unknown_count": 0, "total_attempts": 0})
        stat["correct_count"] += ref.correct_count or 0
        stat["wrong_count"] += ref.wrong_count or 0
        stat["unknown_count"] += ref.unknown_count or 0
        stat["total_attempts"] += ref.attempt_count or 0

    def _out(name: str, stat: dict, qtype: str = "") -> dict:
        total = stat["total_attempts"]
        acc = round(stat["correct_count"] / total, 3) if total else 0.0
        return {
            "tag": name,
            "question_type": qtype,
            "correct_count": stat["correct_count"],
            "wrong_count": stat["wrong_count"],
            "unknown_count": stat["unknown_count"],
            "total_attempts": stat["total_attempts"],
            "accuracy_rate": acc,
        }

    by_tag_out = [_out(name, stat) for name, stat in by_tag.items()]
    by_tag_out.sort(key=lambda x: x["total_attempts"], reverse=True)
    by_type_out = [_out(name, stat, qtype=name) for name, stat in by_type.items()]
    return {"by_tag": by_tag_out, "by_question_type": by_type_out}


# ---- 活跃时长 ----

def report_activity(db: Session, seconds: int) -> dict:
    today = _today()
    row = db.query(DailyActivity).filter(DailyActivity.activity_date == today).first()
    if not row:
        row = DailyActivity(activity_date=today, active_seconds=0, quiz_seconds=0)
        db.add(row)
    row.active_seconds = (row.active_seconds or 0) + seconds
    db.commit()

    all_rows = db.query(DailyActivity).all()
    total_active = sum(r.active_seconds or 0 for r in all_rows)
    today_quiz = row.quiz_seconds or 0
    total_quiz = sum(r.quiz_seconds or 0 for r in all_rows)
    return {
        "today_active_seconds": row.active_seconds or 0,
        "total_active_seconds": total_active,
        "today_quiz_seconds": today_quiz,
        "total_quiz_seconds": total_quiz,
        "due_review_count": 0,
        "unorganized_doc_count": db.query(Document).filter(Document.segment_status != "completed").count(),
    }


def get_activity(db: Session) -> dict:
    today = _today()
    row = db.query(DailyActivity).filter(DailyActivity.activity_date == today).first()
    all_rows = db.query(DailyActivity).all()
    total_active = sum(r.active_seconds or 0 for r in all_rows)
    return {
        "today_active_seconds": row.active_seconds or 0 if row else 0,
        "total_active_seconds": total_active,
        "today_quiz_seconds": row.quiz_seconds or 0 if row else 0,
        "total_quiz_seconds": sum(r.quiz_seconds or 0 for r in all_rows),
        "due_review_count": 0,
        "unorganized_doc_count": db.query(Document).filter(Document.segment_status != "completed").count(),
    }


# ---- 连对天数 ----

def get_streak(db: Session) -> dict:
    rows = db.query(DailyActivity).order_by(DailyActivity.activity_date).all()
    active_rows = [r for r in rows if (r.active_seconds or 0) > 0 or (r.quiz_seconds or 0) > 0]

    # 当前连续
    today = _today()
    date_set = {r.activity_date for r in active_rows}
    current_streak = 0
    cursor = today
    for _ in range(2):
        if cursor in date_set:
            break
        cursor -= timedelta(days=1)
    while cursor in date_set:
        current_streak += 1
        cursor -= timedelta(days=1)

    best = max((r.best_streak or 0) for r in rows) if rows else 0
    heatmap = [{"date": r.activity_date.isoformat(), "seconds": (r.active_seconds or 0) + (r.quiz_seconds or 0)} for r in rows[-120:]]
    return {
        "active_days": len(active_rows),
        "current_streak": current_streak,
        "best_streak": best,
        "heatmap": heatmap,
    }
