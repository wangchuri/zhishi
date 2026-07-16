"""
刷题会话服务 — 创建会话、答题判分、错题溯源
"""
import json
import random
import re
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.crud import kb as kb_crud
from app.crud import question as question_crud
from app.crud import quiz as quiz_crud
from app.models import DocumentSegment, GlobalQuestion, UserQuestionRef
from app.schemas.question import QuestionOption
from app.schemas.quiz import (
    AnswerResult,
    CitationOut,
    QuizResultsOut,
    QuizReviewItemOut,
    QuizSessionCreate,
    QuizSessionOut,
    QuizSessionQuestionOut,
)


def _build_citation(
    db: Session, question_id: str, document_id: Optional[str] = None
) -> Optional[CitationOut]:
    provs = question_crud.list_provenance_for_question(db, question_id)
    if not provs:
        return None

    prov = provs[0]
    if document_id:
        for p in provs:
            if p.document_id == document_id:
                prov = p
                break

    segment = None
    if prov.segment_id:
        segment = (
            db.query(DocumentSegment)
            .filter(DocumentSegment.id == prov.segment_id)
            .first()
        )

    snippet = prov.excerpt
    if not snippet and segment:
        snippet = segment.content[:500]

    return CitationOut(
        doc_id=prov.document_id,
        segment_id=prov.segment_id,
        title=segment.title if segment else None,
        char_start=segment.char_start if segment else None,
        char_end=segment.char_end if segment else None,
        snippet=snippet,
    )


_BLANK_PATTERN = re.compile(r"_{3,}|\{\{blank\}\}", re.IGNORECASE)

GRADE_AI_SYS_PROMPT = """你是考研辅导场景的判题助手。根据题干、标准答案和学生答案，判断答题情况。
只输出一行 JSON，格式：{"status":"correct"|"partial"|"wrong","reason":"简短中文理由"}
- correct: 答案正确或语义等价（如「3」与「三」、同义表述）
- partial: 部分正确、要点不全
- wrong: 错误或未答到要点"""


def _normalize_blank_text(text: str) -> str:
    return text.strip().lower()


def _parse_multi_blank_values(raw: str) -> List[str]:
    if not raw or not raw.strip():
        return []
    text = raw.strip()
    if text.startswith("["):
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return [str(v).strip() for v in data if str(v).strip()]
        except json.JSONDecodeError:
            pass
    for sep in ("|", ";", "；", "、"):
        if sep in text:
            return [p.strip() for p in text.split(sep) if p.strip()]
    return [text.strip()]


def _serialize_blank_answers(values: List[str]) -> str:
    return json.dumps(values, ensure_ascii=False)


def _count_blank_slots(stem: str) -> int:
    return len(_BLANK_PATTERN.findall(stem or ""))


def _grade_fill_blank_string(question: GlobalQuestion, user_answer: Optional[str]) -> str:
    if not user_answer or not user_answer.strip():
        return "wrong"
    correct_parts = _parse_multi_blank_values(question.answer)
    user_parts = _parse_multi_blank_values(user_answer)
    if not correct_parts:
        return "wrong"
    if len(user_parts) != len(correct_parts):
        if len(correct_parts) == 1 and len(user_parts) == 1:
            pass
        else:
            return "wrong"
    for user_part, correct_part in zip(user_parts, correct_parts):
        if _normalize_blank_text(user_part) != _normalize_blank_text(correct_part):
            return "wrong"
    return "correct"


def _parse_ai_grade_response(content: str) -> Tuple[str, str]:
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
    except json.JSONDecodeError:
        pass
    lower = text.lower()
    if "partial" in lower or "部分" in text:
        return "partial", text[:200]
    if "correct" in lower or "正确" in text:
        if "wrong" in lower or "错误" in text:
            return "wrong", text[:200]
        return "correct", text[:200]
    return "wrong", text[:200] if text else ""


async def _grade_by_ai(
    question: GlobalQuestion, user_answer: Optional[str], *, qtype: str
) -> Tuple[str, str]:
    if not user_answer or not user_answer.strip():
        return "wrong", "未作答"
    try:
        from app.services.question_gen_service import _get_llm

        llm = _get_llm()
        if not llm:
            return "wrong", "AI 判题服务不可用"
        type_label = {
            "fill_blank": "填空题",
            "short_answer": "简答题",
            "application": "应用题",
        }.get(qtype, "主观题")
        correct_display = question.answer
        if qtype == "fill_blank":
            parts = _parse_multi_blank_values(question.answer)
            correct_display = "；".join(parts)
        prompt = (
            f"题型：{type_label}\n"
            f"题干：{question.stem}\n"
            f"标准答案：{correct_display}\n"
            f"学生答案：{user_answer}\n"
            "请输出 JSON。"
        )
        resp = await llm.apredict_no_stream(
            input_text=prompt,
            sys_prompt=GRADE_AI_SYS_PROMPT,
            temperature=0,
        )
        content = resp.get("content", "") if isinstance(resp, dict) else str(resp)
        return _parse_ai_grade_response(content)
    except Exception:
        return "wrong", ""


async def _grade_short_answer(question: GlobalQuestion, user_answer: Optional[str]) -> Tuple[str, str]:
    return await _grade_by_ai(question, user_answer, qtype="short_answer")


async def _grade_answer(
    question: GlobalQuestion,
    user_answer: Optional[str],
    status_hint: Optional[str],
    *,
    request_ai_grade: bool = False,
) -> Tuple[str, Optional[str], Optional[str], Optional[str]]:
    """返回 (status, grade_method, string_match_status, ai_reason)。"""
    if status_hint == "unknown":
        return "unknown", None, None, None

    qtype = (question.question_type or "single_choice").lower()

    if qtype == "fill_blank":
        string_status = _grade_fill_blank_string(question, user_answer)
        if request_ai_grade:
            ai_status, ai_reason = await _grade_by_ai(question, user_answer, qtype="fill_blank")
            return ai_status, "ai", string_status, ai_reason or None
        return string_status, "string", string_status, None

    if qtype in ("short_answer", "application"):
        ai_status, ai_reason = await _grade_by_ai(question, user_answer, qtype=qtype)
        return ai_status, "ai", None, ai_reason or None

    if not user_answer or not user_answer.strip():
        return "wrong", "string", None, None

    correct = question.answer.strip().upper()
    user = user_answer.strip().upper()
    status = "correct" if user == correct else "wrong"
    return status, "string", None, None


def _resolve_question_ids(
    db: Session,
    user_id: int,
    *,
    document_id: Optional[str],
    collection_id: Optional[str],
    question_ids: Optional[List[str]],
) -> Tuple[List[str], Optional[str], Optional[str]]:
    resolved_doc_id = document_id
    resolved_coll_id = collection_id

    if question_ids:
        owned = (
            db.query(UserQuestionRef.question_id)
            .filter(
                UserQuestionRef.user_id == user_id,
                UserQuestionRef.question_id.in_(question_ids),
            )
            .all()
        )
        owned_ids = {row[0] for row in owned}
        missing = [qid for qid in question_ids if qid not in owned_ids]
        if missing:
            raise HTTPException(status_code=404, detail=f"题目不存在: {missing[0]}")
        return list(question_ids), resolved_doc_id, resolved_coll_id

    if document_id:
        doc = kb_crud.get_document_by_id_or_dify(db, user_id, document_id)
        if not doc:
            raise HTTPException(status_code=404, detail="文档不存在")
        resolved_doc_id = doc.id
        if doc.question_gen_status != "completed":
            raise HTTPException(
                status_code=409,
                detail="文档尚未出题完成，请先生成题目",
            )

    if collection_id:
        coll = kb_crud.get_collection(db, user_id, collection_id)
        if not coll:
            raise HTTPException(status_code=404, detail="知识库不存在")

    rows = question_crud.list_user_questions(
        db,
        user_id,
        document_id=resolved_doc_id,
        collection_id=collection_id,
    )
    ids = [q.id for _, q in rows]
    random.shuffle(ids)
    return ids, resolved_doc_id, resolved_coll_id


def _to_session_question_out(
    sq, question: GlobalQuestion
) -> QuizSessionQuestionOut:
    options_raw = question_crud.parse_options_json(question.options)
    options = (
        [QuestionOption(**o) for o in options_raw] if options_raw else None
    )
    return QuizSessionQuestionOut(
        question_id=question.id,
        order_index=sq.order_index,
        stem=question.stem,
        question_type=question.question_type,
        options=options,
    )


def _build_session_out(db: Session, session) -> QuizSessionOut:
    rows = quiz_crud.list_session_questions(db, session.id)
    answered_count = quiz_crud.count_answers(db, session.id)
    questions = [_to_session_question_out(sq, q) for sq, q in rows]
    return QuizSessionOut(
        id=session.id,
        title=session.title,
        status=session.status,
        document_id=session.document_id,
        collection_id=session.collection_id,
        total_questions=len(questions),
        answered_count=answered_count,
        started_at=session.started_at,
        finished_at=session.finished_at,
        questions=questions,
    )


def create_quiz_session(
    db: Session, user_id: int, payload: QuizSessionCreate
) -> QuizSessionOut:
    question_ids, doc_id, coll_id = _resolve_question_ids(
        db,
        user_id,
        document_id=payload.document_id,
        collection_id=payload.collection_id,
        question_ids=payload.question_ids,
    )

    if not question_ids:
        raise HTTPException(status_code=409, detail="没有可用题目，请先生成题目")

    title = payload.title
    if not title and doc_id:
        doc = kb_crud.get_document_by_id_or_dify(db, user_id, doc_id)
        if doc:
            title = f"刷题 · {doc.display_name}"

    session = quiz_crud.create_session(
        db,
        user_id=user_id,
        document_id=doc_id,
        collection_id=coll_id or payload.collection_id,
        title=title,
    )
    quiz_crud.add_session_questions(db, session.id, question_ids)
    db.flush()
    return _build_session_out(db, session)


def get_quiz_session(db: Session, user_id: int, session_id: str) -> QuizSessionOut:
    session = quiz_crud.get_session(db, session_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="刷题会话不存在")
    return _build_session_out(db, session)


async def submit_answer(
    db: Session,
    user_id: int,
    session_id: str,
    *,
    question_id: str,
    user_answer: Optional[str] = None,
    status_hint: Optional[str] = None,
    time_spent_seconds: Optional[int] = None,
    request_ai_grade: bool = False,
) -> AnswerResult:
    session = quiz_crud.get_session(db, session_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="刷题会话不存在")
    if session.status == "completed":
        raise HTTPException(status_code=400, detail="会话已结束")

    sq = quiz_crud.get_session_question(db, session_id, question_id)
    if not sq:
        raise HTTPException(status_code=400, detail="题目不在当前会话中")

    question = question_crud.get_question_by_id(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在")

    if status_hint and status_hint not in ("unknown",):
        raise HTTPException(status_code=400, detail="无效的 status 值")

    qtype = (question.question_type or "single_choice").lower()
    if request_ai_grade:
        if qtype != "fill_blank":
            raise HTTPException(status_code=400, detail="仅填空题支持 AI 复判")
        if not user_answer or not user_answer.strip():
            existing = quiz_crud.get_answer(db, session_id, question_id)
            if existing and existing.user_answer:
                user_answer = existing.user_answer
            else:
                raise HTTPException(status_code=400, detail="缺少用户答案，无法 AI 复判")

    result_status, grade_method, string_match_status, ai_reason = await _grade_answer(
        question,
        user_answer,
        status_hint,
        request_ai_grade=request_ai_grade,
    )
    quiz_crud.upsert_answer(
        db,
        session_id=session_id,
        question_id=question_id,
        user_id=user_id,
        user_answer=user_answer,
        status=result_status,
        time_spent_seconds=time_spent_seconds,
        grade_method=grade_method,
        string_match_status=string_match_status,
        ai_reason=ai_reason,
    )

    total = len(quiz_crud.list_session_questions(db, session_id))
    answered_count = quiz_crud.count_answers(db, session_id)
    if answered_count >= total:
        quiz_crud.complete_session(db, session)

    explanation = None
    citation = None
    correct_answer = None

    if result_status in ("wrong", "unknown", "partial"):
        explanation = question.explanation
        citation = _build_citation(db, question_id, session.document_id)
        correct_answer = question.answer
    elif result_status == "correct":
        correct_answer = question.answer

    return AnswerResult(
        question_id=question_id,
        status=result_status,
        correct_answer=correct_answer,
        explanation=explanation,
        citation=citation,
        grade_method=grade_method,
        string_match_status=string_match_status,
        ai_reason=ai_reason,
        answered_count=answered_count,
        total_questions=total,
        session_status=session.status,
    )


def get_session_results(
    db: Session, user_id: int, session_id: str
) -> QuizResultsOut:
    session = quiz_crud.get_session(db, session_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="刷题会话不存在")

    rows = quiz_crud.list_session_questions(db, session_id)
    question_map = {q.id: q for _, q in rows}
    answers = quiz_crud.list_answers_for_session(db, session_id)

    correct_count = sum(1 for a in answers if a.status == "correct")
    wrong_count = sum(1 for a in answers if a.status in ("wrong", "partial"))
    unknown_count = sum(1 for a in answers if a.status == "unknown")

    items: List[QuizReviewItemOut] = []
    for ans in answers:
        if ans.status not in ("wrong", "unknown", "partial"):
            continue
        question = question_map.get(ans.question_id)
        if not question:
            continue
        citation = _build_citation(db, ans.question_id, session.document_id)
        items.append(
            QuizReviewItemOut(
                question_id=ans.question_id,
                stem=question.stem,
                user_answer=ans.user_answer,
                status=ans.status,
                correct_answer=question.answer,
                explanation=question.explanation,
                citation=citation,
            )
        )

    return QuizResultsOut(
        session_id=session.id,
        status=session.status,
        total_questions=len(rows),
        correct_count=correct_count,
        wrong_count=wrong_count,
        unknown_count=unknown_count,
        items=items,
    )
