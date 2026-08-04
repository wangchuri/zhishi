"""笔记/tip 服务测试 — tip 保存到 user_notes、按书查询、跨书隔离。"""
import pytest
from fastapi import HTTPException

from app.api.v1 import notes as notes_api
from app.crud import note as note_crud
from app.models import UserNote
from app.schemas.note import TipCreate


def _tip(**kw):
    data = {"document_id": "d", "page_number": 1, "title": "t", "content": "c"}
    data.update(kw)
    return TipCreate(**data)


def test_create_note_with_document_id(db, user, study_doc):
    note = note_crud.create_note(
        db,
        user_id=user.id,
        title="第 1 页摘录",
        content_md="导数的定义",
        document_id=study_doc.id,
        collection_id=study_doc.collection_id,
        note_type="tip",
    )
    db.commit()
    db.refresh(note)
    assert note.document_id == study_doc.id
    assert note.note_type == "tip"
    assert note.content_md == "导数的定义"


def test_list_notes_by_document(db, user, study_collection):
    from helpers import make_document

    doc_a = make_document(db, user, study_collection, content_hash="hash_nt_a", display_name="a.md")
    doc_b = make_document(db, user, study_collection, content_hash="hash_nt_b", display_name="b.md")

    note_crud.create_note(db, user_id=user.id, title="t1", content_md="c1", document_id=doc_a.id, note_type="tip")
    note_crud.create_note(db, user_id=user.id, title="t2", content_md="c2", document_id=doc_a.id, note_type="tip")
    note_crud.create_note(db, user_id=user.id, title="t3", content_md="c3", document_id=doc_b.id, note_type="tip")
    db.commit()

    tips_a = note_crud.list_notes_by_document(db, user.id, doc_a.id, note_type="tip")
    assert len(tips_a) == 2
    tips_b = note_crud.list_notes_by_document(db, user.id, doc_b.id, note_type="tip")
    assert len(tips_b) == 1


def test_save_tip_endpoint(db, user, study_doc):
    note = notes_api.save_tip(
        _tip(document_id=study_doc.id, page_number=3, title="重点", content="极限的定义"),
        db,
        {"user_id": user.id},
    )
    assert note.note_type == "tip"
    assert note.document_id == study_doc.id
    assert note.title == "重点"
    assert note.content_md == "极限的定义"
    db.commit()

    row = db.query(UserNote).filter(UserNote.id == note.id).first()
    assert row is not None


def test_save_tip_default_title(db, user, study_doc):
    note = notes_api.save_tip(
        _tip(document_id=study_doc.id, page_number=5, title="", content="x"),
        db,
        {"user_id": user.id},
    )
    assert note.title == "第 5 页摘录"


def test_save_tip_invalid_document_404(db, user):
    with pytest.raises(HTTPException) as ei:
        notes_api.save_tip(
            _tip(document_id="missing", page_number=1, title="t", content="c"),
            db,
            {"user_id": user.id},
        )
    assert ei.value.status_code == 404


def test_list_tips_for_document(db, user, study_doc):
    notes_api.save_tip(
        _tip(document_id=study_doc.id, page_number=1, title="t1", content="c1"),
        db,
        {"user_id": user.id},
    )
    db.commit()
    out = notes_api.list_tips_for_document(study_doc.id, db, {"user_id": user.id})
    assert out.total == 1
    assert out.notes[0].document_id == study_doc.id
