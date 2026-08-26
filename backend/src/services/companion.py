"""Companion 伴学服务：按文档对话，注入当前页上下文。"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..core.errors import NotFoundError
from ..core.llm import create_agent, format_agent_error, visible_assistant_delta
from ..core.prompts import render_prompt
from ..models import CompanionMessage, CompanionSession, Document

logger = logging.getLogger(__name__)


class CompanionService:
    """伴学领域服务。"""

    def _get_or_create_session(self, db: Session, document_id: str, document_name: str) -> CompanionSession:
        session = db.query(CompanionSession).filter(CompanionSession.document_id == document_id).first()
        if not session:
            session = CompanionSession(document_id=document_id, document_name=document_name)
            db.add(session)
            db.commit()
            db.refresh(session)
        return session

    def get_history(self, db: Session, document_id: str) -> dict:
        session = self._get_or_create_session(db, document_id, "")
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

    def _load_history(self, db: Session, session_id: str, max_messages: int = 16) -> list[dict]:
        msgs = db.query(CompanionMessage).filter(CompanionMessage.session_id == session_id).order_by(CompanionMessage.created_at.desc()).limit(max_messages).all()
        msgs.reverse()
        return [{"role": m.role, "content": m.content} for m in msgs]

    async def send_message(
        self,
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

        session = self._get_or_create_session(db, document_id, doc.display_name)

        db.add(CompanionMessage(session_id=session.id, role="user", content=content))
        session.updated_at = datetime.now(timezone.utc)
        db.commit()

        history = self._load_history(db, session.id)
        history_str = "\n".join(f"{'用户' if m['role']=='user' else '伴学'}: {m['content']}" for m in history[:-1])

        prompt = render_prompt(
            "companion/chat.md.j2",
            document_name=doc.display_name,
            page_number=page_number or 1,
            page_content=(page_content or "")[:2000],
            history=history_str,
        )
        agent = create_agent(system_prompt=prompt)

        for m in history[:-1]:
            agent.add_message(role=m["role"], content=m["content"])

        return agent, session, content

    def persist_assistant(self, session_id: str, content: str) -> None:
        db = SessionLocal()
        try:
            db.add(CompanionMessage(session_id=session_id, role="assistant", content=content))
            session = db.get(CompanionSession, session_id)
            if session:
                session.updated_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()

    async def consume_and_save(self, agent, session, user_content: str) -> tuple[str, Optional[str]]:
        full = ""
        reasoning = ""
        try:
            async for chunk in agent.apredict(user_content):
                c, r = visible_assistant_delta(chunk)
                if c:
                    full += c
                if r:
                    reasoning += r
        except Exception as e:
            logger.exception("伴学流式失败")
            full = full or f"（出错了：{format_agent_error(e)}）"

        self.persist_assistant(session.id, full)
        return full, reasoning or None


# 模块级单例
companion_service = CompanionService()
