"""
笔记 API — 保存 tip（伴学摘录）到 user_notes，支持按书查询。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.crud import kb as kb_crud
from app.crud import note as note_crud
from app.schemas.note import NoteListOut, NoteOut, TipCreate

logger = logging.getLogger(__name__)

router = APIRouter(tags=["笔记"])


def _resolve_document(db: Session, user_id: int, document_id: str):
    doc = kb_crud.get_document_by_id_or_dify(db, user_id, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    return doc


@router.post("/tips", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def save_tip(
    payload: TipCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """保存一条伴学 tip 到后端笔记（note_type='tip'，关联文档）。"""
    doc = _resolve_document(db, current_user["user_id"], payload.document_id)
    title = (payload.title or "").strip() or f"第 {payload.page_number} 页摘录"
    note = note_crud.create_note(
        db,
        user_id=current_user["user_id"],
        title=title,
        content_md=payload.content.strip(),
        collection_id=doc.collection_id,
        document_id=doc.id,
        note_type="tip",
    )
    db.commit()
    return note


@router.get("", response_model=NoteListOut)
def list_notes(
    document_id: Optional[str] = None,
    note_type: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """列出当前用户笔记，支持按文档 / 类型过滤。"""
    rows = note_crud.list_notes(
        db,
        current_user["user_id"],
        note_type=note_type,
        document_id=document_id,
        limit=limit,
    )
    return NoteListOut(
        notes=[NoteOut.model_validate(r) for r in rows],
        total=len(rows),
    )


@router.get("/tips/{document_id}", response_model=NoteListOut)
def list_tips_for_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """列出某本书的全部 tip（用于伴学阅读页 tip 面板 / 卡片计数）。"""
    _resolve_document(db, current_user["user_id"], document_id)
    rows = note_crud.list_notes_by_document(
        db,
        current_user["user_id"],
        document_id,
        note_type="tip",
        limit=500,
    )
    return NoteListOut(
        notes=[NoteOut.model_validate(r) for r in rows],
        total=len(rows),
    )
