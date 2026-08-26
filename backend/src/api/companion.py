"""Companion 伴学 API（SSE 流式 + 历史）。"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.llm import format_agent_error, visible_assistant_delta
from ..schemas import ai as ai_schemas
from ..services.companion import companion_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/companion", tags=["companion"])


def _json_line(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def chat(body: ai_schemas.CompanionSend, db: Session = Depends(get_db)):
    agent, session, user_content = await companion_service.send_message(
        db, body.document_id, body.content, body.page_number, body.page_content, stream=True
    )

    async def gen():
        full = ""
        try:
            async for chunk in agent.apredict(user_content):
                c, _r = visible_assistant_delta(chunk)
                if c:
                    full += c
                    yield _json_line({"content": c})
        except Exception as e:
            logger.exception("伴学流式失败")
            err = f"（出错了：{format_agent_error(e)}）"
            full = full or err
            yield _json_line({"content": err})
        finally:
            companion_service.persist_assistant(session.id, full)
            yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/sessions/{document_id}", response_model=ai_schemas.CompanionHistory)
def history(document_id: str, db: Session = Depends(get_db)):
    return companion_service.get_history(db, document_id)
