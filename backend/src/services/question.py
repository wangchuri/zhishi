"""题目服务：入库（hash 去重）、溯源、文档级统计、查询、删除。"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy.orm import Session

from ..core.errors import AppError
from ..models import (
    Document,
    GlobalQuestion,
    QuestionProvenance,
    QuestionRef,
)
from ..utils import sha256_hex


def _canonical(question: dict) -> str:
    """规范化题目用于 hash：题干+选项+答案。"""
    parts = [
        str(question.get("stem", "")),
        json.dumps(question.get("options", []), ensure_ascii=False, sort_keys=True),
        str(question.get("answer", "")),
    ]
    return "|".join(parts)


def _hash_question(question: dict) -> str:
    return sha256_hex(_canonical(question).encode("utf-8"))


def normalize_question(q: dict) -> dict | None:
    """规范题目标准形态。"""
    stem = str(q.get("stem", "")).strip()
    if not stem:
        return None
    qtype = q.get("question_type") or "single_choice"
    return {
        "stem": stem,
        "question_type": qtype,
        "options": q.get("options") or [],
        "answer": q.get("answer") or "",
        "explanation": q.get("explanation") or "",
        "tags": q.get("tags") or [],
        "source_type": q.get("source") or q.get("source_type") or "ai_generated",
        "reference_text": q.get("reference_text") or "",
        "html_content": q.get("html_content"),
        "answer_params": q.get("answer_params"),
    }


def store_question(
    db: Session,
    document: Document,
    question: dict,
) -> tuple[GlobalQuestion, bool]:
    """入库一道题。返回 (题目, 是否新建)。hash 相同则复用。"""
    q = normalize_question(question)
    if q is None:
        raise AppError("题目缺题干")
    content_hash = _hash_question(q)

    gq = db.query(GlobalQuestion).filter(GlobalQuestion.content_hash == content_hash).first()
    created = gq is None
    if created:
        gq = GlobalQuestion(
            content_hash=content_hash,
            stem=q["stem"],
            question_type=q["question_type"],
            options=json.dumps(q["options"], ensure_ascii=False) if q["options"] else None,
            answer=q["answer"],
            explanation=q["explanation"],
            tags=json.dumps(q["tags"], ensure_ascii=False) if q["tags"] else None,
            source_type=q["source_type"],
            html_content=q["html_content"],
            answer_params=q["answer_params"],
        )
        db.add(gq)
        db.flush()

    # 溯源
    existing = db.query(QuestionProvenance).filter_by(
        question_id=gq.id, document_id=document.id
    ).first()
    if not existing:
        db.add(QuestionProvenance(
            question_id=gq.id,
            document_id=document.id,
            excerpt=q["reference_text"][:500] or None,
        ))

    # 文档级 refs（统计，未写过则计数 0）
    ref = db.query(QuestionRef).filter_by(
        question_id=gq.id, document_id=document.id
    ).first()
    if not ref:
        db.add(QuestionRef(
            question_id=gq.id,
            document_id=document.id,
            collection_id=document.collection_id,
        ))

    return gq, created


def list_questions(
    db: Session,
    document_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    keyword: Optional[str] = None,
) -> dict:
    """列出题目（带文档级统计）。"""
    q = db.query(GlobalQuestion).join(
        QuestionProvenance,
        QuestionProvenance.question_id == GlobalQuestion.id,
    )
    if document_id:
        q = q.filter(QuestionProvenance.document_id == document_id)
    if collection_id:
        q = q.join(QuestionRef, QuestionRef.question_id == GlobalQuestion.id).filter(
            QuestionRef.collection_id == collection_id
        )
    if keyword:
        q = q.filter(GlobalQuestion.stem.like(f"%{keyword}%"))

    total = q.count()
    questions = q.order_by(GlobalQuestion.created_at.desc()).all()

    result = []
    for gq in questions:
        doc_id = document_id
        if not doc_id:
            prov = db.query(QuestionProvenance).filter_by(question_id=gq.id).first()
            doc_id = prov.document_id if prov else None
        ref = None
        if doc_id:
            ref = db.query(QuestionRef).filter_by(question_id=gq.id, document_id=doc_id).first()
        result.append(_question_out(gq, ref, doc_id))

    # 统计
    answered = correct = wrong = unknown = 0
    best_streak = 0
    if document_id:
        refs = db.query(QuestionRef).filter_by(document_id=document_id).all()
        for r in refs:
            answered += r.attempt_count
            correct += r.correct_count
            wrong += r.wrong_count
            unknown += r.unknown_count
            best_streak = max(best_streak, r.best_streak)

    return {
        "questions": result,
        "total": total,
        "document_id": document_id,
        "collection_id": collection_id,
        "answered_count": answered,
        "correct_count": correct,
        "wrong_count": wrong,
        "unknown_count": unknown,
        "best_streak": best_streak,
    }


def _question_out(gq: GlobalQuestion, ref: QuestionRef | None, doc_id: Optional[str]):
    tags = json.loads(gq.tags) if gq.tags else []
    options = json.loads(gq.options) if gq.options else None
    last_status = ref.last_status if ref else None
    if ref and ref.attempt_count > 0:
        user_status = ref.last_status
    else:
        user_status = None
    return {
        "id": gq.id,
        "stem": gq.stem,
        "question_type": gq.question_type,
        "options": options,
        "answer": gq.answer,
        "explanation": gq.explanation,
        "tags": tags,
        "source_type": gq.source_type,
        "document_id": doc_id,
        "html_content": gq.html_content,
        "answer_params": gq.answer_params,
        "created_at": gq.created_at.isoformat() if gq.created_at else None,
        "user_answer_status": user_status,
        "attempt_count": ref.attempt_count if ref else 0,
    }


def get_question(db: Session, question_id: str) -> dict:
    gq = db.get(GlobalQuestion, question_id)
    if not gq:
        raise AppError("题目不存在", status_code=404)
    provs = db.query(QuestionProvenance).filter_by(question_id=question_id).all()
    provenance = [
        {
            "id": p.id,
            "document_id": p.document_id,
            "segment_id": p.segment_id,
            "excerpt": p.excerpt,
        }
        for p in provs
    ]
    return {**_question_out(gq, None, provs[0].document_id if provs else None), "provenance": provenance}


def delete_by_document(db: Session, document_id: str) -> int:
    provs = db.query(QuestionProvenance).filter_by(document_id=document_id).all()
    question_ids = {p.question_id for p in provs}
    db.query(QuestionProvenance).filter_by(document_id=document_id).delete()
    db.query(QuestionRef).filter_by(document_id=document_id).delete()
    db.commit()
    return len(question_ids)


def delete_bulk(
    db: Session,
    document_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    question_ids: Optional[list[str]] = None,
) -> int:
    q = db.query(QuestionRef)
    if document_id:
        q = q.filter(QuestionRef.document_id == document_id)
    if collection_id:
        q = q.filter(QuestionRef.collection_id == collection_id)
    if question_ids:
        q = q.filter(QuestionRef.question_id.in_(question_ids))
    deleted = q.delete()
    db.commit()
    return deleted
