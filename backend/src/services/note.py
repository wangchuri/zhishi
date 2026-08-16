"""笔记/报告服务：保存 tip、列出笔记、报告写入。"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ..models import UserNote


def save_tip(
    db: Session,
    *,
    document_id: str,
    page_number: Optional[int],
    title: str,
    content: str,
) -> UserNote:
    note = UserNote(
        document_id=document_id,
        page_number=page_number,
        title=title,
        content_md=content,
        note_type="tip",
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def list_notes(
    db: Session,
    document_id: Optional[str] = None,
    note_type: Optional[str] = None,
    limit: int = 100,
) -> dict:
    q = db.query(UserNote)
    if document_id:
        q = q.filter(UserNote.document_id == document_id)
    if note_type:
        q = q.filter(UserNote.note_type == note_type)
    notes = q.order_by(UserNote.created_at.desc()).limit(limit).all()
    return {
        "notes": [_note_out(n) for n in notes],
        "total": len(notes),
    }


def list_tips(db: Session, document_id: str) -> dict:
    return list_notes(db, document_id=document_id, note_type="tip")


def _note_out(n: UserNote) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "content_md": n.content_md,
        "note_type": n.note_type,
        "document_id": n.document_id,
        "page_number": n.page_number,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


def save_report(db: Session, title: str, content_md: str) -> UserNote:
    note = UserNote(title=title, content_md=content_md, note_type="report")
    db.add(note)
    db.commit()
    db.refresh(note)
    return note
