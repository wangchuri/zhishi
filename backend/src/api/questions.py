"""题目 API：列表、生成（页面/整篇）、详情、删除。"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models import GlobalQuestion, QuestionProvenance, QuestionRef
from ..schemas import question as q_schemas
from ..services.question import question_service
from ..services.question_gen_jobs import question_gen_jobs
from ..agents.question_gen_agent import generate_for_document

router = APIRouter(prefix="/api/v1/questions", tags=["questions"])

# 0 = 由 Agent 自行决定每页题数；None 时沿用默认 3
def _questions_per_page(value: Optional[int], default: int = 3) -> int:
    if value is None:
        return default
    return max(0, int(value))


@router.get("", response_model=q_schemas.QuestionListResult)
def list_questions(
    document_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    group_id: Optional[str] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
):
    data = question_service.list_questions(
        db,
        document_id=document_id,
        collection_id=collection_id,
        keyword=keyword,
        group_id=group_id,
    )
    return data


@router.post("/generate-from-pages", response_model=q_schemas.PageQuestionResult)
async def generate_from_pages(body: q_schemas.GenerateRequest, db: Session = Depends(get_db)):
    result = await generate_for_document(
        body.document_id,
        page_numbers=body.page_numbers,
        questions_per_page=_questions_per_page(body.questions_per_page),
    )
    from ..services.task import evaluate
    return q_schemas.PageQuestionResult(
        document_id=body.document_id,
        page_numbers=body.page_numbers,
        mode="pages",
        questions_created=result["questions_created"],
        questions_reused=result["questions_reused"],
        total_questions=result["total_questions"],
        completed_tasks=evaluate(db) or None,
    )


@router.post("/generate-whole-document", response_model=q_schemas.PageQuestionResult)
async def generate_whole_document(body: q_schemas.GenerateWholeRequest, db: Session = Depends(get_db)):
    result = await generate_for_document(
        body.document_id,
        questions_per_page=_questions_per_page(body.questions_per_page),
    )
    from ..services.task import evaluate
    return q_schemas.PageQuestionResult(
        document_id=body.document_id,
        page_numbers=[],
        mode="whole",
        questions_created=result["questions_created"],
        questions_reused=result["questions_reused"],
        total_questions=result["total_questions"],
        completed_tasks=evaluate(db) or None,
    )


@router.post("/generate-stream")
async def generate_stream(body: q_schemas.GenerateRequest):
    """SSE 流式出题：逐 chunk 推送进度，完成推送 result 事件。"""
    import asyncio
    import json as _json

    async def gen():
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def emit(ev: dict):
            try:
                loop.call_soon_threadsafe(queue.put_nowait, ev)
            except Exception:
                pass

        task = asyncio.create_task(
            generate_for_document(
                body.document_id,
                page_numbers=body.page_numbers,
                questions_per_page=_questions_per_page(body.questions_per_page),
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
        from ..core.database import SessionLocal
        from ..services.task import evaluate
        check_db = SessionLocal()
        try:
            done_tasks = evaluate(check_db)
            if done_tasks:
                yield f"data: {_json.dumps({'event': 'completed_tasks', 'completed_tasks': done_tasks}, ensure_ascii=False)}\n\n"
        finally:
            check_db.close()
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/jobs")
def list_generation_jobs():
    """当前正在运行的出题 Agent 任务（题库页轮询）。"""
    return {"jobs": question_gen_jobs.list_running()}


@router.websocket("/jobs/{job_id}/stream")
async def job_stream(websocket: WebSocket, job_id: str):
    """旁路观看出题 Agent：先回放缓冲，再推 on_stream_chunk。"""
    await websocket.accept()
    sub = question_gen_jobs.subscribe(job_id)
    if not sub:
        await websocket.send_json({"event": "error", "content": "任务不存在或已结束"})
        await websocket.close()
        return
    snapshot, replay, queue = sub
    try:
        await websocket.send_json({"event": "hello", "job": snapshot})
        for ev in replay:
            await websocket.send_json(ev)
        if snapshot.get("status") == "done":
            return
        while True:
            ev = await queue.get()
            await websocket.send_json(ev)
            if ev.get("event") == "done":
                break
    except WebSocketDisconnect:
        pass
    finally:
        question_gen_jobs.unsubscribe(job_id, queue)


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
