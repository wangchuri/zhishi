from typing import List, Optional

from sqlalchemy.orm import Session

from app.models import UserNote


def create_note(
    db: Session,
    *,
    user_id: int,
    title: str,
    content_md: str,
    collection_id: Optional[str] = None,
    document_id: Optional[str] = None,
    note_type: str = "manual",
) -> UserNote:
    row = UserNote(
        user_id=user_id,
        title=title,
        content_md=content_md,
        collection_id=collection_id,
        document_id=document_id,
        note_type=note_type,
    )
    db.add(row)
    db.flush()
    return row


def list_notes(
    db: Session,
    user_id: int,
    *,
    note_type: Optional[str] = None,
    document_id: Optional[str] = None,
    limit: int = 50,
) -> List[UserNote]:
    query = db.query(UserNote).filter(UserNote.user_id == user_id)
    if note_type:
        query = query.filter(UserNote.note_type == note_type)
    if document_id:
        query = query.filter(UserNote.document_id == document_id)
    return query.order_by(UserNote.created_at.desc()).limit(limit).all()


def list_notes_by_document(
    db: Session,
    user_id: int,
    document_id: str,
    *,
    note_type: Optional[str] = None,
    limit: int = 200,
) -> List[UserNote]:
    return list_notes(
        db,
        user_id,
        note_type=note_type,
        document_id=document_id,
        limit=limit,
    )


def get_latest_note(
    db: Session, user_id: int, note_type: Optional[str] = None
) -> Optional[UserNote]:
    query = db.query(UserNote).filter(UserNote.user_id == user_id)
    if note_type:
        query = query.filter(UserNote.note_type == note_type)
    return query.order_by(UserNote.created_at.desc()).first()


def get_note_by_id(
    db: Session, user_id: int, note_id: str
) -> Optional[UserNote]:
    return (
        db.query(UserNote)
        .filter(UserNote.id == note_id, UserNote.user_id == user_id)
        .first()
    )
