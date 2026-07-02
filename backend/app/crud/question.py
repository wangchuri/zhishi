import json
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models import GlobalQuestion, QuestionProvenance, UserQuestionRef


def get_question_by_content_hash(
    db: Session, content_hash: str
) -> Optional[GlobalQuestion]:
    return (
        db.query(GlobalQuestion)
        .filter(GlobalQuestion.content_hash == content_hash)
        .first()
    )


def get_question_by_id(db: Session, question_id: str) -> Optional[GlobalQuestion]:
    return db.query(GlobalQuestion).filter(GlobalQuestion.id == question_id).first()


def create_global_question(
    db: Session,
    *,
    content_hash: str,
    stem: str,
    question_type: str,
    options_json: Optional[str],
    answer: str,
    explanation: Optional[str],
    tags_json: Optional[str],
    source_type: str = "generated",
) -> GlobalQuestion:
    row = GlobalQuestion(
        content_hash=content_hash,
        stem=stem,
        question_type=question_type,
        options=options_json,
        answer=answer,
        explanation=explanation,
        tags=tags_json,
        source_type=source_type,
    )
    db.add(row)
    db.flush()
    return row


def get_provenance_for_segment(
    db: Session, question_id: str, segment_id: str
) -> Optional[QuestionProvenance]:
    return (
        db.query(QuestionProvenance)
        .filter(
            QuestionProvenance.question_id == question_id,
            QuestionProvenance.segment_id == segment_id,
        )
        .first()
    )


def create_provenance(
    db: Session,
    *,
    question_id: str,
    document_id: str,
    segment_id: str,
    excerpt: Optional[str],
    global_document_id: Optional[str] = None,
) -> QuestionProvenance:
    row = QuestionProvenance(
        question_id=question_id,
        document_id=document_id,
        segment_id=segment_id,
        excerpt=excerpt,
        global_document_id=global_document_id,
    )
    db.add(row)
    db.flush()
    return row


def get_user_ref(
    db: Session, user_id: int, question_id: str, document_id: str
) -> Optional[UserQuestionRef]:
    return (
        db.query(UserQuestionRef)
        .filter(
            UserQuestionRef.user_id == user_id,
            UserQuestionRef.question_id == question_id,
            UserQuestionRef.document_id == document_id,
        )
        .first()
    )


def create_user_ref(
    db: Session,
    *,
    user_id: int,
    question_id: str,
    document_id: str,
    segment_id: Optional[str],
    collection_id: Optional[str],
) -> UserQuestionRef:
    row = UserQuestionRef(
        user_id=user_id,
        question_id=question_id,
        document_id=document_id,
        segment_id=segment_id,
        collection_id=collection_id,
    )
    db.add(row)
    db.flush()
    return row


def list_user_questions(
    db: Session,
    user_id: int,
    document_id: Optional[str] = None,
    collection_id: Optional[str] = None,
) -> List[Tuple[UserQuestionRef, GlobalQuestion]]:
    query = (
        db.query(UserQuestionRef, GlobalQuestion)
        .join(GlobalQuestion, UserQuestionRef.question_id == GlobalQuestion.id)
        .filter(UserQuestionRef.user_id == user_id)
    )
    if document_id:
        query = query.filter(UserQuestionRef.document_id == document_id)
    if collection_id:
        query = query.filter(UserQuestionRef.collection_id == collection_id)
    return query.order_by(UserQuestionRef.added_at.desc()).all()


def list_provenance_for_question(
    db: Session, question_id: str
) -> List[QuestionProvenance]:
    return (
        db.query(QuestionProvenance)
        .filter(QuestionProvenance.question_id == question_id)
        .all()
    )


def parse_options_json(raw: Optional[str]) -> Optional[list]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def parse_tags_json(raw: Optional[str]) -> Optional[list]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
