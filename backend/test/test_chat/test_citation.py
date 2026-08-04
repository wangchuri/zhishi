"""聊天 citation 测试：RAG 命中映射到 document_segments。"""
from app.crud import segment as segment_crud
from app.services.citation_service import (
    _match_segment,
    _overlap_score,
    build_citations_from_hits,
    filter_hits_by_collection,
    resolve_chat_collection,
)
from app.services.segment_service import segment_document


def test_resolve_chat_collection_defaults_to_study(db, user, collections):
    coll, dataset_id = resolve_chat_collection(db, user.id, None, "ds-user")
    assert coll.zone == "study"
    assert coll.is_default is True
    assert dataset_id == "ds-user"


def test_resolve_chat_collection_by_id(db, user, collections):
    study_coll = next(c for c in collections if c.zone == "study")
    coll, _ = resolve_chat_collection(db, user.id, study_coll.id, "ds-x")
    assert coll.id == study_coll.id


def test_resolve_chat_collection_missing_404(db, user, collections):
    from fastapi import HTTPException

    import pytest

    with pytest.raises(HTTPException) as ei:
        resolve_chat_collection(db, user.id, "missing-coll", None)
    assert ei.value.status_code == 404


def test_filter_hits_by_collection_no_filter_returns_all(db, user, study_doc):
    hits = [{"score": 0.9, "content": "x", "document_id": "d1"}]
    assert filter_hits_by_collection(db, user.id, None, hits) == hits


def test_filter_hits_by_collection_local_metadata(db, user, collections):
    study_coll = next(c for c in collections if c.zone == "study")
    hits = [
        {
            "score": 0.9,
            "content": "a",
            "document_id": "d1",
            "collection_id": study_coll.id,
        },
        {
            "score": 0.8,
            "content": "b",
            "document_id": "d2",
            "collection_id": "other",
        },
    ]
    filtered = filter_hits_by_collection(db, user.id, study_coll.id, hits)
    assert len(filtered) == 1
    assert filtered[0]["document_id"] == "d1"


def test_build_citations_local_hits(db, user, study_doc):
    segment_document(study_doc.id, db)
    db.commit()
    seg = segment_crud.list_segments_for_document(db, study_doc.id)[0]

    hits = [
        {
            "score": 0.95,
            "content": seg.content,
            "document_id": study_doc.id,
            "segment_id": seg.id,
            "collection_id": study_doc.collection_id,
            "title": seg.title,
            "char_start": seg.char_start,
            "char_end": seg.char_end,
            "display_name": study_doc.display_name,
        }
    ]
    citations = build_citations_from_hits(
        db, user.id, study_doc.collection_id, hits
    )
    assert len(citations) == 1
    c = citations[0]
    assert c.doc_id == study_doc.id
    assert c.segment_id == seg.id
    assert c.char_start == seg.char_start
    assert c.char_end == seg.char_end
    assert seg.content.strip() in (c.snippet or "")


def test_build_citations_dedupe(db, user, study_doc):
    segment_document(study_doc.id, db)
    db.commit()
    seg = segment_crud.list_segments_for_document(db, study_doc.id)[0]
    hits = [
        {
            "score": 0.9,
            "content": "a",
            "document_id": study_doc.id,
            "segment_id": seg.id,
            "collection_id": study_doc.collection_id,
        },
        {
            "score": 0.8,
            "content": "b",
            "document_id": study_doc.id,
            "segment_id": seg.id,
            "collection_id": study_doc.collection_id,
        },
    ]
    citations = build_citations_from_hits(
        db, user.id, study_doc.collection_id, hits
    )
    assert len(citations) == 1


def test_build_citations_wrong_collection_skipped(db, user, study_doc):
    citations = build_citations_from_hits(
        db,
        user.id,
        "other-coll",
        [
            {
                "score": 0.9,
                "content": "a",
                "document_id": study_doc.id,
                "segment_id": "s1",
                "collection_id": "other-coll-2",
            }
        ],
    )
    assert len(citations) == 0


def test_overlap_score():
    assert _overlap_score("北京", "北京是首都") == 1.0
    assert _overlap_score("", "x") == 0.0
    assert _overlap_score("x", "") == 0.0


def test_match_segment(db, user, study_doc):
    segment_document(study_doc.id, db)
    db.commit()
    segs = segment_crud.list_segments_for_document(db, study_doc.id)
    target = segs[0]
    assert _match_segment(segs, target.content) == target
    assert _match_segment(segs, "完全无关的内容") is None
