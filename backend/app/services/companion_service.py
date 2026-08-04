"""
伴学对话服务 — 按书持久化的阅读助手对话。

设计：
- 独立于 agent_manager 的 per-user ZhishiAgent 缓存（避免污染普通聊天页的 system prompt）
- 每本书一个持续会话：storage/{user_id}/companion/{document_id}.json
- 每次对话前渲染 companion/chat.md.j2（含页码/页内容占位）并通过 set_system_prompt 注入
"""
import json
import logging
import threading
from datetime import datetime
from typing import AsyncGenerator, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.crud import kb as kb_crud
from app.services.prompt_service import render_prompt
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

# per-user 伴学 Agent 缓存（独立于 agent_manager 共享池）
_agent_lock = threading.Lock()
_agent_cache: Dict[int, object] = {}


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _resolve_document_name(db: Session, user_id: int, document_id: str) -> str:
    doc = kb_crud.get_document_by_id_or_dify(db, user_id, document_id)
    if doc:
        return doc.display_name or "文档"
    return "文档"


def _resolve_document_meta(
    db: Session, user_id: int, document_id: str
) -> Tuple[str, Optional[str]]:
    """返回 (document_name, collection_id)。"""
    doc = kb_crud.get_document_by_id_or_dify(db, user_id, document_id)
    if doc:
        return (doc.display_name or "文档"), doc.collection_id
    return "文档", None


def _load_session(db: Session, user_id: int, document_id: str) -> dict:
    """加载某本书的伴学会话（meta + messages）。不存在时返回空会话。"""
    doc_name, collection_id = _resolve_document_meta(db, user_id, document_id)
    raw = storage_service.load_companion_history(user_id, document_id)
    if raw:
        messages = raw.get("messages") or []
        meta = raw.get("meta") or {}
        # 文档重命名后同步书名
        meta["document_name"] = doc_name
        meta["collection_id"] = collection_id
        return {"meta": meta, "messages": messages}
    now = _now_iso()
    return {
        "meta": {
            "document_id": document_id,
            "document_name": doc_name,
            "collection_id": collection_id,
            "created_at": now,
            "updated_at": now,
        },
        "messages": [],
    }


def _save_session(user_id: int, document_id: str, session: dict) -> None:
    session["meta"]["updated_at"] = _now_iso()
    storage_service.save_companion_history(user_id, document_id, session)


def _append_message(
    db: Session, user_id: int, document_id: str, role: str, content: str
) -> dict:
    message = {"role": role, "content": content, "created_at": _now_iso()}
    session = _load_session(db, user_id, document_id)
    session["messages"].append(message)
    session["meta"]["message_count"] = len(session["messages"])
    _save_session(user_id, document_id, session)
    return message


def _build_system_prompt(
    document_name: str,
    page_number: Optional[int],
    page_content: Optional[str],
) -> str:
    return render_prompt(
        "companion/chat.md.j2",
        variables={
            "document_name": document_name,
            "page_number": page_number if page_number is not None else "—",
            "page_content": page_content or "（当前页无文本内容）",
        },
    )


def _get_agent(user_id: int, dataset_id: str = ""):
    """获取（或创建）用户的伴学独立 Agent 实例。"""
    global _agent_cache
    with _agent_lock:
        agent = _agent_cache.get(user_id)
        if agent is not None:
            return agent
        from app.agents.zhishi_agent import ZhishiAgent

        agent = ZhishiAgent(user_id=user_id, dataset_id=dataset_id)
        _agent_cache[user_id] = agent
        logger.info("伴学 Agent 已创建: user_id=%s", user_id)
        return agent


def clear_agent_cache(user_id: int) -> None:
    with _agent_lock:
        _agent_cache.pop(user_id, None)


def get_session(db: Session, user_id: int, document_id: str) -> dict:
    """返回某本书的伴学会话（用于历史加载）。"""
    return _load_session(db, user_id, document_id)


async def stream_companion_reply(
    db: Session,
    user_id: int,
    document_id: str,
    content: str,
    page_number: Optional[int],
    page_content: Optional[str],
    dataset_id: str = "",
) -> AsyncGenerator[dict, None]:
    """
    伴学流式对话：
    1. 保存 user 消息
    2. 渲染系统提示词占位 → set_system_prompt
    3. 复用 ZhishiAgent.predict_stream 流式回复（含 RAG / citations）
    4. 保存 assistant 消息
    """
    session = _load_session(db, user_id, document_id)
    doc_name = session["meta"].get("document_name") or "文档"
    collection_id = session["meta"].get("collection_id")

    _append_message(db, user_id, document_id, "user", content)

    agent = _get_agent(user_id, dataset_id)
    if agent is None or not agent.is_ready:
        msg = "抱歉，AI 服务暂时不可用，请稍后重试。"
        _append_message(db, user_id, document_id, "assistant", msg)
        yield {"role": "assistant", "content": msg}
        return

    system = _build_system_prompt(doc_name, page_number, page_content)
    agent.set_system_prompt(system)

    full_content = ""
    try:
        async for chunk in agent.predict_stream(
            content, collection_id=collection_id, db=db
        ):
            role = chunk.get("role", "assistant")
            text = chunk.get("content", "")
            if text:
                full_content += text
            yield {
                "role": role,
                "content": text,
                **({"citations": chunk["citations"]} if chunk.get("citations") else {}),
            }
    except Exception as e:
        logger.exception("伴学对话失败: user_id=%s document_id=%s", user_id, document_id)
        err_msg = f"抱歉，处理请求时出错：{str(e)}"
        _append_message(db, user_id, document_id, "assistant", err_msg)
        yield {"role": "assistant", "content": err_msg}
        return

    if full_content:
        _append_message(db, user_id, document_id, "assistant", full_content)
