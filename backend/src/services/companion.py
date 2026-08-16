"""Companion 伴学服务：按文档对话，注入当前页上下文。"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..core.errors import NotFoundError
from ..core.llm import create_agent
from ..models import CompanionMessage, CompanionSession, Document

logger = logging.getLogger(__name__)

_PROMPT = """你是知拾的伴学老师，陪用户一起阅读这本「{document_name}」。

当前用户在阅读第 {page_number} 页：
```
{page_content}
```

## 规则
1. 结合当前页内容和全书知识，帮助用户理解、答疑
2. 用中文交流，语气亲切
3. 如果用户问的是当前页之外的内容，基于你已有的知识回答
4. 适当引用书中的内容帮助理解

## 历史对话
{history}
"""


def _get_or_create_session(db: Session, document_id: str, document_name: str) -> CompanionSession:
    session = db.query(CompanionSession).filter(CompanionSession.document_id == document_id).first()
    if not session:
        session = CompanionSession(document_id=document_id, document_name=document_name)
        db.add(session)
        db.commit()
        db.refresh(session)
    return session


def get_history(db: Session, document_id: str) -> dict:
    session = _get_or_create_session(db, document_id, "")
    msgs = db.query(CompanionMessage).filter(CompanionMessage.session_id == session.id).order_by(CompanionMessage.created_at).all()
    return {
        "document_id": document_id,
        "document_name": session.document_name,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "messages": [{
            "role": m.role,
            "content": m.content,
            "citations": json.loads(m.citations) if m.citations else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        } for m in msgs],
    }


def _load_history(db: Session, session_id: str, max_messages: int = 16) -> list[dict]:
    msgs = db.query(CompanionMessage).filter(CompanionMessage.session_id == session_id).order_by(CompanionMessage.created_at.desc()).limit(max_messages).all()
    msgs.reverse()
    return [{"role": m.role, "content": m.content} for m in msgs]


async def send_message(
    db: Session,
    document_id: str,
    content: str,
    page_number: Optional[int],
    page_content: Optional[str],
    *,
    stream: bool,
):
    doc = db.get(Document, document_id)
    if not doc:
        raise NotFoundError("文档不存在")

    session = _get_or_create_session(db, document_id, doc.display_name)

    # 保存用户消息
    db.add(CompanionMessage(session_id=session.id, role="user", content=content))
    session.updated_at = datetime.now(timezone.utc)
    db.commit()

    history = _load_history(db, session.id)
    history_str = "\n".join(f"{'用户' if m['role']=='user' else '伴学'}: {m['content']}" for m in history[:-1])

    prompt = _PROMPT.format(
        document_name=doc.display_name,
        page_number=page_number or 1,
        page_content=(page_content or "")[:2000],
        history=history_str,
    )
    agent = create_agent(system_prompt=prompt)

    # 追加历史（agent 内存）与当前消息
    for m in history[:-1]:
        agent.add_message(role=m["role"], content=m["content"])

    return agent, session


async def consume_and_save(agent, session) -> tuple[str, Optional[str]]:
    full = ""
    reasoning = ""
    try:
        async for chunk in agent.apredict():
            c = chunk.get("content", "")
            r = chunk.get("reasoning_content", "")
            if c:
                full += c
            if r:
                reasoning += r
    except Exception as e:
        logger.warning("伴学流式失败: %s", e)
        full = full or f"（出错了：{e}）"

    db = SessionLocal()
    try:
        db.add(CompanionMessage(session_id=session.id, role="assistant", content=full))
        session = db.get(CompanionSession, session.id)
        if session:
            session.updated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
    return full, reasoning or None
