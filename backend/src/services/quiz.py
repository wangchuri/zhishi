"""刷题服务：会话创建、答题判题（字符串/AI）、题目统计更新、结果汇总。

QuizService 持有刷题领域逻辑；判题纯函数保留为模块级工具。
"""

from __future__ import annotations

import json
import re
from typing import Optional

from sqlalchemy.orm import Session

from ..core.errors import AppError, NotFoundError
from ..models import (
    DocumentSegment,
    GlobalQuestion,
    QuestionProvenance,
    QuestionRef,
    QuizAnswer,
    QuizSession,
    QuizSessionQuestion,
)


# ---- 纯函数工具 ----

def _parse_multi_blank_values(answer: Optional[str]) -> list[str]:
    """解析填空题多空答案。"""
    if not answer:
        return []
    text = answer.strip()
    if text.startswith("["):
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return [str(v).strip() for v in data if str(v).strip()]
        except Exception:
            pass
    return [p.strip() for p in re.split(r"[;；,，]", text) if p.strip()]


def _normalize_blank_text(text: str) -> str:
    return re.sub(r"\s+", "", str(text or "")).strip()


def _grade_fill_blank_string(question: GlobalQuestion, user_answer: Optional[str]) -> str:
    if not user_answer or not user_answer.strip():
        return "wrong"
    correct_parts = _parse_multi_blank_values(question.answer)
    user_parts = _parse_multi_blank_values(user_answer)
    if not correct_parts:
        return "wrong"
    if len(user_parts) != len(correct_parts):
        return "wrong"
    for u, c in zip(user_parts, correct_parts):
        if _normalize_blank_text(u) != _normalize_blank_text(c):
            return "wrong"
    return "correct"


def _parse_ai_grade_response(content: str) -> tuple[str, str]:
    text = (content or "").strip()
    if not text:
        return "wrong", ""
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            status = str(data.get("status", "wrong")).strip().lower()
            reason = str(data.get("reason", "")).strip()
            if status in ("correct", "partial", "wrong"):
                return status, reason
    except Exception:
        pass
    lower = text.lower()
    if "partial" in lower or "部分" in text:
        return "partial", text[:200]
    if "correct" in lower or "正确" in text:
        if "wrong" in lower or "错误" in text:
            return "wrong", text[:200]
        return "correct", text[:200]
    return "wrong", text[:200] if text else ""


def _current_streak(db: Session, question_id: str) -> int:
    """该题最近连续答对次数（基于 quiz_answers 倒序）。"""
    answers = (
        db.query(QuizAnswer)
        .filter(QuizAnswer.question_id == question_id)
        .order_by(QuizAnswer.answered_at.desc())
        .limit(10)
        .all()
    )
    streak = 0
    for a in answers:
        if a.status == "correct":
            streak += 1
        else:
            break
    return streak


class QuizService:
    """刷题领域服务。"""

    # ---- 会话 ----

    def _resolve_question_ids(
        self,
        db: Session,
        *,
        document_id: Optional[str],
        collection_id: Optional[str],
        question_ids: Optional[list[str]],
        filter_mode: str = "all",
    ) -> list[str]:
        """解析会话题目 ID 集合。"""
        if question_ids:
            return list(question_ids)

        q = db.query(QuestionProvenance.question_id)
        if document_id:
            q = q.filter(QuestionProvenance.document_id == document_id)
        ids = [r[0] for r in q.all()]

        if filter_mode in ("wrong", "unknown", "undone") and document_id:
            refs = db.query(QuestionRef).filter(QuestionRef.document_id == document_id).all()
            ref_map = {r.question_id: r for r in refs}
            filtered = []
            for qid in ids:
                ref = ref_map.get(qid)
                if filter_mode == "undone" and (ref is None or ref.attempt_count == 0):
                    filtered.append(qid)
                elif filter_mode == "wrong" and ref and ref.last_status == "wrong":
                    filtered.append(qid)
                elif filter_mode == "unknown" and ref and ref.last_status == "unknown":
                    filtered.append(qid)
            ids = filtered
        return ids

    def create_session(
        self,
        db: Session,
        *,
        document_id: Optional[str],
        collection_id: Optional[str] = None,
        question_ids: Optional[list[str]] = None,
        title: Optional[str] = None,
        filter_mode: str = "all",
    ) -> QuizSession:
        ids = self._resolve_question_ids(
            db,
            document_id=document_id,
            collection_id=collection_id,
            question_ids=question_ids,
            filter_mode=filter_mode,
        )
        if not ids:
            raise AppError("没有可刷的题目（可能该文档还没有生成题目）")

        session = QuizSession(
            document_id=document_id,
            collection_id=collection_id,
            title=title,
            status="active",
        )
        db.add(session)
        db.flush()

        for i, qid in enumerate(ids):
            db.add(QuizSessionQuestion(session_id=session.id, question_id=qid, order_index=i))
        db.commit()
        db.refresh(session)
        return session

    def get_session(self, db: Session, session_id: str) -> QuizSession:
        session = db.get(QuizSession, session_id)
        if not session:
            raise NotFoundError("会话不存在")
        return session

    def get_recent_active_by_document(self, db: Session, document_id: str) -> Optional[QuizSession]:
        return (
            db.query(QuizSession)
            .filter(QuizSession.document_id == document_id, QuizSession.status == "active")
            .order_by(QuizSession.started_at.desc())
            .first()
        )

    def _session_out(self, db: Session, session: QuizSession) -> dict:
        rows = (
            db.query(QuizSessionQuestion, GlobalQuestion)
            .join(GlobalQuestion, GlobalQuestion.id == QuizSessionQuestion.question_id)
            .filter(QuizSessionQuestion.session_id == session.id)
            .order_by(QuizSessionQuestion.order_index)
            .all()
        )
        questions = []
        for sq, gq in rows:
            questions.append({
                "question_id": gq.id,
                "order_index": sq.order_index,
                "stem": gq.stem,
                "question_type": gq.question_type,
                "options": json.loads(gq.options) if gq.options else None,
                "source_type": gq.source_type,
                "html_content": gq.html_content,
                "answer_params": gq.answer_params,
            })
        answered = (
            db.query(QuizAnswer)
            .filter(QuizAnswer.session_id == session.id)
            .count()
        )
        return {
            "id": session.id,
            "title": session.title,
            "status": session.status,
            "document_id": session.document_id,
            "collection_id": session.collection_id,
            "total_questions": len(questions),
            "answered_count": answered,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "finished_at": session.finished_at.isoformat() if session.finished_at else None,
            "questions": questions,
        }

    # ---- 判题 ----

    async def _grade_by_ai(self, question: GlobalQuestion, user_answer: Optional[str], qtype: str) -> tuple[str, str]:
        """AI 判题（走 tina 流式，消费全部 chunk）。"""
        from ..core.llm import create_llm

        if not user_answer or not user_answer.strip():
            return "wrong", "未作答"
        try:
            llm = create_llm()
            type_label = {
                "fill_blank": "填空题",
                "short_answer": "简答题",
                "application": "应用题",
                "custom": "自定义题",
            }.get(qtype, "主观题")
            correct_display = question.answer or ""
            if qtype == "fill_blank":
                parts = _parse_multi_blank_values(question.answer)
                correct_display = "；".join(parts)

            sys_prompt = """你是严谨的题目判卷助手。请根据题目、标准答案和学生答案，判断对错。
输出 JSON：{"status": "correct|partial|wrong", "reason": "简短理由"}"""

            user_prompt = f"""题目类型：{type_label}
题干：{question.stem}
标准答案：{correct_display}
学生答案：{user_answer}

请判定并输出 JSON。"""

            result = ""
            async for chunk in llm.apredict(user_prompt):
                content = chunk.get("content", "") if isinstance(chunk, dict) else str(chunk)
                result += content
            return _parse_ai_grade_response(result)
        except Exception:
            return "wrong", ""

    async def grade_answer(
        self,
        question: GlobalQuestion,
        user_answer: Optional[str],
        status_hint: Optional[str],
        *,
        request_ai_grade: bool = False,
    ) -> tuple[str, Optional[str], Optional[str], Optional[str]]:
        """返回 (status, grade_method, string_match_status, ai_reason)。"""
        if status_hint == "unknown":
            return "unknown", None, None, None

        qtype = (question.question_type or "single_choice").lower()

        if qtype == "fill_blank":
            string_status = _grade_fill_blank_string(question, user_answer)
            if request_ai_grade:
                ai_status, ai_reason = await self._grade_by_ai(question, user_answer, qtype="fill_blank")
                return ai_status, "ai", string_status, ai_reason or None
            return string_status, "string", string_status, None

        if qtype in ("short_answer", "application", "custom"):
            ai_status, ai_reason = await self._grade_by_ai(question, user_answer, qtype=qtype)
            return ai_status, "ai", None, ai_reason or None

        # single_choice / 其他：字符串匹配
        if not user_answer or not user_answer.strip():
            return "wrong", "string", None, None
        correct = (question.answer or "").strip().upper()
        user = user_answer.strip().upper()
        status = "correct" if user == correct else "wrong"
        return status, "string", None, None

    # ---- 答题 ----

    def update_ref_stats(self, db: Session, question_id: str, document_id: Optional[str], status: str) -> None:
        """更新题目文档级统计（attempt/correct/wrong/unknown/best_streak/last_status）。"""
        if not document_id:
            return
        ref = db.query(QuestionRef).filter_by(question_id=question_id, document_id=document_id).first()
        if not ref:
            return
        ref.attempt_count = (ref.attempt_count or 0) + 1
        if status == "correct":
            ref.correct_count = (ref.correct_count or 0) + 1
        elif status == "wrong":
            ref.wrong_count = (ref.wrong_count or 0) + 1
        elif status == "unknown":
            ref.unknown_count = (ref.unknown_count or 0) + 1
        if status == "correct":
            streak = _current_streak(db, question_id)
            if streak > (ref.best_streak or 0):
                ref.best_streak = streak
        ref.last_status = status
        from datetime import datetime, timezone
        ref.last_answered_at = datetime.now(timezone.utc)

    async def submit_answer(
        self,
        db: Session,
        session: QuizSession,
        question_id: str,
        user_answer: Optional[str],
        status_hint: Optional[str],
        time_spent_seconds: Optional[int],
        request_ai_grade: Optional[bool],
    ) -> dict:
        """提交答题并判题。"""
        question = db.get(GlobalQuestion, question_id)
        if not question:
            raise NotFoundError("题目不存在")

        status, grade_method, string_match_status, ai_reason = await self.grade_answer(
            question,
            user_answer,
            status_hint,
            request_ai_grade=bool(request_ai_grade),
        )

        # 答案/解析展示（错题给正确答案 + citation）
        correct_answer = None
        explanation = None
        citation = None
        if status != "correct":
            correct_answer = question.answer
            explanation = question.explanation
            prov = db.query(QuestionProvenance).filter_by(question_id=question_id).first()
            if prov and prov.document_id:
                seg = None
                if prov.segment_id:
                    seg = db.get(DocumentSegment, prov.segment_id)
                if not seg:
                    seg = db.query(DocumentSegment).filter_by(document_id=prov.document_id).first()
                if seg:
                    citation = {
                        "doc_id": prov.document_id,
                        "segment_id": seg.id,
                        "title": seg.title,
                        "char_start": seg.char_start,
                        "char_end": seg.char_end,
                        "snippet": seg.content[:200],
                    }

        answer = QuizAnswer(
            session_id=session.id,
            question_id=question_id,
            user_answer=user_answer,
            status=status,
            grade_method=grade_method,
            string_match_status=string_match_status,
            ai_reason=ai_reason,
            time_spent_seconds=time_spent_seconds,
        )
        db.add(answer)

        self.update_ref_stats(db, question_id, session.document_id, status)

        answered = db.query(QuizAnswer).filter(QuizAnswer.session_id == session.id).count()
        total = db.query(QuizSessionQuestion).filter(QuizSessionQuestion.session_id == session.id).count()

        db.commit()

        return {
            "question_id": question_id,
            "status": status,
            "correct_answer": correct_answer,
            "explanation": explanation,
            "citation": citation,
            "grade_method": grade_method,
            "string_match_status": string_match_status,
            "ai_reason": ai_reason,
            "answered_count": answered,
            "total_questions": total,
            "session_status": session.status,
            "current_streak": _current_streak(db, question_id),
        }

    # ---- 结果 ----

    def get_results(self, db: Session, session: QuizSession) -> dict:
        rows = (
            db.query(QuizAnswer, GlobalQuestion)
            .join(GlobalQuestion, GlobalQuestion.id == QuizAnswer.question_id)
            .filter(QuizAnswer.session_id == session.id)
            .order_by(QuizAnswer.answered_at)
            .all()
        )
        correct = wrong = unknown = 0
        items = []
        for a, gq in rows:
            if a.status == "correct":
                correct += 1
            elif a.status == "wrong":
                wrong += 1
            elif a.status == "unknown":
                unknown += 1
            if a.status in ("wrong", "unknown"):
                items.append({
                    "question_id": gq.id,
                    "stem": gq.stem,
                    "user_answer": a.user_answer,
                    "status": a.status,
                    "correct_answer": gq.answer,
                    "explanation": gq.explanation,
                })
        total = db.query(QuizSessionQuestion).filter(QuizSessionQuestion.session_id == session.id).count()
        return {
            "session_id": session.id,
            "status": session.status,
            "total_questions": total,
            "correct_count": correct,
            "wrong_count": wrong,
            "unknown_count": unknown,
            "items": items,
        }


# 模块级单例：调用方仍用 quiz_service.xxx()
quiz_service = QuizService()
