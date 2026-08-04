"""重启恢复测试 — 重新调度中断的文档 pipeline 与出题状态。"""
from app.crud import segment as segment_crud
from app.services import kb_service
from app.services.segment_service import segment_document
from helpers import make_document


def _make_processing_doc(db, user, collection, **kw):
    doc = make_document(
        db,
        user,
        collection,
        indexing_status="processing",
        **kw,
    )
    doc.indexing_status = "processing"
    doc.question_gen_status = "processing"
    db.commit()
    return doc


def test_recover_re_segments_parsed_doc(db, user, study_collection):
    doc = _make_processing_doc(db, user, study_collection)
    # 首次分段成功但状态未落库（模拟中断在状态更新前）
    assert segment_document(doc.id, db) >= 1
    db.refresh(doc)

    n = kb_service.recover_interrupted_documents(db)
    assert n >= 1
    db.refresh(doc)
    assert doc.segment_status == "completed"
    assert len(segment_crud.list_segments_for_document(db, doc.id)) >= 1


def test_recover_marks_missing_storage_failed(db, user, study_collection):
    # 直接插入一条无 global_document 的 processing 文档（模拟损坏/中断）
    from app.crud import kb as kb_crud

    doc = kb_crud.create_document(
        db,
        user_id=user.id,
        collection_id=study_collection.id,
        zone="study",
        display_name="broken.md",
        content_hash="hash_broken_001",
        indexing_status="processing",
    )
    db.commit()

    kb_service.recover_interrupted_documents(db)
    db.refresh(doc)
    assert doc.indexing_status == "failed"
    assert doc.segment_status == "failed"


def test_recover_resets_question_gen_status(db, user, study_collection):
    _make_processing_doc(db, user, study_collection)
    n = kb_service.reset_interrupted_question_gen(db)
    assert n >= 1
    # 校验所有 processing 均已重置
    from app.models import Document

    stuck = (
        db.query(Document)
        .filter(Document.question_gen_status == "processing")
        .count()
    )
    assert stuck == 0
