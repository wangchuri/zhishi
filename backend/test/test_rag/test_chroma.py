"""本地 Chroma RAG 测试 — mock embedding，不下载模型。"""
from unittest.mock import patch

import pytest
import chromadb

from app.services.chroma_store import ChromaStore


def _mock_embed(texts):
    return [[float((i + j) % 7) / 7.0 for j in range(8)] for i, _ in enumerate(texts)]


@pytest.fixture()
def store():
    s = ChromaStore()
    client = chromadb.EphemeralClient()
    coll = client.get_or_create_collection(
        name="zhishi_segments_test",
        metadata={"hnsw:space": "cosine"},
    )
    s._client = client
    s._collection = coll
    return s


def test_upsert_and_search(store):
    with patch("app.services.chroma_store.embed_texts", side_effect=_mock_embed):
        segments = [
            {
                "id": "seg-1",
                "content": "微积分是研究变化率的数学分支",
                "title": "微积分",
                "char_start": 0,
                "char_end": 20,
            },
            {
                "id": "seg-2",
                "content": "牛顿和莱布尼茨独立发明微积分",
                "title": "历史",
                "char_start": 20,
                "char_end": 40,
            },
        ]
        n = store.upsert_segments(
            document_id="doc-1",
            segments=segments,
            user_id=1,
            collection_id="coll-1",
            display_name="calc.md",
        )
        assert n == 2

        hits = store.search(
            "什么是微积分", user_id=1, collection_id="coll-1", top_k=2
        )
        assert len(hits) >= 1
        assert hits[0]["document_id"] == "doc-1"
        assert hits[0]["segment_id"]
        assert "微积分" in hits[0]["content"]


def test_upsert_empty_returns_zero(store):
    with patch("app.services.chroma_store.embed_texts", side_effect=_mock_embed):
        n = store.upsert_segments(
            document_id="doc-0",
            segments=[],
            user_id=1,
            collection_id="coll-1",
            display_name="x.md",
        )
        assert n == 0


def test_search_filters_by_collection(store):
    with patch("app.services.chroma_store.embed_texts", side_effect=_mock_embed):
        store.upsert_segments(
            document_id="doc-a",
            segments=[{"id": "s1", "content": "alpha", "title": "t", "char_start": 0, "char_end": 5}],
            user_id=1,
            collection_id="coll-a",
            display_name="a.md",
        )
        store.upsert_segments(
            document_id="doc-b",
            segments=[{"id": "s2", "content": "alpha", "title": "t", "char_start": 0, "char_end": 5}],
            user_id=1,
            collection_id="coll-b",
            display_name="b.md",
        )
        hits = store.search("alpha", user_id=1, collection_id="coll-a", top_k=5)
        assert all(h["collection_id"] == "coll-a" for h in hits)


def test_delete_by_document(store):
    with patch("app.services.chroma_store.embed_texts", side_effect=_mock_embed):
        store.upsert_segments(
            document_id="doc-1",
            segments=[{"id": "seg-1", "content": "微积分是研究变化率", "title": "t", "char_start": 0, "char_end": 10}],
            user_id=1,
            collection_id="coll-1",
            display_name="calc.md",
        )
        store.delete_by_document("doc-1")
        hits = store.search("微积分", user_id=1, collection_id="coll-1", top_k=2)
        assert len(hits) == 0


def test_search_by_document(store):
    with patch("app.services.chroma_store.embed_texts", side_effect=_mock_embed):
        store.upsert_segments(
            document_id="doc-1",
            segments=[{"id": "seg-1", "content": "导数与微分", "title": "t", "char_start": 0, "char_end": 10}],
            user_id=1,
            collection_id="coll-1",
            display_name="calc.md",
        )
        hits = store.search_by_document("导数", "doc-1", top_k=2)
        assert len(hits) == 1
        assert hits[0]["segment_id"] == "seg-1"
