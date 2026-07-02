from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models import GlobalQuestion, QuizAnswer, QuizSession, QuizSessionQuestion


def create_session(
    db: Session,
    *,
    user_id: int,
    document_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    title: Optional[str] = None,
) -> QuizSession:
    row = QuizSession(
        user_id=user_id,
        document_id=document_id,
        collection_id=collection_id,
        title=title,
        status="active",
    )
    db.add(row)
    db.flush()
    return row


def add_session_questions(
    db: Session, session_id: str, question_ids: List[str]
) -> List[QuizSessionQuestion]:
    rows: List[QuizSessionQuestion] = []
    for idx, qid in enumerate(question_ids):
        row = QuizSessionQuestion(
            session_id=session_id,
            question_id=qid,
            order_index=idx,
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def get_session(
    db: Session, session_id: str, user_id: int
) -> Optional[QuizSession]:
    return (
        db.query(QuizSession)
        .filter(QuizSession.id == session_id, QuizSession.user_id == user_id)
        .first()
    )


def list_session_questions(
    db: Session, session_id: str
) -> List[Tuple[QuizSessionQuestion, GlobalQuestion]]:
    return (
        db.query(QuizSessionQuestion, GlobalQuestion)
        .join(GlobalQuestion, QuizSessionQuestion.question_id == GlobalQuestion.id)
        .filter(QuizSessionQuestion.session_id == session_id)
        .order_by(QuizSessionQuestion.order_index.asc())
        .all()
    )


def get_session_question(
    db: Session, session_id: str, question_id: str
) -> Optional[QuizSessionQuestion]:
    return (
        db.query(QuizSessionQuestion)
        .filter(
            QuizSessionQuestion.session_id == session_id,
            QuizSessionQuestion.question_id == question_id,
        )
        .first()
    )


def get_answer(
    db: Session, session_id: str, question_id: str
) -> Optional[QuizAnswer]:
    return (
        db.query(QuizAnswer)
        .filter(
            QuizAnswer.session_id == session_id,
            QuizAnswer.question_id == question_id,
        )
        .first()
    )


def upsert_answer(
    db: Session,
    *,
    session_id: str,
    question_id: str,
    user_id: int,
    user_answer: Optional[str],
    status: str,
    time_spent_seconds: Optional[int] = None,
) -> QuizAnswer:
    existing = get_answer(db, session_id, question_id)
    if existing:
        existing.user_answer = user_answer
        existing.status = status
        existing.answered_at = datetime.utcnow()
        existing.time_spent_seconds = time_spent_seconds
        db.flush()
        return existing

    row = QuizAnswer(
        session_id=session_id,
        question_id=question_id,
        user_id=user_id,
        user_answer=user_answer,
        status=status,
        time_spent_seconds=time_spent_seconds,
    )
    db.add(row)
    db.flush()
    return row


def list_answers_for_session(db: Session, session_id: str) -> List[QuizAnswer]:
    return (
        db.query(QuizAnswer)
        .filter(QuizAnswer.session_id == session_id)
        .order_by(QuizAnswer.answered_at.asc())
        .all()
    )


def count_answers(db: Session, session_id: str) -> int:
    return (
        db.query(QuizAnswer)
        .filter(QuizAnswer.session_id == session_id)
        .count()
    )


def complete_session(db: Session, session: QuizSession) -> QuizSession:
    session.status = "completed"
    session.finished_at = datetime.utcnow()
    db.flush()
    return session
