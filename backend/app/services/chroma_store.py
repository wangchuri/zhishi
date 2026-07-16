"""
Chroma 持久化向量存储 — collection: zhishi_segments
"""
import logging
import threading
from typing import List, Optional

from app.core.config import CHROMA_PERSIST_DIR
from app.services.embedding_service import EMBEDDING_DIM, embed_texts

logger = logging.getLogger(__name__)

COLLECTION_NAME = "zhishi_segments"


def _seg_field(seg, name, default=None):
    if isinstance(seg, dict):
        return seg.get(name, default)
    return getattr(seg, name, default)


class ChromaStore:
  def __init__(self):
    self._lock = threading.Lock()
    self._client = None
    self._collection = None

  def _collection_metadata(self) -> dict:
    return {"hnsw:space": "cosine", "dimension": EMBEDDING_DIM}

  def _collection_dimension_mismatch(self, coll) -> bool:
    meta = coll.metadata or {}
    declared = meta.get("dimension")
    if declared is not None and int(declared) != EMBEDDING_DIM:
      return True
    if coll.count() == 0:
      return False
    try:
      sample = coll.get(limit=1, include=["embeddings"])
      embs = sample.get("embeddings") or []
      if len(embs) > 0 and embs[0] is not None:
        return len(embs[0]) != EMBEDDING_DIM
    except Exception as e:
      logger.warning("Chroma dimension probe failed: %s", e)
    return False

  def _ensure_collection(self):
    if self._collection is not None:
      return self._collection
    with self._lock:
      if self._collection is not None:
        return self._collection
      import chromadb

      self._client = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
      metadata = self._collection_metadata()
      try:
        existing = self._client.get_collection(COLLECTION_NAME)
        if self._collection_dimension_mismatch(existing):
          logger.warning(
            "Chroma collection dimension mismatch (expected %d), recreating %s",
            EMBEDDING_DIM,
            COLLECTION_NAME,
          )
          self._client.delete_collection(COLLECTION_NAME)
          existing = None
      except Exception:
        existing = None

      if existing is None:
        self._collection = self._client.create_collection(
          name=COLLECTION_NAME,
          metadata=metadata,
        )
      else:
        self._collection = existing

      logger.info(
        "Chroma collection ready: %s @ %s (dim=%d)",
        COLLECTION_NAME,
        CHROMA_PERSIST_DIR,
        EMBEDDING_DIM,
      )
      return self._collection

  def upsert_segments(
    self,
    *,
    document_id: str,
    segments: List[object],
    user_id: int,
    collection_id: str,
    display_name: str,
  ) -> int:
    """写入或更新文档分段向量。segments 需含 id/content/title/char_start/char_end。"""
    if not segments:
      return 0

    coll = self._ensure_collection()
    texts = [_seg_field(s, "content", "") for s in segments]
    embeddings = embed_texts(texts)

    ids: List[str] = []
    metadatas: List[dict] = []
    documents: List[str] = []

    for seg, text, emb in zip(segments, texts, embeddings):
      seg_id = _seg_field(seg, "id")
      ids.append(str(seg_id))
      documents.append(text)
      title = _seg_field(seg, "title") or ""
      metadatas.append(
        {
          "user_id": int(user_id),
          "collection_id": str(collection_id),
          "document_id": str(document_id),
          "segment_id": str(seg_id),
          "char_start": int(_seg_field(seg, "char_start", 0)),
          "char_end": int(_seg_field(seg, "char_end", 0)),
          "title": str(title),
          "display_name": str(display_name),
        }
      )

    coll.upsert(
      ids=ids,
      embeddings=embeddings,
      documents=documents,
      metadatas=metadatas,
    )
    logger.info("Chroma upsert: document_id=%s segments=%d", document_id, len(ids))
    return len(ids)

  def delete_by_document(self, document_id: str) -> int:
    coll = self._ensure_collection()
    try:
      coll.delete(where={"document_id": document_id})
      logger.info("Chroma delete: document_id=%s", document_id)
      return 1
    except Exception as e:
      logger.warning("Chroma delete failed document_id=%s: %s", document_id, e)
      return 0

  def search(
    self,
    query: str,
    *,
    user_id: int,
    collection_id: Optional[str] = None,
    top_k: int = 5,
  ) -> List[dict]:
    coll = self._ensure_collection()
    query_emb = embed_texts([query])[0]

    where: Optional[dict] = {"user_id": int(user_id)}
    if collection_id:
      where = {
        "$and": [
          {"user_id": int(user_id)},
          {"collection_id": str(collection_id)},
        ]
      }

    try:
      result = coll.query(
        query_embeddings=[query_emb],
        n_results=top_k,
        where=where,
        include=["documents", "metadatas", "distances"],
      )
    except Exception as e:
      logger.warning("Chroma query failed, retry without filter: %s", e)
      result = coll.query(
        query_embeddings=[query_emb],
        n_results=top_k,
        include=["documents", "metadatas", "distances"],
      )

    hits: List[dict] = []
    ids = (result.get("ids") or [[]])[0]
    docs = (result.get("documents") or [[]])[0]
    metas = (result.get("metadatas") or [[]])[0]
    dists = (result.get("distances") or [[]])[0]

    for seg_id, content, meta, dist in zip(ids, docs, metas, dists):
      meta = meta or {}
      if int(meta.get("user_id", -1)) != int(user_id):
        continue
      if collection_id and meta.get("collection_id") != collection_id:
        continue
      # cosine distance -> similarity
      score = max(0.0, 1.0 - float(dist)) if dist is not None else 0.0
      hits.append(
        {
          "score": score,
          "content": content or "",
          "document_id": meta.get("document_id"),
          "segment_id": meta.get("segment_id") or seg_id,
          "collection_id": meta.get("collection_id"),
          "title": meta.get("title") or None,
          "display_name": meta.get("display_name"),
          "char_start": meta.get("char_start"),
          "char_end": meta.get("char_end"),
        }
      )

    hits.sort(key=lambda h: h["score"], reverse=True)
    return hits[:top_k]


  def search_by_document(
    self,
    query: str,
    document_id: str,
    top_k: int = 5,
  ) -> List[dict]:
    """语义检索指定文档内的内容片段（通过 document_id metadata 过滤）。"""
    coll = self._ensure_collection()
    query_emb = embed_texts([query])[0]

    where: Optional[dict] = {"document_id": str(document_id)}

    try:
      result = coll.query(
        query_embeddings=[query_emb],
        n_results=top_k,
        where=where,
        include=["documents", "metadatas", "distances"],
      )
    except Exception as e:
      logger.warning("Chroma search_by_document failed: %s", e)
      return []

    hits: List[dict] = []
    docs = (result.get("documents") or [[]])[0]
    metas = (result.get("metadatas") or [[]])[0]
    dists = (result.get("distances") or [[]])[0]

    for content, meta, dist in zip(docs, metas, dists):
      meta = meta or {}
      score = max(0.0, 1.0 - float(dist)) if dist is not None else 0.0
      hits.append({
        "score": score,
        "content": content or "",
        "title": meta.get("title") or None,
        "segment_id": meta.get("segment_id"),
        "char_start": meta.get("char_start"),
        "char_end": meta.get("char_end"),
      })

    hits.sort(key=lambda h: h["score"], reverse=True)
    return hits[:top_k]


chroma_store = ChromaStore()
