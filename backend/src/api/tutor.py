"""Tutor 辅导 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..schemas import quiz as quiz_schemas
from ..services.tutor import tutor_service

router = APIRouter(prefix="/api/v1/tutor", tags=["tutor"])


@router.post("/sessions", response_model=quiz_schemas.TutorSession)
def create_session(body: quiz_schemas.TutorSessionCreate, db: Session = Depends(get_db)):
    session = tutor_service.create_tutor_session(
        db,
        question_id=body.question_id,
        quiz_session_id=body.quiz_session_id,
        quiz_answer_id=body.quiz_answer_id,
    )
    return tutor_service._session_out(db, session)


@router.get("/sessions/{session_id}", response_model=quiz_schemas.TutorSession)
def get_session(session_id: str, db: Session = Depends(get_db)):
    session = tutor_service.get_session(db, session_id)
    return tutor_service._session_out(db, session)


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    body: quiz_schemas.TutorMessageSend,
    db: Session = Depends(get_db),
):
    session = tutor_service.get_session(db, session_id)
    content, reasoning = await tutor_service.send_message(db, session, body.content, stream=body.stream)

    if body.stream:
        async def gen():
            yield f"data: {__import__('json').dumps({'content': content, 'reasoning_content': reasoning}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")

    return {"role": "assistant", "content": content, "reasoning_content": reasoning}
