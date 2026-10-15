"""刷题 API：会话创建/查询/答题/结果。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models import QuizSession
from ..schemas import quiz as quiz_schemas
from ..services.note import note_service
from ..services.quiz import quiz_service

router = APIRouter(prefix="/api/v1/quiz", tags=["quiz"])


@router.post("/sessions", response_model=quiz_schemas.QuizSession)
def create_session(body: quiz_schemas.QuizSessionCreate, db: Session = Depends(get_db)):
    session = quiz_service.create_session(
        db,
        document_id=body.document_id,
        collection_id=body.collection_id,
        group_id=body.group_id,
        chapter_id=body.chapter_id,
        question_ids=body.question_ids,
        title=body.title,
        filter_mode=body.filter or "all",
        tags=body.tags,
        type_counts=body.type_counts,
        sort=body.sort,
        resume=body.resume if body.resume is not None else True,
        task_id=body.task_id,
    )
    return quiz_service._session_out(db, session)


@router.get("/questions/{question_id}/notes")
def list_question_notes(question_id: str, db: Session = Depends(get_db)):
    """某题的全部「做题思路」，按时间升序（旧 → 新）。"""
    notes = note_service.list_question_reflections(db, question_id)
    return {"notes": [note_service.note_to_item(db, n) for n in notes]}


@router.post("/questions/{question_id}/notes")
def add_question_note(
    question_id: str,
    body: quiz_schemas.QuizQuestionNoteCreate,
    db: Session = Depends(get_db),
):
    """追加一条「做题思路」（只增不改，旧条不可编辑）。"""
    note = note_service.save_question_reflection(
        db,
        question_id=question_id,
        content_md=body.content_md,
        document_id=body.document_id,
        title=body.title,
    )
    return note_service.note_to_item(db, note)


@router.get("/active-sessions")
def list_active_sessions(db: Session = Depends(get_db)):
    """未答完的刷题会话，供续刷页使用。"""
    return {"sessions": quiz_service.list_unfinished_sessions(db)}


@router.post("/sessions/{session_id}/complete", response_model=quiz_schemas.QuizSession)
def complete_session(session_id: str, db: Session = Depends(get_db)):
    session = quiz_service.get_session(db, session_id)
    session = quiz_service.complete_session(db, session)
    return quiz_service._session_out(db, session)


@router.get("/sessions/{session_id}", response_model=quiz_schemas.QuizSession)
def get_session(session_id: str, db: Session = Depends(get_db)):
    session = quiz_service.get_session(db, session_id)
    return quiz_service._session_out(db, session)


@router.get("/sessions/recent/by-document/{document_id}")
def recent_active(document_id: str, db: Session = Depends(get_db)):
    session = quiz_service.get_recent_active_by_document(db, document_id)
    if not session:
        return None
    return quiz_service._session_out(db, session)


@router.post("/sessions/{session_id}/answers", response_model=quiz_schemas.QuizAnswerResult)
async def submit_answer(
    session_id: str,
    body: quiz_schemas.QuizAnswerSubmit,
    db: Session = Depends(get_db),
):
    session = quiz_service.get_session(db, session_id)
    result = await quiz_service.submit_answer(
        db,
        session,
        body.question_id,
        body.user_answer,
        body.status,
        body.time_spent_seconds,
        body.request_ai_grade,
        attachments=body.attachments,
    )
    from ..services.task import evaluate
    done = evaluate(db)
    if done:
        result["completed_tasks"] = done
    return result


@router.post("/grade", response_model=quiz_schemas.QuizAnswerResult)
async def grade_standalone(body: quiz_schemas.QuizAnswerSubmit, db: Session = Depends(get_db)):
    result = await quiz_service.grade_standalone(
        db,
        body.question_id,
        body.user_answer,
        body.status,
        document_id=body.document_id,
        request_ai_grade=body.request_ai_grade,
        attachments=body.attachments,
    )
    if body.chat_message_id:
        from ..services.chat import chat_service
        chat_service.update_widget_result(
            body.chat_message_id,
            body.question_id,
            result,
            body.user_answer,
        )
    return result


@router.get("/sessions/{session_id}/results", response_model=quiz_schemas.QuizResults)
def get_results(session_id: str, db: Session = Depends(get_db)):
    session = quiz_service.get_session(db, session_id)
    return quiz_service.get_results(db, session)
