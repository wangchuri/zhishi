"""本地 RAG：Chroma 向量化 + 检索 + citation。

- 每个文档一个 collection（doc_{document_id}）
- embedding 用 sentence-transformers 本地模型
- 检索返回带 citation 的段落
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Optional

import chromadb
from chromadb.config import Settings

from ..core.config import config

logger = logging.getLogger(__name__)

_COLLECTION_PREFIX = "doc_"

_client: Optional[chromadb.ClientAPI] = None
_embedding_fn = None


def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        persist_dir = str((config.storage_dir / "chroma").resolve())
        _client = chromadb.PersistentClient(path=persist_dir)
    return _client


def _get_embedding_fn():
    global _embedding_fn
    if _embedding_fn is None:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer("BAAI/bge-small-zh-v1.5")
        _embedding_fn = lambda texts: model.encode(
            [t if isinstance(t, str) else str(t) for t in texts]
        ).tolist()
    return _embedding_fn


def _collection_name(doc_id: str) -> str:
    return f"{_COLLECTION_PREFIX}{doc_id}"


def _chunk_text(text: str, size: int = 800, overlap: int = 120) -> list[str]:
    """定长切块 + 重叠。"""
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + size, n)
        chunks.append(text[start:end])
        if end == n:
            break
        start = max(end - overlap, start + 1)
    return chunks


def index_document(doc_id: str, text: str) -> int:
    """向量化文档（分段写入 chroma）。返回 chunk 数。"""
    client = _get_client()
    embedding_fn = _get_embedding_fn()
    chunks = _chunk_text(text)
    if not chunks:
        return 0

    try:
        client.delete_collection(_collection_name(doc_id))
    except Exception:
        pass

    collection = client.get_or_create_collection(
        _collection_name(doc_id),
        embedding_function=None,  # 手动提供 embedding
    )
    ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
    collection.add(ids=ids, documents=chunks, embeddings=embedding_fn(chunks))
    return len(chunks)


def delete_document_index(doc_id: str) -> None:
    try:
        _get_client().delete_collection(_collection_name(doc_id))
    except Exception:
        pass


def search_document(
    doc_id: str,
    query: str,
    top_k: int = 5,
) -> list[dict]:
    """检索单文档，返回 [{text, distance}]。"""
    client = _get_client()
    try:
        collection = client.get_collection(_collection_name(doc_id))
    except Exception:
        return []

    embedding_fn = _get_embedding_fn()
    q_vec = embedding_fn([query])
    result = collection.query(query_embeddings=q_vec, n_results=top_k)
    texts = result.get("documents", [[]])[0] or []
    distances = result.get("distances", [[]])[0] or []
    return [{"text": t, "distance": d} for t, d in zip(texts, distances)]


def search_all(query: str, top_k: int = 5) -> list[dict]:
    """跨全部文档检索，返回 [{document_id, text, distance}]。"""
    client = _get_client()
    embedding_fn = _get_embedding_fn()
    collections = client.list_collections()
    q_vec = embedding_fn([query])

    results: list[dict] = []
    for col in collections:
        name = col.name if hasattr(col, "name") else str(col)
        if not name.startswith(_COLLECTION_PREFIX):
            continue
        doc_id = name[len(_COLLECTION_PREFIX):]
        try:
            r = client.get_collection(name).query(query_embeddings=q_vec, n_results=top_k)
            texts = r.get("documents", [[]])[0] or []
            dists = r.get("distances", [[]])[0] or []
            for t, d in zip(texts, dists):
                results.append({"document_id": doc_id, "text": t, "distance": d})
        except Exception:
            continue

    results.sort(key=lambda x: x["distance"])
    return results[:top_k]
