"""Companion 伴学 API（SSE 流式 + 历史）。"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..schemas import ai as ai_schemas
from ..services import companion as companion_service

router = APIRouter(prefix="/api/v1/companion", tags=["companion"])


def _json_line(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def chat(body: ai_schemas.CompanionSend, db: Session = Depends(get_db)):
    agent, session = await companion_service.send_message(
        db, body.document_id, body.content, body.page_number, body.page_content, stream=True
    )

    async def gen():
        try:
            async for chunk in agent.apredict():
                c = chunk.get("content", "")
                if c:
                    yield _json_line({"content": c})
        except Exception as e:
            yield _json_line({"content": f"（出错了：{e}）"})
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/sessions/{document_id}", response_model=ai_schemas.CompanionHistory)
def history(document_id: str, db: Session = Depends(get_db)):
    return companion_service.get_history(db, document_id)
