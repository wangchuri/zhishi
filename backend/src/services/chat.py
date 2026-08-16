"""Chat 服务：对话会话管理、RAG 检索工具、tina Agent 流式回复、citation。"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..core.errors import NotFoundError
from ..core.llm import create_agent
from ..models import ChatMessage, ChatSession, Document
from . import rag

logger = logging.getLogger(__name__)

_RAG_PROMPT = """你是知拾（Zhishi）的知识管理助手。你帮助用户管理知识、解答问题。

## 核心能力
- 基于用户知识库中的文档内容回答问题
- 需要检索知识库时请调用 `zhishi_search_knowledge_base` 工具
- 如果知识库中有相关内容，优先基于知识库回答，并引用来源
- 如果知识库中没有相关内容，基于你自身的知识诚实回答

## 回答风格
- 清晰、有条理，适当使用 Markdown 格式
- 对于复杂问题，先给出概述再展开细节
- 如果引用了知识库内容，可以标明"根据你的知识库..."
- 使用中文回答，专业术语保留英文原文
"""


class ChatRAGTools:
    """对话 RAG 检索工具（可指定 collection 范围）。"""

    def __init__(self, collection_id: Optional[str] = None):
        from tina import Tools

        self.collection_id = collection_id
        self.tools = Tools(name="rag")

        @self.tools.register(description="搜索用户知识库中的相关内容")
        async def zhishi_search_knowledge_base(query: str) -> str:
            """搜索知识库，返回匹配的文档片段和相似度分数。
            Args:
                query: 检索查询文本
            """
            results = await asyncio.to_thread(rag.search_all, query, 5)
            if not results:
                return "未找到相关内容"
            lines = []
            for i, r in enumerate(results, 1):
                lines.append(f"[{i}] (文档 {r['document_id'][:8]}, 相关度 {r['distance']:.2f})\n{r['text']}")
            return "\n\n".join(lines)

    def get_tools(self):
        return self.tools


# ---- 会话管理 ----

def create_session(db: Session, title: str = "对话") -> ChatSession:
    session = ChatSession(title=title)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, session_id: str) -> ChatSession:
    session = db.get(ChatSession, session_id)
    if not session:
        raise NotFoundError("会话不存在")
    return session


def list_sessions(db: Session) -> list[dict]:
    sessions = db.query(ChatSession).order_by(ChatSession.updated_at.desc()).all()
    result = []
    for s in sessions:
        count = db.query(ChatMessage).filter(ChatMessage.session_id == s.id).count()
        result.append({
            "id": s.id,
            "title": s.title,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            "message_count": count,
        })
    return result


def get_history(db: Session, session_id: str) -> list[dict]:
    msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at).all()
    return [{
        "role": m.role,
        "content": m.content,
        "reasoning_content": m.reasoning_content,
        "citations": json.loads(m.citations) if m.citations else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    } for m in msgs]


def delete_session(db: Session, session_id: str) -> None:
    get_session(db, session_id)
    db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
    db.delete(db.get(ChatSession, session_id))
    db.commit()


def _save_message(db: Session, session_id: str, role: str, content: str, reasoning: Optional[str], citations: Optional[list]) -> None:
    db.add(ChatMessage(
        session_id=session_id,
        role=role,
        content=content,
        reasoning_content=reasoning,
        citations=json.dumps(citations, ensure_ascii=False) if citations else None,
    ))
    session = db.get(ChatSession, session_id)
    if session:
        session.updated_at = datetime.now(timezone.utc)
    db.commit()


def _load_messages(db: Session, session_id: str, max_messages: int = 20) -> list[dict]:
    msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.desc()).limit(max_messages).all()
    msgs.reverse()
    return [{"role": m.role, "content": m.content} for m in msgs]


async def send_message(
    db: Session,
    session_id: str,
    content: str,
    collection_id: Optional[str],
    *,
    stream: bool,
):
    """发送消息，返回 (agent, 用户消息)。调用方负责消费流。"""
    session = get_session(db, session_id)
    # 保存用户消息
    _save_message(db, session_id, "user", content, None, None)

    rag_tools = ChatRAGTools(collection_id=collection_id)
    agent = create_agent(tools=rag_tools.get_tools(), system_prompt=_RAG_PROMPT)

    history = _load_messages(db, session_id)
    # 注入历史（agent.add_message 逐条）
    for msg in history[:-1]:  # 排除刚存的用户消息
        agent.add_message(role=msg["role"], content=msg["content"])

    return agent, session_id


async def consume_and_save(agent, session_id: str) -> tuple[str, Optional[str], list[dict]]:
    """消费 agent 流式输出，保存 assistant 消息，返回 (内容, reasoning, citations)。"""
    full = ""
    reasoning = ""
    citations: list[dict] = []
    try:
        async for chunk in agent.apredict():
            c = chunk.get("content", "")
            r = chunk.get("reasoning_content", "")
            if c:
                full += c
            if r:
                reasoning += r
    except Exception as e:
        logger.warning("chat 流式失败: %s", e)
        full = full or f"（出错了：{e}）"

    # 简化：若内容包含"根据你的知识库"，尝试附 citation（真实 citation 需工具结果，v2）
    db = SessionLocal()
    try:
        _save_message(db, session_id, "assistant", full, reasoning or None, citations or None)
    finally:
        db.close()
    return full, reasoning or None, citations
