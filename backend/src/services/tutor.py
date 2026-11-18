"""Tutor 辅导服务：会话创建、消息收发（agent 会话缓存 + 消息落库）。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.errors import NotFoundError
from ..models import (
    DocumentSegment,
    GlobalQuestion,
    QuestionProvenance,
    TutorMessage,
    TutorSession,
)

# 回放给 Agent 的历史消息上限（条）。辅导是单题短对话，够用且不至于把上下文撑爆。
_REPLAY_LIMIT = 40


class TutorService:
    """辅导领域服务。"""

    def __init__(self) -> None:
        # agent 会话缓存：tutor_session_id -> Agent（内存，进程内有效）
        self._agent_sessions: dict[str, object] = {}

    def get_agent(self, session_id: str):
        return self._agent_sessions.get(session_id)

    def cache_agent(self, session_id: str, agent) -> None:
        self._agent_sessions[session_id] = agent

    def _find_reusable(
        self, db: Session, question_id: str, quiz_session_id: Optional[str]
    ) -> Optional[TutorSession]:
        """同一场刷题里、同一道题的辅导会话直接复用，接着上次聊。"""
        query = db.query(TutorSession).filter(
            TutorSession.question_id == question_id,
            TutorSession.status == "active",
        )
        if quiz_session_id:
            query = query.filter(TutorSession.quiz_session_id == quiz_session_id)
        return query.order_by(TutorSession.updated_at.desc()).first()

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

        existing = self._find_reusable(db, question_id, quiz_session_id)
        if existing is not None:
            return existing

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

    # ---- 消息 ----

    def list_messages(self, db: Session, session_id: str, *, limit: int = 200) -> list[TutorMessage]:
        rows = (
            db.query(TutorMessage)
            .filter(TutorMessage.session_id == session_id)
            .order_by(TutorMessage.created_at)
            .all()
        )
        return rows[-limit:] if limit and len(rows) > limit else rows

    def _message_out(self, msg: TutorMessage) -> dict:
        return {
            "id": msg.id,
            "role": msg.role,
            "content": msg.content or "",
            "reasoning_content": msg.reasoning_content,
            # schema 里是 list[str]，没附件也要给空数组（给 None 会 500）
            "attachments": json.loads(msg.attachments) if msg.attachments else [],
            "created_at": msg.created_at.isoformat() if msg.created_at else None,
        }

    def append_message(
        self,
        db: Session,
        session: TutorSession,
        role: str,
        content: str,
        *,
        reasoning_content: Optional[str] = None,
        attachments: Optional[list[str]] = None,
    ) -> TutorMessage:
        msg = TutorMessage(
            session_id=session.id,
            role=role,
            content=content,
            reasoning_content=reasoning_content,
            attachments=json.dumps(attachments, ensure_ascii=False) if attachments else None,
        )
        db.add(msg)
        session.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(msg)
        return msg

    def _session_out(self, db: Session, session: TutorSession) -> dict:
        question = db.get(GlobalQuestion, session.question_id)
        segment = db.get(DocumentSegment, session.segment_id) if session.segment_id else None
        return {
            "id": session.id,
            "question_id": session.question_id,
            "document_id": session.document_id,
            "segment_id": session.segment_id,
            "quiz_answer_id": session.quiz_answer_id,
            "quiz_session_id": session.quiz_session_id,
            "status": session.status,
            "question_stem": question.stem if question else None,
            "segment_context": {
                "segment_id": segment.id,
                "title": segment.title,
                "snippet": segment.content[:200] if segment and segment.content else "",
            } if segment else None,
            "messages": [self._message_out(m) for m in self.list_messages(db, session.id)],
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        }

    def session_out(self, db: Session, session: TutorSession) -> dict:
        """对外暴露的会话序列化（API 层用）。"""
        return self._session_out(db, session)

    def ensure_agent(self, db: Session, session: TutorSession):
        """获取或重建辅导 Agent（进程内缓存），重建时回放历史消息。"""
        agent = self.get_agent(session.id)
        if agent is not None:
            return agent

        from ..agents.tutor_agent import build_tutor_agent

        question = db.get(GlobalQuestion, session.question_id)
        prov = db.query(QuestionProvenance).filter_by(question_id=session.question_id).first()
        segment = db.get(DocumentSegment, session.segment_id) if session.segment_id else None
        agent = build_tutor_agent(question, prov, segment)

        # 后端重启 / 换进程后 Agent 是新的：把落库的历史补回去，别让学习者重新讲一遍
        for msg in self.list_messages(db, session.id, limit=_REPLAY_LIMIT):
            if msg.role not in ("user", "assistant"):
                continue
            try:
                agent.add_message(role=msg.role, content=msg.content or "")
            except Exception:
                # 回放失败不该阻断本轮对话
                break

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
        attachments: Optional[list[str]] = None,
    ) -> tuple[str, str | None]:
        """发送消息，消费完整流后返回 (content, reasoning_content)，并落库。"""
        from ..agents.tutor_agent import send_message as agent_send
        from ..core.llm import prepare_images

        # 用户消息先落库：即使本轮模型调用失败，学习者的话也不会丢
        self.append_message(db, session, "user", content, attachments=attachments)

        image_paths, file_ids = await prepare_images(attachments)
        agent = self.ensure_agent(db, session)
        reply, reasoning = await agent_send(
            agent, content, file_ids=file_ids, image_paths=image_paths
        )
        if reply:
            self.append_message(
                db, session, "assistant", reply, reasoning_content=reasoning
            )
        else:
            self.touch_session(db, session)
        return reply, reasoning


# 模块级单例
tutor_service = TutorService()
