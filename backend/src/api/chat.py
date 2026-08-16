"""Chat API：发送（普通/SSE）、历史、会话列表、删除。"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db, SessionLocal
from ..schemas import ai as ai_schemas
from ..services.chat import chat_service

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


def _json_line(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("")
async def send(body: ai_schemas.ChatSend, db: Session = Depends(get_db)):
    session_id = body.session_id
    if not session_id:
        session = chat_service.create_session(db)
        session_id = session.id
    else:
        chat_service.get_session(db, session_id)

    agent, sid = await chat_service.send_message(
        db, session_id, body.content, body.collection_id, stream=body.stream
    )

    if body.stream:
        async def gen():
            try:
                async for chunk in agent.apredict():
                    c = chunk.get("content", "")
                    r = chunk.get("reasoning_content", "")
                    if c:
                        yield _json_line({"content": c, "session_id": sid, "role": "assistant"})
                    if r:
                        yield _json_line({"content": r, "session_id": sid, "role": "assistant", "reasoning_content": True})
            except Exception as e:
                yield _json_line({"content": f"（出错了：{e}）", "session_id": sid, "role": "assistant"})
            finally:
                yield "data: [DONE]\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")

    full, reasoning, citations = await chat_service.consume_and_save(agent, sid)
    return {
        "content": full,
        "session_id": sid,
        "role": "assistant",
        "reasoning_content": reasoning,
        "citations": citations,
    }


@router.get("/history")
def history(session_id: str, db: Session = Depends(get_db)):
    messages = chat_service.get_history(db, session_id)
    return {"session_id": session_id, "messages": messages}


@router.get("/sessions", response_model=ai_schemas.ChatSessionList)
def sessions(db: Session = Depends(get_db)):
    return {"sessions": chat_service.list_sessions(db)}


@router.delete("/sessions/{session_id}")
def delete(session_id: str, db: Session = Depends(get_db)):
    chat_service.delete_session(db, session_id)
    return {"deleted": True}
