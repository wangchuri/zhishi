"""Tutor 辅导 API。"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.llm import format_agent_error, visible_assistant_delta
from ..schemas import quiz as quiz_schemas
from ..services.tutor import tutor_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/tutor", tags=["tutor"])


def _json_line(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


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

    if body.stream:
        agent = tutor_service.ensure_agent(db, session)
        tutor_service.touch_session(db, session)

        async def gen():
            try:
                async for chunk in agent.apredict(body.content):
                    c, r = visible_assistant_delta(chunk)
                    if c:
                        yield _json_line({"content": c})
                    if r:
                        yield _json_line({"reasoning_content": r})
            except Exception as e:
                logger.exception("辅导流式失败")
                yield _json_line({"content": f"（辅导出错了：{format_agent_error(e)}）"})
            yield "data: [DONE]\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")

    content, reasoning = await tutor_service.send_message(db, session, body.content)
    return {"role": "assistant", "content": content, "reasoning_content": reasoning}
