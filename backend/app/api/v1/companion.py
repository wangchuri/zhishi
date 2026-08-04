"""
伴学对话 API — 按书持久化的阅读助手（SSE 流式 + 历史加载）。

与普通聊天隔离：使用独立 Agent 实例，系统提示词按当前页动态渲染。
"""
import json
import logging
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.schemas.schemas import (
    CompanionChatRequest,
    CompanionHistoryItem,
    CompanionSessionOut,
)
from app.services import companion_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["伴学对话"])


def _parse_datetime(value) -> datetime:
    if isinstance(value, datetime):
        return value
    if value:
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.utcnow()


@router.post("/chat")
async def companion_chat(
    payload: CompanionChatRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """伴学 SSE 流式对话：保存 user 消息 → 更新系统提示词占位 → 流式回复。"""
    user_id = current_user["user_id"]
    dataset_id = current_user.get("dataset_id") or ""

    # 校验文档归属
    from app.crud import kb as kb_crud

    doc = kb_crud.get_document_by_id_or_dify(db, user_id, payload.document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    async def event_stream():
        try:
            async for chunk in companion_service.stream_companion_reply(
                db,
                user_id,
                payload.document_id,
                payload.content,
                payload.page_number,
                payload.page_content,
                dataset_id=dataset_id,
            ):
                data = json.dumps(chunk, ensure_ascii=False)
                yield f"event: message\ndata: {data}\n\n"
        finally:
            db.commit()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions/{document_id}", response_model=CompanionSessionOut)
def get_companion_session(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """返回某本书的伴学对话历史（含 meta 与 messages）。"""
    user_id = current_user["user_id"]
    session = companion_service.get_session(db, user_id, document_id)
    messages = [
        CompanionHistoryItem(
            role=m.get("role", "user"),
            content=m.get("content", ""),
            created_at=_parse_datetime(m.get("created_at")),
        )
        for m in session["messages"]
    ]
    return CompanionSessionOut(
        document_id=document_id,
        document_name=session["meta"].get("document_name") or "文档",
        updated_at=_parse_datetime(session["meta"].get("updated_at")),
        messages=messages,
    )
