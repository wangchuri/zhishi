"""学习分析 + 笔记 API。"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..schemas import ai as ai_schemas
from ..schemas import learning as l_schemas
from ..services.analytics import analytics_service
from ..services.note import note_service

router = APIRouter(prefix="/api/v1", tags=["analytics"])


@router.get("/analytics/stats")
def stats(db: Session = Depends(get_db)):
    return analytics_service.get_stats(db)


@router.get("/analytics/tag-stats")
def tag_stats(document_id: Optional[str] = None, db: Session = Depends(get_db)):
    return analytics_service.get_tag_stats(db, document_id)


@router.get("/analytics/activity")
def activity(db: Session = Depends(get_db)):
    return analytics_service.get_activity(db)


@router.post("/analytics/activity")
def report_activity(body: l_schemas.ReportActivityIn, db: Session = Depends(get_db)):
    return analytics_service.report_activity(db, body.seconds)


@router.get("/analytics/streak")
def streak(db: Session = Depends(get_db)):
    return analytics_service.get_streak(db)


@router.post("/analytics/learning-report")
async def learning_report(db: Session = Depends(get_db)):
    from ..services.report import report_service
    report, saved = await report_service.generate_report(db)
    return {"report": report, "saved_to_notes": saved}


# ---- 笔记 ----

@router.post("/notes/tips", response_model=ai_schemas.NoteItem)
def save_tip(body: ai_schemas.NoteTipCreate, db: Session = Depends(get_db)):
    note = note_service.save_tip(
        db,
        document_id=body.document_id,
        page_number=body.page_number,
        title=body.title,
        content=body.content,
        tags=body.tags,
    )
    return note_service.note_to_item(db, note)


@router.post("/notes", response_model=ai_schemas.NoteItem)
def create_note(body: ai_schemas.NoteCreate, db: Session = Depends(get_db)):
    note = note_service.create_note(
        db,
        title=body.title,
        content_md=body.content_md,
        folder=body.folder,
        document_id=body.document_id,
        page_number=body.page_number,
        tags=body.tags,
    )
    return note_service.note_to_item(db, note)


@router.get("/notes", response_model=ai_schemas.NoteListResult)
def list_notes(
    document_id: Optional[str] = None,
    note_type: Optional[str] = None,
    folder: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    return note_service.list_notes(
        db, document_id=document_id, note_type=note_type, folder=folder, limit=limit
    )


@router.get("/notes/tip-tags", response_model=ai_schemas.TipTagList)
def list_tip_tags(db: Session = Depends(get_db)):
    return {"tags": note_service.list_tip_tags(db)}


@router.get("/notes/folders", response_model=ai_schemas.NoteFolderList)
def list_note_folders(db: Session = Depends(get_db)):
    return {"folders": note_service.list_folders(db)}


@router.get("/notes/tips/{document_id}", response_model=ai_schemas.NoteListResult)
def list_tips(document_id: str, db: Session = Depends(get_db)):
    return note_service.list_tips(db, document_id)


@router.patch("/notes/{note_id}", response_model=ai_schemas.NoteItem)
def update_note(note_id: str, body: ai_schemas.NoteUpdate, db: Session = Depends(get_db)):
    note = note_service.update_note(
        db,
        note_id,
        title=body.title,
        content_md=body.content_md,
        folder=body.folder,
        document_id=body.document_id,
        page_number=body.page_number,
        tags=body.tags,
    )
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return note_service.note_to_item(db, note)


@router.delete("/notes/{note_id}")
def delete_note(note_id: str, db: Session = Depends(get_db)):
    if not note_service.delete_note(db, note_id):
        raise HTTPException(status_code=404, detail="笔记不存在")
    return {"ok": True}


@router.get("/notes/{note_id}", response_model=ai_schemas.NoteItem)
def get_note(note_id: str, db: Session = Depends(get_db)):
    note = note_service.get_note(db, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return note_service.note_to_item(db, note)
