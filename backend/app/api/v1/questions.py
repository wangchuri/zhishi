"""
题目 API — 生成、列表、详情（含 provenance）

注意：出题入口已统一为 /generate-from-pages（需要用户选择页码），
整份文档出题功能已移除，请使用出题页操作。
"""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.core.database import SessionLocal
from app.schemas.page import PageGenerateRequest
from app.schemas.question import (
    PageQuestionResponse,
    QuestionBulkDeleteRequest,
    QuestionDeleteResponse,
    QuestionDetailOut,
    QuestionListOut,
)
from app.services import question_gen_service
from app.services.question_gen_service import _persist_question_from_page
from app.agents.question_gen_agent import question_gen_manager
from app.services.page_service import get_pages_by_numbers
from app.crud import kb as kb_crud
from app.crud import tag as tag_crud

logger = logging.getLogger(__name__)

router = APIRouter(tags=["题目"])


@router.post(
    "/generate-from-pages",
    response_model=PageQuestionResponse,
    status_code=status.HTTP_200_OK,
)
def generate_from_pages(
    payload: PageGenerateRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """对选中页批量出题（Agent + Chroma 检索 + 批量提交）。"""
    if question_gen_service.is_question_gen_async():
        result = question_gen_service.schedule_generate_from_pages(
            db=db,
            user_id=current_user["user_id"],
            document_id=payload.document_id,
            page_numbers=payload.page_numbers,
            questions_per_page=payload.questions_per_page,
        )
    else:
        result = question_gen_service.generate_from_pages(
            db=db,
            user_id=current_user["user_id"],
            document_id=payload.document_id,
            page_numbers=payload.page_numbers,
            questions_per_page=payload.questions_per_page,
        )
    db.commit()
    return result


@router.post("/generate-stream")
async def generate_from_pages_stream(
    payload: PageGenerateRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """
    流式出题 SSE 接口。
    实时推送 Agent 推理过程，完成后推送结果。
    """
    user_id = current_user["user_id"]
    document_id = payload.document_id
    pages = get_pages_by_numbers(
        db, kb_crud.get_document_by_id_or_dify(db, user_id, document_id),
        payload.page_numbers,
    )
    tag_names = tag_crud.list_tags_for_user(db, user_id, document_id=document_id)
    tag_hint = "、".join([r.name for r in tag_names[:40]]) if tag_names else ""

    async def event_stream():
        worker = question_gen_manager.get_worker(user_id)
        if not worker.is_ready:
            yield f"data: {json.dumps({'event': 'error', 'content': 'Agent 不可用'}, ensure_ascii=False)}\n\n"
            return

        async for chunk in worker.submit_stream(
            pages=pages,
            questions_per_page=payload.questions_per_page,
            tag_hint=tag_hint or "（暂无已有 tag）",
            collection_id=document_id,
        ):
            if chunk.get("event") == "result" and chunk.get("questions"):
                # 持久化题目到数据库
                doc = kb_crud.get_document_by_id_or_dify(db, user_id, document_id)
                if doc:
                    submitted = chunk["questions"]
                    created_count = 0
                    total = 0
                    # 将题目与页面配对（与 sync 路径保持一致）
                    q_per_page = max(1, len(submitted) // len(pages))
                    q_idx = 0
                    for p in pages:
                        for _ in range(q_per_page):
                            if q_idx >= len(submitted):
                                break
                            c, _ = _persist_question_from_page(
                                db, user_id=user_id, document=doc, page=p, qdata=submitted[q_idx]
                            )
                            if c:
                                created_count += 1
                            total += 1
                            q_idx += 1
                    while q_idx < len(submitted):
                        c, _ = _persist_question_from_page(
                            db, user_id=user_id, document=doc, page=pages[-1], qdata=submitted[q_idx]
                        )
                        if c:
                            created_count += 1
                        q_idx += 1

                    db.commit()
                    logger.info("流式出题持久化: user_id=%s, document_id=%s, created=%d, total=%d",
                                user_id, document_id, created_count, total)

                    # 更新 chunk 数量信息
                    chunk["questions_created"] = created_count

            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("", response_model=QuestionListOut)
def list_questions(
    document_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """列出当前用户可见题目，支持 document_id / collection_id 过滤。"""
    return question_gen_service.list_questions(
        db=db,
        user_id=current_user["user_id"],
        document_id=document_id,
        collection_id=collection_id,
    )


@router.delete("", response_model=QuestionDeleteResponse)
def delete_questions_by_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """删除当前用户对指定文档的题库引用（不删 global_questions / quiz_answers）。"""
    result = question_gen_service.delete_user_questions(
        db=db,
        user_id=current_user["user_id"],
        document_id=document_id,
    )
    db.commit()
    return result


@router.delete("/bulk", response_model=QuestionDeleteResponse)
def delete_questions_bulk(
    payload: QuestionBulkDeleteRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """批量删除用户题库引用，可按 document_id / collection_id / question_ids 过滤。"""
    result = question_gen_service.delete_user_questions(
        db=db,
        user_id=current_user["user_id"],
        document_id=payload.document_id,
        collection_id=payload.collection_id,
        question_ids=payload.question_ids,
    )
    db.commit()
    return result


@router.get("/{question_id}", response_model=QuestionDetailOut)
def get_question(
    question_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """单题详情，含 provenance / citation 溯源信息。"""
    return question_gen_service.get_question_detail(
        db=db,
        user_id=current_user["user_id"],
        question_id=question_id,
    )