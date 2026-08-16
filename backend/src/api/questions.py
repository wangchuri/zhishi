"""题目 API：列表、生成（页面/整篇）、详情、删除。"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models import GlobalQuestion, QuestionProvenance, QuestionRef
from ..schemas import question as q_schemas
from ..services import question as question_service
from ..agents.question_gen_agent import generate_for_document

router = APIRouter(prefix="/api/v1/questions", tags=["questions"])


@router.get("", response_model=q_schemas.QuestionListResult)
def list_questions(
    document_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
):
    data = question_service.list_questions(db, document_id=document_id, collection_id=collection_id, keyword=keyword)
    return data


@router.post("/generate-from-pages", response_model=q_schemas.PageQuestionResult)
async def generate_from_pages(body: q_schemas.GenerateRequest, db: Session = Depends(get_db)):
    result = await generate_for_document(
        body.document_id,
        page_numbers=body.page_numbers,
        questions_per_page=body.questions_per_page or 3,
    )
    return q_schemas.PageQuestionResult(
        document_id=body.document_id,
        page_numbers=body.page_numbers,
        mode="pages",
        questions_created=result["questions_created"],
        questions_reused=result["questions_reused"],
        total_questions=result["total_questions"],
    )


@router.post("/generate-whole-document", response_model=q_schemas.PageQuestionResult)
async def generate_whole_document(body: q_schemas.GenerateWholeRequest, db: Session = Depends(get_db)):
    result = await generate_for_document(
        body.document_id,
        questions_per_page=body.questions_per_page or 3,
    )
    return q_schemas.PageQuestionResult(
        document_id=body.document_id,
        page_numbers=[],
        mode="whole",
        questions_created=result["questions_created"],
        questions_reused=result["questions_reused"],
        total_questions=result["total_questions"],
    )


@router.post("/generate-stream")
async def generate_stream(body: q_schemas.GenerateRequest):
    """SSE 流式出题：逐 chunk 推送进度，完成推送 result 事件。"""
    import asyncio
    import json as _json

    async def gen():
        queue: asyncio.Queue = asyncio.Queue()

        def emit(ev: dict):
            queue.put_nowait(ev)

        task = asyncio.create_task(
            generate_for_document(
                body.document_id,
                page_numbers=body.page_numbers,
                questions_per_page=body.questions_per_page or 3,
                stream_handler=emit,
            )
        )

        while True:
            if task.done() and queue.empty():
                break
            try:
                ev = await asyncio.wait_for(queue.get(), timeout=1.0)
                yield f"data: {_json.dumps(ev, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                continue
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/{question_id}")
def get_question(question_id: str, db: Session = Depends(get_db)):
    return question_service.get_question(db, question_id)


@router.delete("", response_model=q_schemas.DeleteResult)
def delete_by_document(document_id: str, db: Session = Depends(get_db)):
    deleted = question_service.delete_by_document(db, document_id)
    return q_schemas.DeleteResult(deleted_count=deleted, document_id=document_id)


@router.delete("/bulk", response_model=q_schemas.DeleteResult)
def delete_bulk(body: q_schemas.DeleteBulkRequest, db: Session = Depends(get_db)):
    deleted = question_service.delete_bulk(
        db,
        document_id=body.document_id,
        collection_id=body.collection_id,
        question_ids=body.question_ids,
    )
    return q_schemas.DeleteResult(deleted_count=deleted)
