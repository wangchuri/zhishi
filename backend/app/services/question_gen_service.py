"""
文档页面 → 题目生成服务（精简版）
写入 global_questions / question_provenance / user_question_refs

变更：
- 移除三级回退（Agent → LLM → 模板），只走 Agent 路径
- 移除整份文档出题（generate_questions/schedule_generate_questions），只保留按页出题
- 新 Agent 支持 Chroma 检索 + 批量提交
"""
import json
import logging
import re
from typing import Callable, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import MAX_QUESTIONS_PER_DOCUMENT, MAX_PAGES_PER_GEN, QUESTION_GEN_ASYNC
from app.core.database import SessionLocal
from app.core.job_runner import run_in_background, run_async_coro

from app.crud import kb as kb_crud
from app.crud import question as question_crud
from app.crud import quiz as quiz_crud
from app.crud import segment as segment_crud
from app.crud import tag as tag_crud
from app.models import Document, DocumentSegment, UserQuestionRef
from app.schemas.question import (
    PageQuestionResponse,
    QuestionDeleteResponse,
    QuestionDetailOut,
    QuestionGenerateResponse,
    QuestionListOut,
    QuestionOption,
    QuestionOut,
    ProvenanceOut,
)
from app.services.page_service import get_pages_by_numbers
from app.services.question_hash import compute_content_hash

logger = logging.getLogger(__name__)

EXCERPT_MAX_LEN = 500

QuestionProvider = Callable[[DocumentSegment], List[dict]]
PageProvider = Callable[[dict], List[dict]]


# ───── 题目解析/标准化（被 question_gen_agent.py 复用） ─────

def _extract_json_array(text: str) -> Optional[list]:
    """从 LLM / Agent 返回文本中提取 JSON 数组。"""
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", text)
        if not match:
            return None
        try:
            data = json.loads(match.group())
        except json.JSONDecodeError:
            return None
    if isinstance(data, dict):
        return [data]
    if isinstance(data, list):
        return data
    return None


def _normalize_question(raw: dict) -> Optional[dict]:
    """标准化单题结构，不合规返回 None。"""
    stem = (raw.get("stem") or raw.get("question") or "").strip()
    answer = (raw.get("answer") or "").strip()
    qtype = (raw.get("question_type") or "single_choice").strip().lower()
    options = raw.get("options") or []
    if not stem or not answer:
        return None

    norm_options = []
    for opt in options:
        if isinstance(opt, dict):
            key = str(opt.get("key", "")).strip().upper()
            text = str(opt.get("text", "")).strip()
        else:
            continue
        if key and text:
            norm_options.append({"key": key, "text": text})

    if qtype == "single_choice":
        answer = answer.upper()
        if len(norm_options) < 2 or answer not in {o["key"] for o in norm_options}:
            return None
    elif qtype == "fill_blank":
        parts = []
        if answer.startswith("["):
            try:
                data = json.loads(answer)
                if isinstance(data, list):
                    parts = [str(v).strip() for v in data if str(v).strip()]
            except json.JSONDecodeError:
                pass
        if not parts:
            parts = [p.strip() for p in answer.replace("；", ";").split(";") if p.strip()]
        if not parts:
            return None
        blank_slots = len(re.findall(r"_{3,}|\{\{blank\}\}", stem, re.IGNORECASE))
        if blank_slots > 0 and blank_slots != len(parts):
            return None
        answer = json.dumps(parts, ensure_ascii=False)
        norm_options = []
    elif qtype in ("short_answer", "application"):
        if not norm_options:
            norm_options = []
    else:
        qtype = "single_choice"
        answer = answer.upper()
        if len(norm_options) < 2:
            return None

    tags = raw.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    # 过滤无意义标签
    tags = [t for t in tags if t not in ("自动生成", "") and not re.match(r"^第?\d+页?$|^page\s?\d+$", t, re.IGNORECASE)]

    ref_text = (raw.get("reference_text") or "").strip() or None
    source = raw.get("source") or "ai_generated"
    if source not in ("textbook", "ai_generated"):
        source = "ai_generated"
    return {
        "stem": stem,
        "options": norm_options,
        "answer": answer,
        "explanation": (raw.get("explanation") or "").strip() or None,
        "tags": tags,
        "question_type": qtype,
        "reference_text": ref_text,
        "source": source,
    }


# ───── TAG 辅助 ─────

def _existing_tag_names(db: Session, user_id: int, document_id: Optional[str] = None) -> List[str]:
    rows = tag_crud.list_tags_for_user(db, user_id, document_id=document_id)
    return [r.name for r in rows]


def _format_tag_hint(tag_names: List[str]) -> str:
    if not tag_names:
        return "（暂无已有 tag，请创建简洁、可复用的知识点标签）"
    return "已有 tag（请优先复用）：" + "、".join(tag_names[:40])


# ───── 持久化（不变） ─────

def _make_excerpt(text: str, title: str = "") -> str:
    excerpt = text.strip()
    if len(excerpt) <= EXCERPT_MAX_LEN:
        return f"[{title}] {excerpt}" if title else excerpt
    return f"[{title}] {excerpt[:EXCERPT_MAX_LEN]}…" if title else excerpt[:EXCERPT_MAX_LEN] + "…"


def _persist_question(
    db: Session,
    *,
    user_id: int,
    document: Document,
    segment: DocumentSegment,
    qdata: dict,
    source_type: str = "generated",
) -> Tuple[bool, bool]:
    """返回 (created, reused)。"""
    return _persist_question_core(
        db,
        user_id=user_id,
        document=document,
        qdata=qdata,
        source_type=source_type,
        segment_id=segment.id,
        excerpt=_make_excerpt(segment.content, segment.title),
    )


def _persist_question_from_page(
    db: Session,
    *,
    user_id: int,
    document: Document,
    page: dict,
    qdata: dict,
    source_type: str = "generated",
) -> Tuple[bool, bool]:
    title = page.get("title") or f"第 {page.get('page_number', '?')} 页"
    return _persist_question_core(
        db,
        user_id=user_id,
        document=document,
        qdata=qdata,
        source_type=source_type,
        segment_id=page.get("segment_id"),
        excerpt=_make_excerpt(page.get("content", ""), title),
    )


def _persist_question_core(
    db: Session,
    *,
    user_id: int,
    document: Document,
    qdata: dict,
    source_type: str,
    segment_id: Optional[str],
    excerpt: str,
) -> Tuple[bool, bool]:
    """返回 (created, reused)。"""
    tag_crud.ensure_tags(
        db,
        user_id=user_id,
        tag_names=qdata.get("tags") or [],
        document_id=document.id,
    )

    ref_text = qdata.get("reference_text")
    if ref_text:
        excerpt = ref_text[:EXCERPT_MAX_LEN] + ("…" if len(ref_text) > EXCERPT_MAX_LEN else "")

    options_json = json.dumps(qdata["options"], ensure_ascii=False) if qdata.get("options") else None
    tags_json = json.dumps(qdata.get("tags") or [], ensure_ascii=False)
    qtype = qdata.get("question_type") or "single_choice"
    content_hash = compute_content_hash(qdata["stem"], qdata.get("options") or [], qdata["answer"])

    existing = question_crud.get_question_by_content_hash(db, content_hash)
    created = False
    if existing:
        question = existing
        reused = True
    else:
        question = question_crud.create_global_question(
            db,
            content_hash=content_hash,
            stem=qdata["stem"],
            question_type=qtype,
            options_json=options_json,
            answer=qdata["answer"],
            explanation=qdata.get("explanation"),
            tags_json=tags_json,
            source_type=source_type,
        )
        created = True
        reused = False

    if segment_id:
        if not question_crud.get_provenance_for_segment(db, question.id, segment_id):
            question_crud.create_provenance(
                db,
                question_id=question.id,
                document_id=document.id,
                segment_id=segment_id,
                excerpt=excerpt,
                global_document_id=document.global_document_id,
            )
    elif not question_crud.get_provenance_for_document_excerpt(
        db, question.id, document.id, excerpt
    ):
        question_crud.create_provenance(
            db,
            question_id=question.id,
            document_id=document.id,
            segment_id=None,
            excerpt=excerpt,
            global_document_id=document.global_document_id,
        )

    if not question_crud.get_user_ref(db, user_id, question.id, document.id):
        question_crud.create_user_ref(
            db,
            user_id=user_id,
            question_id=question.id,
            document_id=document.id,
            segment_id=segment_id,
            collection_id=document.collection_id,
        )

    return created, reused


# ───── 校验 ─────

def _validate_document_for_page_ops(doc: Optional[Document]) -> Document:
    """按页出题：仅需学习区 + 可读 parsed 文本。"""
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    if doc.zone != "study":
        raise HTTPException(status_code=400, detail="仅学习区文档可出题")
    return doc


# ───── 按页出题（核心入口） ─────

def generate_from_pages(
    db: Session,
    user_id: int,
    document_id: str,
    page_numbers: List[int],
    questions_per_page: int = 1,
) -> PageQuestionResponse:
    """对选中页批量出题，走 Agent 路径（含 Chroma 检索 + 批量提交）。"""
    doc = kb_crud.get_document_by_id_or_dify(db, user_id, document_id)
    doc = _validate_document_for_page_ops(doc)

    # 页数上限检查
    if MAX_PAGES_PER_GEN > 0 and len(page_numbers) > MAX_PAGES_PER_GEN:
        raise HTTPException(
            status_code=400,
            detail=f"单次最多选择 {MAX_PAGES_PER_GEN} 页",
        )

    pages = get_pages_by_numbers(db, doc, page_numbers)
    created_count = 0
    reused_count = 0
    total_questions = 0
    tag_hint = _format_tag_hint(_existing_tag_names(db, user_id, document_id=doc.id))

    doc.question_gen_status = "processing"
    db.flush()

    try:
        from app.agents.question_gen_agent import agent_generate_from_pages

        pairs = run_async_coro(agent_generate_from_pages(
            db=db,
            user_id=user_id,
            document_id=doc.id,
            pages=pages,
            questions_per_page=questions_per_page,
            tag_hint=tag_hint,
        ))

        if not pairs:
            doc.question_gen_status = "failed"
            db.flush()
            return PageQuestionResponse(
                document_id=doc.id,
                page_numbers=page_numbers,
                mode="generate",
                question_gen_status="failed",
                questions_created=0,
                questions_reused=0,
                total_questions=0,
            )

        for page, qdata in pairs:
            if total_questions >= MAX_QUESTIONS_PER_DOCUMENT:
                break
            source_type = qdata.get("source", "ai_generated")
            created, reused = _persist_question_from_page(
                db,
                user_id=user_id,
                document=doc,
                page=page,
                qdata=qdata,
                source_type=source_type,
            )
            if created:
                created_count += 1
            if reused:
                reused_count += 1
            total_questions += 1

        doc.question_gen_status = "completed" if total_questions > 0 else "failed"
        db.flush()
        return PageQuestionResponse(
            document_id=doc.id,
            page_numbers=page_numbers,
            mode="generate",
            question_gen_status=doc.question_gen_status,
            questions_created=created_count,
            questions_reused=reused_count,
            total_questions=total_questions,
        )
    except Exception:
        doc.question_gen_status = "failed"
        db.flush()
        logger.exception("generate_from_pages failed: document_id=%s", doc.id)
        raise


def schedule_generate_from_pages(
    db: Session,
    user_id: int,
    document_id: str,
    page_numbers: List[int],
    questions_per_page: int = 1,
) -> PageQuestionResponse:
    """异步版：校验后立即返回 processing，后台线程执行出题。"""
    doc = kb_crud.get_document_by_id_or_dify(db, user_id, document_id)
    doc = _validate_document_for_page_ops(doc)

    if MAX_PAGES_PER_GEN > 0 and len(page_numbers) > MAX_PAGES_PER_GEN:
        raise HTTPException(
            status_code=400,
            detail=f"单次最多选择 {MAX_PAGES_PER_GEN} 页",
        )

    get_pages_by_numbers(db, doc, page_numbers)

    doc.question_gen_status = "processing"
    db.flush()

    def worker() -> None:
        wdb = SessionLocal()
        try:
            generate_from_pages(
                wdb,
                user_id=user_id,
                document_id=doc.id,
                page_numbers=page_numbers,
                questions_per_page=questions_per_page,
            )
            wdb.commit()
        except Exception:
            wdb.rollback()
            logger.exception("async generate_from_pages failed: document_id=%s", doc.id)
            try:
                failed = kb_crud.get_document_by_id_internal(wdb, doc.id)
                if failed:
                    failed.question_gen_status = "failed"
                    wdb.commit()
            except Exception:
                wdb.rollback()
        finally:
            wdb.close()

    run_in_background(worker, name="question-gen")
    return PageQuestionResponse(
        document_id=doc.id,
        page_numbers=page_numbers,
        mode="generate",
        question_gen_status="processing",
        questions_created=0,
        questions_reused=0,
        total_questions=0,
    )


def is_question_gen_async() -> bool:
    return QUESTION_GEN_ASYNC


# ───── 题目查询/删除（不变） ─────

def _to_question_out(
    ref,
    question,
    *,
    user_answer_status: Optional[str] = None,
    attempt_count: int = 0,
) -> QuestionOut:
    options_raw = question_crud.parse_options_json(question.options)
    options = (
        [QuestionOption(**o) for o in options_raw] if options_raw else None
    )
    tags = question_crud.parse_tags_json(question.tags)
    return QuestionOut(
        id=question.id,
        stem=question.stem,
        question_type=question.question_type,
        options=options,
        answer=question.answer,
        explanation=question.explanation,
        tags=tags,
        source_type=question.source_type,
        document_id=ref.document_id,
        collection_id=ref.collection_id,
        created_at=question.created_at,
        user_answer_status=user_answer_status,
        attempt_count=attempt_count,
    )


def list_questions(
    db: Session,
    user_id: int,
    document_id: Optional[str] = None,
    collection_id: Optional[str] = None,
) -> QuestionListOut:
    if document_id:
        doc = kb_crud.get_document_by_id_or_dify(db, user_id, document_id)
        if not doc:
            raise HTTPException(status_code=404, detail="文档不存在")
        document_id = doc.id

    rows = question_crud.list_user_questions(
        db, user_id, document_id=document_id, collection_id=collection_id
    )
    question_ids = [q.id for _, q in rows]
    stats_map = quiz_crud.get_user_answer_stats_for_questions(
        db, user_id, question_ids
    )

    questions: List[QuestionOut] = []
    answered_count = 0
    correct_count = 0
    wrong_count = 0
    unknown_count = 0

    for ref, q in rows:
        latest_status, attempt_count = stats_map.get(q.id, (None, 0))
        questions.append(
            _to_question_out(
                ref,
                q,
                user_answer_status=latest_status,
                attempt_count=attempt_count,
            )
        )
        if attempt_count > 0:
            answered_count += 1
            if latest_status == "correct":
                correct_count += 1
            elif latest_status == "wrong":
                wrong_count += 1
            elif latest_status == "unknown":
                unknown_count += 1

    return QuestionListOut(
        questions=questions,
        total=len(questions),
        document_id=document_id,
        collection_id=collection_id,
        answered_count=answered_count,
        correct_count=correct_count,
        wrong_count=wrong_count,
        unknown_count=unknown_count,
    )


def delete_user_questions(
    db: Session,
    user_id: int,
    *,
    document_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    question_ids: Optional[List[str]] = None,
) -> QuestionDeleteResponse:
    if not document_id and not collection_id and not question_ids:
        raise HTTPException(
            status_code=400,
            detail="至少提供 document_id、collection_id 或 question_ids 之一",
        )

    if document_id:
        doc = kb_crud.get_document_by_id_or_dify(db, user_id, document_id)
        if not doc:
            raise HTTPException(status_code=404, detail="文档不存在")
        document_id = doc.id

    deleted_count = question_crud.delete_user_question_refs(
        db,
        user_id,
        document_id=document_id,
        collection_id=collection_id,
        question_ids=question_ids,
    )
    return QuestionDeleteResponse(
        deleted_count=deleted_count,
        document_id=document_id,
        collection_id=collection_id,
    )


def get_question_detail(
    db: Session, user_id: int, question_id: str
) -> QuestionDetailOut:
    ref_row = (
        db.query(UserQuestionRef)
        .filter(
            UserQuestionRef.user_id == user_id,
            UserQuestionRef.question_id == question_id,
        )
        .first()
    )
    if not ref_row:
        raise HTTPException(status_code=404, detail="题目不存在")

    question = question_crud.get_question_by_id(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在")

    base = _to_question_out(ref_row, question)
    prov_rows = question_crud.list_provenance_for_question(db, question_id)
    provenance = [ProvenanceOut.model_validate(p) for p in prov_rows]

    return QuestionDetailOut(**base.model_dump(), provenance=provenance)