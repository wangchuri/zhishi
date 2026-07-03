import json
import logging
from uuid import uuid4
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.core.config import is_local_rag
from app.core.redis import cache
from app.core.agent_manager import agent_manager
from app.schemas.schemas import (
    ChatRequest,
    ChatResponse,
    ChatHistoryItem,
    ChatSession,
    ChatSessionList,
)
from app.services.citation_service import resolve_chat_collection
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


def _session_list_key(user_id: int) -> str:
    return f"chat:sessions:{user_id}"


def _session_meta_key(user_id: int, session_id: str) -> str:
    return f"chat:session:{user_id}:{session_id}"


def _session_history_key(user_id: int, session_id: str) -> str:
    return f"chat:history:{user_id}:{session_id}"


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


# ─── 文件持久化（主存储） ──────────────────────────────

def _file_save_full(user_id: int, session_id: str, meta: dict, messages: List[dict]):
    """将完整会话数据写入文件"""
    try:
        storage_service.save_chat_history(user_id, session_id, {
            "meta": meta,
            "messages": messages,
        })
    except Exception as e:
        logger.error(f"文件保存会话失败: {e}")


def _file_load_full(user_id: int, session_id: str) -> Optional[dict]:
    """从文件读取完整会话数据"""
    try:
        return storage_service.load_chat_history(user_id, session_id)
    except Exception as e:
        logger.error(f"文件读取会话失败: {e}")
        return None


def _file_list_sessions(user_id: int) -> List[dict]:
    """从文件目录列出所有会话"""
    try:
        return storage_service.list_chat_sessions(user_id)
    except Exception as e:
        logger.error(f"文件列出会话失败: {e}")
        return []


def _file_delete_session(user_id: int, session_id: str) -> bool:
    """删除文件中的会话"""
    try:
        return storage_service.delete_chat_history(user_id, session_id)
    except Exception as e:
        logger.error(f"文件删除会话失败: {e}")
        return False


# ─── Redis 辅助函数 ────────────────────────────────────

def _load_session_meta(user_id: int, session_id: str) -> Optional[dict]:
    raw = cache.get_value(_session_meta_key(user_id, session_id))
    return json.loads(raw) if raw else None


def _save_session_meta(user_id: int, session_id: str, meta: dict):
    cache.set_value(_session_meta_key(user_id, session_id), json.dumps(meta))
    cache.lrem(_session_list_key(user_id), 0, session_id)
    cache.lpush(_session_list_key(user_id), session_id)


def _save_message(user_id: int, session_id: str, role: str, content: str) -> dict:
    now = _now_iso()
    message = {
        "role": role,
        "content": content,
        "created_at": now,
    }

    # 1. 写入 Redis
    cache.rpush(_session_history_key(user_id, session_id), json.dumps(message))

    # 2. 更新或创建 meta
    meta = _load_session_meta(user_id, session_id)
    if not meta:
        meta = {
            "id": session_id,
            "title": content[:40] if role == "user" else "新会话",
            "created_at": now,
            "updated_at": now,
            "message_count": 1,
        }
    else:
        meta["updated_at"] = now
        meta["message_count"] = meta.get("message_count", 0) + 1
        if not meta.get("title") and role == "user":
            meta["title"] = content[:40]

    _save_session_meta(user_id, session_id, meta)

    # 3. 同步写入文件持久化
    full_messages = _load_history(user_id, session_id)
    _file_save_full(user_id, session_id, meta, full_messages)

    return message


def _load_history(user_id: int, session_id: str) -> List[dict]:
    # 优先从 Redis 读取
    raw_messages = cache.lrange(_session_history_key(user_id, session_id), 0, -1)
    if raw_messages:
        return [json.loads(item) for item in raw_messages]

    # Redis 为空时，从文件读取回退
    full = _file_load_full(user_id, session_id)
    if full and full.get("messages"):
        return full["messages"]

    return []


def _load_sessions(user_id: int) -> List[dict]:
    # 优先从 Redis 读取
    session_ids = cache.lrange(_session_list_key(user_id), 0, -1) or []
    sessions = []
    for session_id in session_ids:
        meta = _load_session_meta(user_id, session_id)
        if meta:
            sessions.append(meta)

    if sessions:
        return sessions

    # Redis 为空时，从文件读取回退
    return _file_list_sessions(user_id)


def _delete_session(user_id: int, session_id: str) -> bool:
    meta_key = _session_meta_key(user_id, session_id)
    history_key = _session_history_key(user_id, session_id)
    list_key = _session_list_key(user_id)

    # 删除 Redis
    cache.delete_key(meta_key)
    cache.delete_key(history_key)
    cache.lrem(list_key, 0, session_id)

    # 删除文件
    _file_delete_session(user_id, session_id)
    return True


def _generate_assistant_response(user_message: str) -> str:
    return f"已收到：{user_message}"


def _stream_agent_response(
    user_id: int,
    session_id: str,
    message: str,
    dataset_id: str,
    collection_id: Optional[str] = None,
    db: Optional[Session] = None,
    history: Optional[list] = None,
):
    if not dataset_id and not is_local_rag():
        logger.warning(f"_stream_agent_response: user_id={user_id} 没有 dataset_id，使用 echo 回退")
    if not dataset_id and not is_local_rag():
        content = _generate_assistant_response(message)
        data = json.dumps({
            "session_id": session_id,
            "role": "assistant",
            "content": content,
        }, ensure_ascii=False)
        yield f"event: message\ndata: {data}\n\n"
        return

    try:
        agent = agent_manager.get_agent(user_id, dataset_id or "")

        if not agent.is_ready:
            logger.error(f"_stream_agent_response: user_id={user_id} Agent 不可用")
            data = json.dumps({
                "session_id": session_id,
                "role": "assistant",
                "content": "抱歉，AI 服务暂时不可用，请稍后重试。",
            }, ensure_ascii=False)
            yield f"event: message\ndata: {data}\n\n"
            return

        full_content = ""

        for chunk in agent.predict_stream(
            message, history, collection_id=collection_id, db=db
        ):
            role = chunk.get("role", "assistant")
            content = chunk.get("content", "")

            if content:
                full_content += content

            payload = {
                "session_id": session_id,
                "role": role,
                "content": content,
            }

            reasoning = chunk.get("reasoning_content")
            if reasoning:
                payload["reasoning_content"] = reasoning

            tool_name = chunk.get("tool_name")
            if tool_name:
                payload["tool_name"] = tool_name

            citations = chunk.get("citations")
            if citations:
                payload["citations"] = citations

            data = json.dumps(payload, ensure_ascii=False)
            yield f"event: message\ndata: {data}\n\n"

        if full_content:
            try:
                _save_message(user_id, session_id, "assistant", full_content)
            except Exception as e:
                logger.error(f"保存助理消息失败: {e}")

    except Exception as e:
        logger.error(f"_stream_agent_response 异常: {e}", exc_info=True)
        data = json.dumps({
            "session_id": session_id,
            "role": "assistant",
            "content": f"抱歉，处理您的请求时出错：{str(e)}",
        }, ensure_ascii=False)
        yield f"event: message\ndata: {data}\n\n"


@router.post("", response_model=ChatResponse)
def send_chat(
    request: ChatRequest,
    current_user: dict = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    user_id = current_user["user_id"]
    user_dataset_id = current_user.get("dataset_id")
    collection, dataset_id = resolve_chat_collection(
        db, user_id, request.collection_id, user_dataset_id
    )
    collection_id = collection.id

    session_id = request.session_id or uuid4().hex
    session_meta = _load_session_meta(user_id, session_id)

    if session_meta is None and not request.content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新会话必须提供 content"
        )

    _save_message(user_id, session_id, "user", request.content)

    if request.stream:
        history = _load_history(user_id, session_id)
        if history:
            history = history[:-1]

        return StreamingResponse(
            _stream_agent_response(
                user_id=user_id,
                session_id=session_id,
                message=request.content,
                dataset_id=dataset_id,
                collection_id=collection_id,
                db=db,
                history=history,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )

    citations = None
    assistant_content = _generate_assistant_response(request.content)

    if dataset_id or is_local_rag():
        try:
            agent = agent_manager.get_agent(user_id, dataset_id or "")
            if agent.is_ready:
                history = _load_history(user_id, session_id)
                if history:
                    history = history[:-1]
                full_content = ""
                for chunk in agent.predict_stream(
                    request.content,
                    history,
                    collection_id=collection_id,
                    db=db,
                ):
                    if chunk.get("citations"):
                        citations = chunk["citations"]
                    elif chunk.get("content"):
                        full_content += chunk["content"]
                if full_content:
                    assistant_content = full_content
        except Exception as e:
            logger.error(f"非流式 chat Agent 调用失败: {e}")

    _save_message(user_id, session_id, "assistant", assistant_content)

    meta = _load_session_meta(user_id, session_id)
    title = meta.get("title") if meta else request.content[:40]
    return {
        "session_id": session_id,
        "session_title": title,
        "role": "assistant",
        "content": assistant_content,
        "created_at": _now_iso(),
        "citations": citations,
    }


@router.get("/history", response_model=List[ChatHistoryItem])
def get_chat_history(
    session_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    user_id = current_user["user_id"]
    if not session_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session_id is required"
        )

    return _load_history(user_id, session_id)


@router.get("/sessions", response_model=ChatSessionList)
def list_chat_sessions(
    current_user: dict = Depends(get_current_active_user)
):
    user_id = current_user["user_id"]
    sessions = _load_sessions(user_id)
    return {"sessions": sessions}


@router.delete("/sessions/{session_id}")
def delete_chat_session(
    session_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    user_id = current_user["user_id"]
    _delete_session(user_id, session_id)
    return {"message": "Chat session deleted"}