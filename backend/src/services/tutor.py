"""Tutor 辅导服务：会话创建、消息收发（agent 会话缓存）。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.errors import NotFoundError
from ..models import (
    DocumentSegment,
    GlobalQuestion,
    QuestionProvenance,
    TutorSession,
)


class TutorService:
    """辅导领域服务。"""

    def __init__(self) -> None:
        # agent 会话缓存：tutor_session_id -> Agent（内存，进程内有效）
        self._agent_sessions: dict[str, object] = {}

    def get_agent(self, session_id: str):
        return self._agent_sessions.get(session_id)

    def cache_agent(self, session_id: str, agent) -> None:
        self._agent_sessions[session_id] = agent

    def create_tutor_session(
        self,
        db: Session,
        *,
        question_id: str,
        quiz_session_id: Optional[str],
        quiz_answer_id: Optional[str],
    ) -> TutorSession:
        question = db.get(GlobalQuestion, question_id)
        if not question:
            raise NotFoundError("题目不存在")

        prov = db.query(QuestionProvenance).filter_by(question_id=question_id).first()
        segment = None
        if prov and prov.segment_id:
            segment = db.get(DocumentSegment, prov.segment_id)
        if not segment and prov:
            segment = db.query(DocumentSegment).filter_by(document_id=prov.document_id).first()

        session = TutorSession(
            question_id=question_id,
            document_id=prov.document_id if prov else None,
            segment_id=segment.id if segment else None,
            quiz_answer_id=quiz_answer_id,
            quiz_session_id=quiz_session_id,
            status="active",
        )
        db.add(session)
        db.commit()
        db.refresh(session)

        from ..agents.tutor_agent import build_tutor_agent
        agent = build_tutor_agent(question, prov, segment)
        self.cache_agent(session.id, agent)
        return session

    def get_session(self, db: Session, session_id: str) -> TutorSession:
        session = db.get(TutorSession, session_id)
        if not session:
            raise NotFoundError("辅导会话不存在")
        return session

    def _session_out(self, db: Session, session: TutorSession) -> dict:
        question = db.get(GlobalQuestion, session.question_id)
        segment = db.get(DocumentSegment, session.segment_id) if session.segment_id else None
        return {
            "id": session.id,
            "question_id": session.question_id,
            "document_id": session.document_id,
            "segment_id": session.segment_id,
            "quiz_answer_id": session.quiz_answer_id,
            "status": session.status,
            "question_stem": question.stem if question else None,
            "segment_context": {
                "segment_id": segment.id,
                "title": segment.title,
                "snippet": segment.content[:200] if segment and segment.content else "",
            } if segment else None,
            "messages": [],
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        }

    def ensure_agent(self, db: Session, session: TutorSession):
        """获取或重建辅导 Agent（进程内缓存）。"""
        agent = self.get_agent(session.id)
        if agent is not None:
            return agent

        from ..agents.tutor_agent import build_tutor_agent

        question = db.get(GlobalQuestion, session.question_id)
        prov = db.query(QuestionProvenance).filter_by(question_id=session.question_id).first()
        segment = db.get(DocumentSegment, session.segment_id) if session.segment_id else None
        agent = build_tutor_agent(question, prov, segment)
        self.cache_agent(session.id, agent)
        return agent

    def touch_session(self, db: Session, session: TutorSession) -> None:
        session.updated_at = datetime.now(timezone.utc)
        db.commit()

    async def send_message(
        self,
        db: Session,
        session: TutorSession,
        content: str,
    ) -> tuple[str, str | None]:
        """发送消息，消费完整流后返回 (content, reasoning_content)。"""
        from ..agents.tutor_agent import send_message as agent_send

        agent = self.ensure_agent(db, session)
        self.touch_session(db, session)
        return await agent_send(agent, content)


# 模块级单例
tutor_service = TutorService()
