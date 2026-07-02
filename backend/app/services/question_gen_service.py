"""
文档分段 → 题目生成服务
写入 global_questions / question_provenance / user_question_refs
"""
import json
import logging
import re
from typing import Callable, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.crud import kb as kb_crud
from app.crud import question as question_crud
from app.crud import segment as segment_crud
from app.models import Document, DocumentSegment, UserQuestionRef
from app.schemas.question import (
    QuestionDetailOut,
    QuestionGenerateResponse,
    QuestionListOut,
    QuestionOption,
    QuestionOut,
    ProvenanceOut,
)
from app.services.question_hash import compute_content_hash

logger = logging.getLogger(__name__)

MAX_QUESTIONS_PER_DOCUMENT = 20
QUESTIONS_PER_SEGMENT = 1
EXCERPT_MAX_LEN = 500

SYSTEM_PROMPT = """你是知拾学习助手，根据给定文档段落生成单选题。
严格输出 JSON 数组，每项格式：
{"stem":"题干","options":[{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."},{"key":"D","text":"..."}],"answer":"A","explanation":"解析","tags":["标签"]}
要求：1-2 道单选题，答案必须是 A/B/C/D 之一，不要输出 markdown 代码块。"""

QuestionProvider = Callable[[DocumentSegment], List[dict]]

_llm_instance = None


def _get_llm():
    global _llm_instance
    if _llm_instance is not None:
        return _llm_instance
    try:
        from app.utils.tina_loader import tina_env_path
        from tina.llm import BaseAPI

        _llm_instance = BaseAPI(env_path=tina_env_path())
        return _llm_instance
    except Exception:
        logger.warning("Tina LLM 不可用，将使用模板出题", exc_info=True)
        return None


def _extract_json_array(text: str) -> Optional[list]:
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
    stem = (raw.get("stem") or raw.get("question") or "").strip()
    answer = (raw.get("answer") or "").strip().upper()
    options = raw.get("options") or []
    if not stem or not answer or len(options) < 2:
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
    if answer not in {o["key"] for o in norm_options}:
        return None
    tags = raw.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    return {
        "stem": stem,
        "options": norm_options,
        "answer": answer,
        "explanation": (raw.get("explanation") or "").strip() or None,
        "tags": tags,
    }


def _template_questions(segment: DocumentSegment) -> List[dict]:
    title = segment.title or "本节内容"
    snippet = segment.content[:120].replace("\n", " ").strip()
    return [
        {
            "stem": f"关于「{title}」，以下哪项最符合原文内容？",
            "options": [
                {"key": "A", "text": snippet or "与原文核心内容一致"},
                {"key": "B", "text": "与原文无关的干扰项"},
                {"key": "C", "text": "片面或不完整的描述"},
                {"key": "D", "text": "明显错误的描述"},
            ],
            "answer": "A",
            "explanation": "请参考原文段落。",
            "tags": ["自动生成"],
        }
    ]


def _llm_generate(segment: DocumentSegment) -> List[dict]:
    llm = _get_llm()
    if not llm:
        return _template_questions(segment)

    title = segment.title or "（无标题）"
    user_input = (
        f"段落标题：{title}\n\n段落内容：\n{segment.content[:3000]}\n\n"
        f"请生成 {QUESTIONS_PER_SEGMENT} 道单选题。"
    )
    try:
        resp = llm.predict(
            input_text=user_input,
            sys_prompt=SYSTEM_PROMPT,
            format="json",
            temperature=0.3,
            stream=False,
        )
        content = resp.get("content", "") if isinstance(resp, dict) else str(resp)
        items = _extract_json_array(content) or []
        normalized = [_normalize_question(item) for item in items]
        result = [q for q in normalized if q][:QUESTIONS_PER_SEGMENT]
        if result:
            return result
    except Exception:
        logger.warning(
            "LLM 出题失败，回退模板: segment_id=%s", segment.id, exc_info=True
        )
    return _template_questions(segment)


def _make_excerpt(segment: DocumentSegment) -> str:
    text = segment.content.strip()
    if len(text) <= EXCERPT_MAX_LEN:
        return text
    return text[:EXCERPT_MAX_LEN] + "…"


def _persist_question(
    db: Session,
    *,
    user_id: int,
    document: Document,
    segment: DocumentSegment,
    qdata: dict,
) -> Tuple[bool, bool]:
    """返回 (created, reused)。"""
    options_json = json.dumps(qdata["options"], ensure_ascii=False)
    tags_json = json.dumps(qdata.get("tags") or [], ensure_ascii=False)
    content_hash = compute_content_hash(qdata["stem"], qdata["options"], qdata["answer"])

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
            question_type="single_choice",
            options_json=options_json,
            answer=qdata["answer"],
            explanation=qdata.get("explanation"),
            tags_json=tags_json,
            source_type="generated",
        )
        created = True
        reused = False

    if not question_crud.get_provenance_for_segment(db, question.id, segment.id):
        question_crud.create_provenance(
            db,
            question_id=question.id,
            document_id=document.id,
            segment_id=segment.id,
            excerpt=_make_excerpt(segment),
            global_document_id=document.global_document_id,
        )

    if not question_crud.get_user_ref(db, user_id, question.id, document.id):
        question_crud.create_user_ref(
            db,
            user_id=user_id,
            question_id=question.id,
            document_id=document.id,
            segment_id=segment.id,
            collection_id=document.collection_id,
        )

    return created, reused


def _validate_document_for_generation(doc: Optional[Document]) -> Document:
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    if doc.zone != "study":
        raise HTTPException(status_code=400, detail="仅学习区文档可出题")
    if doc.segment_status != "completed":
        raise HTTPException(status_code=400, detail="文档分段未完成，无法出题")
    return doc


def generate_questions(
    db: Session,
    user_id: int,
    document_id: Optional[str] = None,
    segment_ids: Optional[List[str]] = None,
    provider: Optional[QuestionProvider] = None,
) -> QuestionGenerateResponse:
    """
    对文档或指定分段批量出题。
    provider 可注入 mock（测试用）；默认走 LLM + 模板回退。
    """
    gen_provider = provider or _llm_generate
    created_count = 0
    reused_count = 0
    target_doc_id = document_id

    if segment_ids:
        segments: List[DocumentSegment] = []
        document: Optional[Document] = None
        for sid in segment_ids:
            seg = db.query(DocumentSegment).filter(DocumentSegment.id == sid).first()
            if not seg:
                raise HTTPException(status_code=404, detail=f"分段不存在: {sid}")
            doc = kb_crud.get_document_by_id_or_dify(db, user_id, seg.document_id)
            doc = _validate_document_for_generation(doc)
            if document is None:
                document = doc
            elif document.id != doc.id:
                raise HTTPException(
                    status_code=400, detail="segment_ids 必须属于同一文档"
                )
            segments.append(seg)
        target_doc_id = document.id if document else None
    else:
        document = kb_crud.get_document_by_id_or_dify(db, user_id, document_id)
        document = _validate_document_for_generation(document)
        segments = segment_crud.list_segments_for_document(db, document.id)
        target_doc_id = document.id

    if not segments:
        if document:
            document.question_gen_status = "failed"
            db.flush()
        return QuestionGenerateResponse(
            document_id=target_doc_id,
            question_gen_status="failed",
            questions_created=0,
            questions_reused=0,
            total_questions=0,
        )

    document.question_gen_status = "processing"
    db.flush()

    total_questions = 0

    try:
        for segment in segments:
            if total_questions >= MAX_QUESTIONS_PER_DOCUMENT:
                break
            try:
                raw_questions = gen_provider(segment)
            except Exception:
                logger.warning(
                    "分段出题失败，跳过: segment_id=%s", segment.id, exc_info=True
                )
                continue

            for qdata in raw_questions[:QUESTIONS_PER_SEGMENT]:
                if total_questions >= MAX_QUESTIONS_PER_DOCUMENT:
                    break
                normalized = _normalize_question(qdata) if isinstance(qdata, dict) else None
                if not normalized:
                    continue
                created, reused = _persist_question(
                    db,
                    user_id=user_id,
                    document=document,
                    segment=segment,
                    qdata=normalized,
                )
                if created:
                    created_count += 1
                if reused:
                    reused_count += 1
                total_questions += 1

        if total_questions > 0:
            document.question_gen_status = "completed"
        else:
            document.question_gen_status = "failed"
        db.flush()

        return QuestionGenerateResponse(
            document_id=target_doc_id,
            question_gen_status=document.question_gen_status,
            questions_created=created_count,
            questions_reused=reused_count,
            total_questions=total_questions,
        )
    except Exception:
        logger.exception("generate_questions failed: document_id=%s", target_doc_id)
        document.question_gen_status = "failed"
        db.flush()
        raise


def _to_question_out(ref, question) -> QuestionOut:
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
    questions = [_to_question_out(ref, q) for ref, q in rows]
    return QuestionListOut(
        questions=questions,
        total=len(questions),
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
