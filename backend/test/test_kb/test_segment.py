"""分段服务测试：split_text（标题/窗口）与 segment_document（学习区/生活区）。"""
from app.crud import segment as segment_crud
from app.services.segment_service import WINDOW_SIZE, split_text, segment_document


def test_split_by_headings():
    text = "# 第一章\n内容A\n\n## 小结\n内容B"
    segs = split_text(text)
    assert len(segs) == 2
    assert segs[0]["title"] == "第一章"
    assert segs[0]["order_index"] == 0
    assert "内容A" in segs[0]["content"]
    assert segs[1]["title"] == "小结"


def test_split_by_window_no_headings():
    text = "字" * (WINDOW_SIZE * 2 + 100)
    segs = split_text(text)
    assert len(segs) >= 2
    assert segs[0]["char_start"] == 0
    assert segs[-1]["char_end"] == len(text)


def test_split_by_window_small_text():
    segs = split_text("短文本")
    assert len(segs) == 1
    assert segs[0]["content"] == "短文本"


def test_segment_document_study_zone(db, study_doc):
    n = segment_document(study_doc.id, db)
    assert n >= 1
    rows = segment_crud.list_segments_for_document(db, study_doc.id)
    assert len(rows) == n
    doc = segment_crud.get_document_by_id(db, study_doc.id)
    assert doc.segment_status == "completed"


def test_segment_document_life_zone_returns_zero(db, user, life_collection):
    from helpers import make_document

    doc = make_document(
        db,
        user,
        life_collection,
        content_hash="hash_life_001",
        display_name="notes.md",
    )
    assert doc.zone == "life"
    assert segment_document(doc.id, db) == 0
    assert len(segment_crud.list_segments_for_document(db, doc.id)) == 0


def test_segment_document_missing_returns_zero(db):
    assert segment_document("not-exist", db) == 0


def test_re_segment_deletes_old(db, study_doc):
    n1 = segment_document(study_doc.id, db)
    n2 = segment_document(study_doc.id, db)
    assert n1 == n2
    rows = segment_crud.list_segments_for_document(db, study_doc.id)
    assert len(rows) == n1
