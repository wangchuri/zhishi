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

# agent 会话缓存：tutor_session_id -> Agent（内存，进程内有效）
_agent_sessions: dict[str, object] = {}


def get_agent(session_id: str):
    return _agent_sessions.get(session_id)


def cache_agent(session_id: str, agent) -> None:
    _agent_sessions[session_id] = agent


def create_tutor_session(
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

    # 创建并缓存 agent
    from ..agents.tutor_agent import build_tutor_agent
    agent = build_tutor_agent(question, prov, segment)
    cache_agent(session.id, agent)
    return session


def get_session(db: Session, session_id: str) -> TutorSession:
    session = db.get(TutorSession, session_id)
    if not session:
        raise NotFoundError("辅导会话不存在")
    return session


def _session_out(db: Session, session: TutorSession) -> dict:
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


async def send_message(
    db: Session,
    session: TutorSession,
    content: str,
    *,
    stream: bool,
):
    """发送消息。返回流式内容（若 stream）或完整回复。"""
    from ..agents.tutor_agent import send_message as agent_send

    agent = get_agent(session.id)
    if agent is None:
        # 会话重建（如后端重启）：重建 agent（用最后已知上下文）
        from ..agents.tutor_agent import build_tutor_agent
        question = db.get(GlobalQuestion, session.question_id)
        prov = db.query(QuestionProvenance).filter_by(question_id=session.question_id).first()
        segment = db.get(DocumentSegment, session.segment_id) if session.segment_id else None
        agent = build_tutor_agent(question, prov, segment)
        cache_agent(session.id, agent)

    session.updated_at = datetime.now(timezone.utc)
    db.commit()

    return await agent_send(agent, content)
