"""刷题服务：会话创建、答题判题（字符串/AI）、题目统计更新、结果汇总。

QuizService 持有刷题领域逻辑；判题纯函数保留为模块级工具。
"""

from __future__ import annotations

import json
import random
import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.errors import AppError, NotFoundError
from ..models import (
    Document,
    DocumentSegment,
    GlobalQuestion,
    QuestionMaterial,
    QuestionProvenance,
    QuestionRef,
    QuizAnswer,
    QuizSession,
    QuizSessionQuestion,
)
from ..utils import parse_tags


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


_TYPE_ORDER = [
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "short_answer",
    "application",
    "custom",
]


class QuizService:
    """刷题领域服务。"""

    # ---- 会话 ----

    def _scope_doc_ids(
        self,
        db: Session,
        *,
        document_id: Optional[str],
        group_id: Optional[str],
    ) -> list[str] | None:
        """刷题范围（文档 / 资料组）。返回 None 表示不限（全库）。"""
        if group_id:
            return [
                r[0] for r in db.query(Document.id).filter(Document.group_id == group_id).all()
            ]
        if document_id:
            return [document_id]
        return None

    def _candidate_ids(
        self,
        db: Session,
        *,
        document_id: Optional[str],
        group_id: Optional[str],
        chapter_ids: Optional[list[str]] = None,
        question_types: Optional[list[str]] = None,
        difficulties: Optional[list[int]] = None,
        filter_mode: str = "all",
        tags: Optional[list[str]] = None,
    ) -> list[str]:
        """把「范围 + 章节 + 题型 + 难度 + 作答状态 + 知识点」一次过滤成候选题 id。

        顺序沿用 provenance 的原始顺序（便于「按原顺序刷」）。
        """
        scope_doc_ids = self._scope_doc_ids(db, document_id=document_id, group_id=group_id)
        if group_id and not scope_doc_ids:
            return []

        q = db.query(QuestionProvenance.question_id)
        if scope_doc_ids:
            q = q.filter(QuestionProvenance.document_id.in_(scope_doc_ids))
        chapter_list = [str(c).strip() for c in (chapter_ids or []) if str(c or "").strip()]
        if chapter_list:
            q = q.filter(QuestionProvenance.chapter_id.in_(chapter_list))
        ids = list(dict.fromkeys(r[0] for r in q.all()))
        if not ids:
            return []

        type_set = {str(t).strip() for t in (question_types or []) if str(t or "").strip()}
        diff_set: set[int] = set()
        for d in difficulties or []:
            try:
                n = int(d)
            except (TypeError, ValueError):
                continue
            if 1 <= n <= 3:
                diff_set.add(n)
        if type_set or diff_set:
            kept: list[str] = []
            for qid, qtype, diff in (
                db.query(
                    GlobalQuestion.id, GlobalQuestion.question_type, GlobalQuestion.difficulty
                )
                .filter(GlobalQuestion.id.in_(ids))
                .all()
            ):
                if type_set and (qtype or "single_choice") not in type_set:
                    continue
                # 勾了具体难度时，未标注的老题不入选
                if diff_set and diff not in diff_set:
                    continue
                kept.append(qid)
            keep = set(kept)
            ids = [qid for qid in ids if qid in keep]
            if not ids:
                return []

        if filter_mode in ("wrong", "unknown", "undone") and scope_doc_ids:
            refs = (
                db.query(QuestionRef)
                .filter(QuestionRef.document_id.in_(scope_doc_ids))
                .all()
            )
            # 同题跨文档：取 attempt 最高的 ref 作为状态
            ref_map: dict[str, QuestionRef] = {}
            for r in refs:
                prev = ref_map.get(r.question_id)
                if prev is None or (r.attempt_count or 0) > (prev.attempt_count or 0):
                    ref_map[r.question_id] = r
            filtered = []
            for qid in ids:
                ref = ref_map.get(qid)
                if filter_mode == "undone" and (ref is None or (ref.attempt_count or 0) == 0):
                    filtered.append(qid)
                elif filter_mode == "wrong" and ref and ref.last_status == "wrong":
                    filtered.append(qid)
                elif filter_mode == "unknown" and ref and ref.last_status == "unknown":
                    filtered.append(qid)
            ids = filtered

        tag_set = {t.strip() for t in (tags or []) if t and str(t).strip()}
        if tag_set:
            kept = [
                gq.id
                for gq in db.query(GlobalQuestion).filter(GlobalQuestion.id.in_(ids)).all()
                if set(parse_tags(gq.tags)) & tag_set
            ]
            kept_set = set(kept)
            ids = [qid for qid in ids if qid in kept_set]
        return ids

    def _bucket_by_type(
        self, db: Session, ids: list[str]
    ) -> tuple[dict[str, list[str]], list[str]]:
        """候选按题型分桶（材料子题不单独计题型，返回材料 id 列表）。"""
        by_type: dict[str, list[str]] = {}
        mat_ids: list[str] = []
        for qid, qtype, mid in (
            db.query(
                GlobalQuestion.id, GlobalQuestion.question_type, GlobalQuestion.material_id
            )
            .filter(GlobalQuestion.id.in_(ids))
            .all()
        ):
            if mid:
                if mid not in mat_ids:
                    mat_ids.append(mid)
                continue
            by_type.setdefault(qtype or "single_choice", []).append(qid)
        return by_type, mat_ids

    def _sample_balanced(self, db: Session, ids: list[str], count: int) -> list[str]:
        """随机抽 count 题，题型之间尽量均衡（轮转取，先取规模小的桶）。"""
        count = int(count)
        if count <= 0 or len(ids) <= count:
            return ids
        by_type, mat_ids = self._bucket_by_type(db, ids)
        buckets = [list(v) for v in by_type.values()]
        if mat_ids:
            buckets.append([m for m in mat_ids])
        picked: list[str] = []
        while len(picked) < count and any(buckets):
            for bucket in buckets:
                if len(picked) >= count:
                    break
                if not bucket:
                    continue
                picked.append(bucket.pop(random.randrange(len(bucket))))
            buckets = [b for b in buckets if b]
        # 材料题：抽到材料就把该材料整组带回来
        if mat_ids:
            mat_set = set(mat_ids)
            material_ids = [qid for qid in picked if qid in mat_set]
            real = [qid for qid in picked if qid not in mat_set]
            extras: list[str] = []
            for mid in material_ids:
                extras.extend(
                    s[0]
                    for s in db.query(GlobalQuestion.id)
                    .filter(GlobalQuestion.material_id == mid)
                    .order_by(GlobalQuestion.sub_index)
                    .all()
                )
            picked = real + extras
        return picked

    def _sample_by_type_counts(
        self, db: Session, ids: list[str], type_counts: dict
    ) -> list[str]:
        """按题型配额随机抽题（material=材料题，按材料抽，带全部子题）。"""
        by_type, mat_ids = self._bucket_by_type(db, ids)
        picked: list[str] = []
        for qtype in _TYPE_ORDER:
            n = int(type_counts.get(qtype, 0) or 0)
            if n <= 0:
                continue
            cand = by_type.get(qtype, [])
            picked.extend(random.sample(cand, min(n, len(cand))))
        m_count = int(type_counts.get("material", 0) or 0)
        if m_count > 0 and mat_ids:
            for mid in random.sample(mat_ids, min(m_count, len(mat_ids))):
                picked.extend(
                    s[0]
                    for s in db.query(GlobalQuestion.id)
                    .filter(GlobalQuestion.material_id == mid)
                    .order_by(GlobalQuestion.sub_index)
                    .all()
                )
        return picked

    def _resolve_question_ids(
        self,
        db: Session,
        *,
        document_id: Optional[str],
        collection_id: Optional[str],
        group_id: Optional[str] = None,
        chapter_id: Optional[str] = None,
        chapter_ids: Optional[list[str]] = None,
        question_ids: Optional[list[str]],
        filter_mode: str = "all",
        tags: Optional[list[str]] = None,
        question_types: Optional[list[str]] = None,
        difficulties: Optional[list[int]] = None,
        count: Optional[int] = None,
        type_counts: Optional[dict] = None,
        sort: Optional[str] = None,
    ) -> list[str]:
        """解析会话题目 ID 集合（范围 → 章节/题型/难度/状态/知识点 → 抽题）。"""
        del collection_id  # 目前在候选过滤里不参与（保留入参兼容旧调用）
        if question_ids:
            ids = list(question_ids)
        else:
            cids = [str(c).strip() for c in (chapter_ids or []) if str(c or "").strip()]
            if chapter_id and chapter_id not in cids:
                cids.append(chapter_id)
            candidates = self._candidate_ids(
                db,
                document_id=document_id,
                group_id=group_id,
                chapter_ids=cids,
                question_types=question_types,
                difficulties=difficulties,
                filter_mode=filter_mode,
                tags=tags,
            )
            if type_counts:
                ids = self._sample_by_type_counts(db, candidates, type_counts)
            elif count and int(count) > 0:
                ids = self._sample_balanced(db, candidates, int(count))
            else:
                ids = candidates
        if sort == "type":
            ids = self._order_ids_by_type(db, ids)
        return self._expand_material_questions(db, ids)

    def _order_ids_by_type(self, db: Session, ids: list[str]) -> list[str]:
        """按题型固定顺序稳定排序（单选→多选→填空→简答→应用→自定义），同类型保持原顺序。"""
        if not ids:
            return ids
        rows = (
            db.query(GlobalQuestion.id, GlobalQuestion.question_type)
            .filter(GlobalQuestion.id.in_(ids))
            .all()
        )
        type_by_qid = {qid: (qtype or "single_choice") for qid, qtype in rows}
        pos = {qid: i for i, qid in enumerate(ids)}
        rank = {t: i for i, t in enumerate(_TYPE_ORDER)}
        return sorted(
            ids,
            key=lambda qid: (
                rank.get(type_by_qid.get(qid, "single_choice"), len(_TYPE_ORDER)),
                pos[qid],
            ),
        )

    def _expand_material_questions(self, db: Session, ids: list[str]) -> list[str]:
        """带材料的题目自动补上同材料的所有子题，并按 sub_index 排序。

        阅读/完形这类材料题：抽到任意一题，就把「材料 + 它的全部子题」整组带进来，
        组插入在首次出现的位置，子题按 sub_index 排。
        """
        if not ids:
            return ids
        mid_by_qid = {
            qid: mid
            for qid, mid in db.query(GlobalQuestion.id, GlobalQuestion.material_id)
            .filter(GlobalQuestion.id.in_(ids))
            .all()
            if mid
        }
        if not mid_by_qid:
            return ids

        mids = set(mid_by_qid.values())
        group: dict[str, list[tuple[int, str]]] = {}
        for qid, mid, sub in (
            db.query(GlobalQuestion.id, GlobalQuestion.material_id, GlobalQuestion.sub_index)
            .filter(GlobalQuestion.material_id.in_(mids))
            .all()
        ):
            group.setdefault(mid, []).append((sub if sub is not None else 10**9, qid))
        for mid in group:
            group[mid].sort(key=lambda t: t[0])

        out: list[str] = []
        seen: set[str] = set()
        placed: set[str] = set()
        for qid in ids:
            mid = mid_by_qid.get(qid)
            if not mid:
                if qid not in seen:
                    seen.add(qid)
                    out.append(qid)
                continue
            if mid in placed:
                continue
            placed.add(mid)
            for _sub, sid in group.get(mid, []):
                if sid not in seen:
                    seen.add(sid)
                    out.append(sid)
        return out

    def create_session(
        self,
        db: Session,
        *,
        document_id: Optional[str],
        collection_id: Optional[str] = None,
        group_id: Optional[str] = None,
        chapter_id: Optional[str] = None,
        chapter_ids: Optional[list[str]] = None,
        question_ids: Optional[list[str]] = None,
        title: Optional[str] = None,
        filter_mode: str = "all",
        tags: Optional[list[str]] = None,
        question_types: Optional[list[str]] = None,
        difficulties: Optional[list[int]] = None,
        count: Optional[int] = None,
        distribute: Optional[str] = None,
        type_counts: Optional[dict] = None,
        sort: Optional[str] = None,
        resume: bool = True,
        task_id: Optional[str] = None,
    ) -> QuizSession:
        del distribute  # 目前只有 balanced 一种算法；自定义配额走 type_counts
        ids = self._resolve_question_ids(
            db,
            document_id=document_id,
            collection_id=collection_id,
            group_id=group_id,
            chapter_id=chapter_id,
            chapter_ids=chapter_ids,
            question_ids=question_ids,
            filter_mode=filter_mode,
            tags=tags,
            question_types=question_types,
            difficulties=difficulties,
            count=count,
            type_counts=type_counts,
            sort=sort,
        )
        if not ids:
            raise AppError("没有可刷的题目（可能该文档还没有生成题目）")

        if resume and question_ids:
            existing = self.find_unfinished_by_question_ids(db, ids, document_id=document_id)
            if existing:
                if task_id:
                    self.bind_quiz_task_session(db, task_id, existing.id)
                return existing

        session = QuizSession(
            document_id=document_id,
            collection_id=collection_id,
            group_id=group_id,
            title=title,
            status="active",
        )
        db.add(session)
        db.flush()

        for i, qid in enumerate(ids):
            db.add(QuizSessionQuestion(session_id=session.id, question_id=qid, order_index=i))
        db.commit()
        db.refresh(session)
        if task_id:
            self.bind_quiz_task_session(db, task_id, session.id)
        return session

    def find_unfinished_by_question_ids(
        self,
        db: Session,
        question_ids: list[str],
        *,
        document_id: Optional[str] = None,
    ) -> Optional[QuizSession]:
        """同一批题目、仍在进行中的会话（可续刷）。"""
        want = {str(q).strip() for q in (question_ids or []) if str(q).strip()}
        if not want:
            return None
        q = db.query(QuizSession).filter(QuizSession.status == "active")
        if document_id:
            q = q.filter(QuizSession.document_id == document_id)
        for session in q.order_by(QuizSession.started_at.desc()).limit(40).all():
            rows = (
                db.query(QuizSessionQuestion.question_id)
                .filter(QuizSessionQuestion.session_id == session.id)
                .all()
            )
            have = {r[0] for r in rows}
            if have != want:
                continue
            answered = db.query(QuizAnswer).filter(QuizAnswer.session_id == session.id).count()
            if answered < len(have):
                return session
            self.complete_session(db, session)
        return None

    def bind_quiz_task_session(self, db: Session, task_id: str, session_id: str) -> None:
        """把刷题任务入口改成 session_id，下次点任务直接续刷。"""
        from ..models.goal import DailyTask
        from ..services.task import USER_ID, _loads

        tid = (task_id or "").strip()
        sid = (session_id or "").strip()
        if not tid or not sid:
            return
        row = (
            db.query(DailyTask)
            .filter(DailyTask.user_id == USER_ID, DailyTask.id == tid)
            .first()
        )
        if not row or row.kind != "quiz":
            return
        payload = _loads(row.payload_json)
        payload["session_id"] = sid
        row.payload_json = json.dumps(payload, ensure_ascii=False)
        row.href = f"/quiz/session?session_id={sid}"
        db.commit()

    def complete_session(self, db: Session, session: QuizSession) -> QuizSession:
        if session.status != "completed":
            session.status = "completed"
            session.finished_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(session)
        return session

    def list_unfinished_sessions(self, db: Session, *, limit: int = 20) -> list[dict]:
        """未答完的刷题会话，供续刷页展示。"""
        from ..models import Document

        rows = (
            db.query(QuizSession)
            .filter(QuizSession.status == "active")
            .order_by(QuizSession.started_at.desc())
            .limit(max(1, min(limit, 50)))
            .all()
        )
        out = []
        for session in rows:
            data = self._session_out(db, session)
            total = int(data.get("total_questions") or 0)
            answered = int(data.get("answered_count") or 0)
            if total <= 0 or answered >= total:
                if answered >= total > 0:
                    self.complete_session(db, session)
                continue
            doc_name = None
            if session.document_id:
                doc = db.get(Document, session.document_id)
                doc_name = doc.display_name if doc else None
            data["document_name"] = doc_name
            out.append(data)
        return out

    def get_session(self, db: Session, session_id: str) -> QuizSession:
        session = db.get(QuizSession, session_id)
        if not session:
            raise NotFoundError("会话不存在")
        return session

    def get_recent_active_by_document(self, db: Session, document_id: str) -> Optional[QuizSession]:
        rows = (
            db.query(QuizSession)
            .filter(QuizSession.document_id == document_id, QuizSession.status == "active")
            .order_by(QuizSession.started_at.desc())
            .limit(10)
            .all()
        )
        for session in rows:
            total = (
                db.query(QuizSessionQuestion)
                .filter(QuizSessionQuestion.session_id == session.id)
                .count()
            )
            answered = db.query(QuizAnswer).filter(QuizAnswer.session_id == session.id).count()
            if total > 0 and answered < total:
                return session
            if total > 0 and answered >= total:
                self.complete_session(db, session)
        return None

    def _session_out(self, db: Session, session: QuizSession) -> dict:
        rows = (
            db.query(QuizSessionQuestion, GlobalQuestion)
            .join(GlobalQuestion, GlobalQuestion.id == QuizSessionQuestion.question_id)
            .filter(QuizSessionQuestion.session_id == session.id)
            .order_by(QuizSessionQuestion.order_index)
            .all()
        )
        qids = [gq.id for _, gq in rows]
        last_times: dict[str, int] = {}
        if qids:
            # 每题最近一次历史耗时（不含本会话未提交的）
            answers = (
                db.query(QuizAnswer)
                .filter(QuizAnswer.question_id.in_(qids), QuizAnswer.time_spent_seconds.isnot(None))
                .order_by(QuizAnswer.answered_at.desc())
                .all()
            )
            for a in answers:
                if a.question_id not in last_times and a.time_spent_seconds is not None:
                    last_times[a.question_id] = int(a.time_spent_seconds)
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
                "material_id": gq.material_id,
                "sub_index": gq.sub_index,
                "last_time_spent_seconds": last_times.get(gq.id),
            })
        # 材料题：带上材料正文，供前端在题目上方展示
        from .question import question_service

        question_service.attach_materials(db, questions)
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
            "group_id": session.group_id,
            "total_questions": len(questions),
            "answered_count": answered,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "finished_at": session.finished_at.isoformat() if session.finished_at else None,
            "questions": questions,
        }

    # ---- 判题 ----

    async def _grade_by_ai(
        self,
        question: GlobalQuestion,
        user_answer: Optional[str],
        qtype: str,
        *,
        image_paths: Optional[list[str]] = None,
        file_ids: Optional[list[str]] = None,
    ) -> tuple[str, str]:
        """AI 判题（走 tina 流式，消费全部 chunk）。可附图片（手写解答照片）。"""
        from ..core.llm import create_agent, predict_stream
        from ..core.prompts import render_prompt

        multimodal = bool(image_paths)
        if (not user_answer or not user_answer.strip()) and not multimodal:
            return "wrong", "未作答"
        try:
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

            agent = create_agent(
                system_prompt=render_prompt("quiz/grade_system.md.j2"),
                multimodal=multimodal,
            )
            user_prompt = render_prompt(
                "quiz/grade_prompt.md.j2",
                type_label=type_label,
                stem=question.stem or "",
                correct_display=correct_display,
                user_answer=(user_answer or "").strip() or "（见附上的图片）",
            )
            result = ""
            async for chunk in predict_stream(
                agent,
                user_prompt,
                multimodal=multimodal,
                file_ids=file_ids,
                image_paths=image_paths,
            ):
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
        image_paths: Optional[list[str]] = None,
        file_ids: Optional[list[str]] = None,
    ) -> tuple[str, Optional[str], Optional[str], Optional[str]]:
        """返回 (status, grade_method, string_match_status, ai_reason)。"""
        if status_hint == "unknown":
            return "unknown", None, None, None

        qtype = (question.question_type or "single_choice").lower()

        if qtype == "fill_blank":
            string_status = _grade_fill_blank_string(question, user_answer)
            # 带了图（拍的解答）就直接交给模型读 —— 不必先判错、再让用户手点「让 AI 判断」
            if request_ai_grade or image_paths or file_ids:
                ai_status, ai_reason = await self._grade_by_ai(
                    question,
                    user_answer,
                    qtype="fill_blank",
                    image_paths=image_paths,
                    file_ids=file_ids,
                )
                return ai_status, "ai", string_status, ai_reason or None
            return string_status, "string", string_status, None

        if qtype in ("short_answer", "application", "custom"):
            ai_status, ai_reason = await self._grade_by_ai(
                question,
                user_answer,
                qtype=qtype,
                image_paths=image_paths,
                file_ids=file_ids,
            )
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
        ref.last_answered_at = datetime.now(timezone.utc)

    def revise_ref_stats(
        self,
        db: Session,
        question_id: str,
        document_id: Optional[str],
        old_status: str,
        new_status: str,
    ) -> None:
        """同一会话内重判题：修正 correct/wrong/unknown 计数，不重复计 attempt。"""
        if not document_id or old_status == new_status:
            return
        ref = db.query(QuestionRef).filter_by(question_id=question_id, document_id=document_id).first()
        if not ref:
            return
        if old_status == "correct":
            ref.correct_count = max(0, (ref.correct_count or 0) - 1)
        elif old_status == "wrong":
            ref.wrong_count = max(0, (ref.wrong_count or 0) - 1)
        elif old_status == "unknown":
            ref.unknown_count = max(0, (ref.unknown_count or 0) - 1)
        if new_status == "correct":
            ref.correct_count = (ref.correct_count or 0) + 1
        elif new_status == "wrong":
            ref.wrong_count = (ref.wrong_count or 0) + 1
        elif new_status == "unknown":
            ref.unknown_count = (ref.unknown_count or 0) + 1
        if new_status == "correct":
            streak = _current_streak(db, question_id)
            if streak > (ref.best_streak or 0):
                ref.best_streak = streak
        ref.last_status = new_status
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
        attachments: Optional[list[str]] = None,
    ) -> dict:
        """提交答题并判题。"""
        question = db.get(GlobalQuestion, question_id)
        if not question:
            raise NotFoundError("题目不存在")

        from ..core.llm import prepare_images

        image_paths, file_ids = await prepare_images(attachments)

        status, grade_method, string_match_status, ai_reason = await self.grade_answer(
            question,
            user_answer,
            status_hint,
            request_ai_grade=bool(request_ai_grade),
            image_paths=image_paths,
            file_ids=file_ids,
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

        existing = (
            db.query(QuizAnswer)
            .filter_by(session_id=session.id, question_id=question_id)
            .first()
        )
        # 组会话无 document_id 时，用题目溯源文档更新统计
        ref_doc_id = session.document_id
        if not ref_doc_id:
            if session.group_id:
                from ..models import Document

                group_doc_ids = [
                    r[0]
                    for r in db.query(Document.id).filter(Document.group_id == session.group_id).all()
                ]
                prov = (
                    db.query(QuestionProvenance)
                    .filter(
                        QuestionProvenance.question_id == question_id,
                        QuestionProvenance.document_id.in_(group_doc_ids),
                    )
                    .first()
                    if group_doc_ids
                    else None
                )
            else:
                prov = db.query(QuestionProvenance).filter_by(question_id=question_id).first()
            ref_doc_id = prov.document_id if prov else None

        # 拍照作答：图片记进答题记录（错题回顾里能看到），没文字时给个占位
        from pathlib import Path as _Path

        saved_ids = [_Path(p).name for p in image_paths]
        stored_answer = user_answer
        if (not user_answer or not user_answer.strip()) and saved_ids:
            stored_answer = "（图片作答）"
        stored_attachments = json.dumps(saved_ids, ensure_ascii=False) if saved_ids else None

        if existing:
            old_status = existing.status
            existing.user_answer = stored_answer
            existing.status = status
            existing.grade_method = grade_method
            existing.string_match_status = string_match_status
            existing.ai_reason = ai_reason
            if stored_attachments is not None:
                existing.attachments = stored_attachments
            if time_spent_seconds is not None:
                existing.time_spent_seconds = time_spent_seconds
            existing.answered_at = datetime.now(timezone.utc)
            self.revise_ref_stats(db, question_id, ref_doc_id, old_status, status)
        else:
            answer = QuizAnswer(
                session_id=session.id,
                question_id=question_id,
                user_answer=stored_answer,
                status=status,
                grade_method=grade_method,
                string_match_status=string_match_status,
                ai_reason=ai_reason,
                time_spent_seconds=time_spent_seconds,
                attachments=stored_attachments,
            )
            db.add(answer)
            self.update_ref_stats(db, question_id, ref_doc_id, status)

        answered = db.query(QuizAnswer).filter(QuizAnswer.session_id == session.id).count()
        total = db.query(QuizSessionQuestion).filter(QuizSessionQuestion.session_id == session.id).count()

        session_status = session.status
        if total > 0 and answered >= total and session.status == "active":
            session.status = "completed"
            session.finished_at = datetime.now(timezone.utc)
            session_status = "completed"

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
            "attachments": saved_ids,
            "answered_count": answered,
            "total_questions": total,
            "session_status": session_status,
            "current_streak": _current_streak(db, question_id),
        }

    async def grade_standalone(
        self,
        db: Session,
        question_id: str,
        user_answer: Optional[str],
        status_hint: Optional[str],
        document_id: Optional[str] = None,
        request_ai_grade: Optional[bool] = None,
        attachments: Optional[list[str]] = None,
    ) -> dict:
        """对话里单题判分，不依赖刷题会话。"""
        question = db.get(GlobalQuestion, question_id)
        if not question:
            raise NotFoundError("题目不存在")

        from ..core.llm import prepare_images

        image_paths, file_ids = await prepare_images(attachments)

        status, grade_method, string_match_status, ai_reason = await self.grade_answer(
            question,
            user_answer,
            status_hint,
            request_ai_grade=bool(request_ai_grade),
            image_paths=image_paths,
            file_ids=file_ids,
        )

        if not document_id:
            prov = db.query(QuestionProvenance).filter_by(question_id=question_id).first()
            document_id = prov.document_id if prov else None

        correct_answer = None
        explanation = None
        citation = None
        if status != "correct":
            correct_answer = question.answer
            explanation = question.explanation
            if document_id:
                prov = db.query(QuestionProvenance).filter_by(question_id=question_id, document_id=document_id).first()
                if not prov:
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

        self.update_ref_stats(db, question_id, document_id, status)
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
            "answered_count": 1,
            "total_questions": 1,
            "session_status": "active",
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
                    "attachments": json.loads(a.attachments) if a.attachments else [],
                })
        total = db.query(QuizSessionQuestion).filter(QuizSessionQuestion.session_id == session.id).count()
        time_rows = (
            db.query(QuizAnswer.time_spent_seconds)
            .filter(QuizAnswer.session_id == session.id)
            .all()
        )
        total_time = sum(int(t[0] or 0) for t in time_rows)
        return {
            "session_id": session.id,
            "status": session.status,
            "total_questions": total,
            "correct_count": correct,
            "wrong_count": wrong,
            "unknown_count": unknown,
            "total_time_spent_seconds": total_time,
            "items": items,
        }


    # ---- 单题详情（题目 + 统计 + 历次作答 + 来源）----

    def question_history(self, db: Session, question_id: str) -> dict:
        """题目详情页用：题目本身、累计统计、历次作答（含拍照的图）、来源文档。"""
        question = db.get(GlobalQuestion, question_id)
        if not question:
            raise NotFoundError("题目不存在")

        answers = (
            db.query(QuizAnswer)
            .filter(QuizAnswer.question_id == question_id)
            .order_by(QuizAnswer.answered_at.desc())
            .all()
        )
        correct = sum(1 for a in answers if a.status == "correct")
        wrong = sum(1 for a in answers if a.status == "wrong")
        unknown = sum(1 for a in answers if a.status == "unknown")
        attempt = len(answers)

        provs = (
            db.query(QuestionProvenance)
            .filter(QuestionProvenance.question_id == question_id)
            .all()
        )
        doc_ids = [p.document_id for p in provs if p.document_id]
        doc_names: dict[str, str] = {}
        if doc_ids:
            for d in db.query(Document).filter(Document.id.in_(doc_ids)).all():
                doc_names[d.id] = d.display_name or d.id

        return {
            "question": {
                "id": question.id,
                "question_type": question.question_type,
                "stem": question.stem,
                "options": json.loads(question.options) if question.options else None,
                "answer": question.answer,
                "explanation": question.explanation,
                "tags": parse_tags(question.tags) if question.tags else [],
                "html_content": question.html_content,
                "answer_params": question.answer_params,
                "material_id": question.material_id,
                "sub_index": question.sub_index,
            },
            "stats": {
                "attempt_count": attempt,
                "correct_count": correct,
                "wrong_count": wrong,
                "unknown_count": unknown,
                "accuracy_rate": round(correct / attempt, 3) if attempt else None,
                "current_streak": _current_streak(db, question_id),
                "last_status": answers[0].status if answers else None,
                "last_answered_at": (
                    answers[0].answered_at.isoformat()
                    if answers and answers[0].answered_at
                    else None
                ),
            },
            "answers": [
                {
                    "id": a.id,
                    "session_id": a.session_id,
                    "status": a.status,
                    "user_answer": a.user_answer,
                    "ai_reason": a.ai_reason,
                    "grade_method": a.grade_method,
                    "attachments": json.loads(a.attachments) if a.attachments else [],
                    "time_spent_seconds": a.time_spent_seconds,
                    "answered_at": a.answered_at.isoformat() if a.answered_at else None,
                }
                for a in answers
            ],
            "provenance": [
                {
                    "document_id": p.document_id,
                    "document_name": doc_names.get(p.document_id or ""),
                    "page_number": p.page_number,
                    "chapter_id": p.chapter_id,
                    "excerpt": ((p.excerpt or "")[:200] or None),
                }
                for p in provs
            ],
        }


# 模块级单例：调用方仍用 quiz_service.xxx()
quiz_service = QuizService()
