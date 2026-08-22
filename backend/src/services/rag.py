"""本地 RAG：Chroma 向量化 + 检索。

ChromaStore 持有 chroma client 与 embedding 模型，检索方法直接注册为
tina 工具（tools 属性），供 Agent 使用——领域对象的工具是其天然成员。
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

from tina import Tools

from ..core.config import config

logger = logging.getLogger(__name__)

_COLLECTION_PREFIX = "doc_"


class ChromaStore:
    """本地向量库：索引 / 检索，并暴露检索工具给 Agent。"""

    def __init__(self) -> None:
        self._client = None
        self._embedding_fn = None
        self._lock = threading.Lock()
        self.tools = Tools(name="chroma")
        self._register_tools()

    # ---- 基础设施 ----

    def _get_client(self):
        if self._client is None:
            import chromadb

            persist_dir = str((config.storage_dir / "chroma").resolve())
            self._client = chromadb.PersistentClient(path=persist_dir)
        return self._client

    def _reset_client(self) -> None:
        self._client = None

    def _get_embedding_fn(self):
        if self._embedding_fn is None:
            import os
            import time as _time
            from pathlib import Path
            from sentence_transformers import SentenceTransformer

            model_id = "BAAI/bge-small-zh-v1.5"
            cache_dir = Path.home() / ".cache" / "huggingface" / "hub" / "models--BAAI--bge-small-zh-v1.5"
            snapshot = None
            snaps = cache_dir / "snapshots"
            if snaps.is_dir():
                for d in snaps.iterdir():
                    if (d / "model.safetensors").exists() or (d / "pytorch_model.bin").exists():
                        snapshot = d
                        break
            t0 = _time.time()
            # 直接读本地 snapshot，并强制离线，否则仍会 HEAD huggingface.co
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            load_path = str(snapshot) if snapshot is not None else model_id
            try:
                model = SentenceTransformer(load_path, local_files_only=True)
                source = "local_snapshot" if snapshot is not None else "local_id"
            except Exception as e:
                os.environ.pop("HF_HUB_OFFLINE", None)
                os.environ.pop("TRANSFORMERS_OFFLINE", None)
                logger.warning("本地嵌入模型不可用，尝试联网下载 %s: %s", model_id, e)
                model = SentenceTransformer(model_id)
                source = "download"
            elapsed_ms = int((_time.time() - t0) * 1000)
            logger.info("嵌入模型就绪 source=%s elapsed_ms=%s path=%s", source, elapsed_ms, load_path)
            self._embedding_fn = lambda texts: model.encode(
                [t if isinstance(t, str) else str(t) for t in texts]
            ).tolist()
        return self._embedding_fn

    def _collection_name(self, doc_id: str) -> str:
        return f"{_COLLECTION_PREFIX}{doc_id}"

    # ---- 索引 ----

    def index_document(self, doc_id: str, text: str) -> int:
        """向量化文档（分段写入 chroma）。返回 chunk 数。"""
        chunks = _chunk_text(text)
        if not chunks:
            return 0
        with self._lock:
            client = self._get_client()
            try:
                client.delete_collection(self._collection_name(doc_id))
            except Exception:
                pass

            collection = client.get_or_create_collection(
                self._collection_name(doc_id),
                embedding_function=None,  # 手动提供 embedding
            )
            ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
            collection.add(
                ids=ids,
                documents=chunks,
                embeddings=self._get_embedding_fn()(chunks),
            )
            return len(chunks)

    def delete_document_index(self, doc_id: str) -> None:
        with self._lock:
            try:
                self._get_client().delete_collection(self._collection_name(doc_id))
            except Exception:
                pass

    # ---- 检索（供代码直接调用） ----

    def search_document(
        self,
        doc_id: str,
        query: str,
        top_k: int = 5,
        max_chars: int = 800,
    ) -> list[dict]:
        """检索单文档，返回 [{text, distance}]。"""
        with self._lock:
            return self._search_document_unlocked(doc_id, query, top_k, max_chars)

    def _search_document_unlocked(
        self,
        doc_id: str,
        query: str,
        top_k: int,
        max_chars: int,
    ) -> list[dict]:
        client = self._get_client()
        try:
            collection = client.get_collection(self._collection_name(doc_id))
        except Exception:
            return []

        q_vec = self._get_embedding_fn()([query])
        result = collection.query(query_embeddings=q_vec, n_results=top_k)
        texts = result.get("documents", [[]])[0] or []
        distances = result.get("distances", [[]])[0] or []
        return [
            {"text": _truncate(t, max_chars), "distance": d}
            for t, d in zip(texts, distances)
        ]

    def search_documents(
        self,
        query: str,
        top_k: int = 5,
        document_ids: list[str] | None = None,
        max_chars: int = 500,
    ) -> list[dict]:
        """
        跨指定文档检索，返回 [{document_id, text, distance}]。
        Args:
            query:检索的字符串
            top_k:返回最大结果数
            document_ids:文档id，为 None 时检索全部文档；否则只检索指定文档。
        """
        with self._lock:
            try:
                return self._search_documents_unlocked(query, top_k, document_ids, max_chars)
            except Exception as e:
                logger.warning("chroma 检索失败，重置客户端后重试: %s", e)
                self._reset_client()
                return self._search_documents_unlocked(query, top_k, document_ids, max_chars)

    def _search_documents_unlocked(
        self,
        query: str,
        top_k: int,
        document_ids: list[str] | None,
        max_chars: int,
    ) -> list[dict]:
        client = self._get_client()
        q_vec = self._get_embedding_fn()([query])

        if document_ids is not None:
            collections = [(self._collection_name(did), did) for did in document_ids]
        else:
            collections = []
            for col in client.list_collections():
                name = col.name if hasattr(col, "name") else str(col)
                if not name.startswith(_COLLECTION_PREFIX):
                    continue
                collections.append((name, name[len(_COLLECTION_PREFIX):]))

        results: list[dict] = []
        for col_name, doc_id in collections:
            try:
                r = client.get_collection(col_name).query(query_embeddings=q_vec, n_results=top_k)
                texts = r.get("documents", [[]])[0] or []
                dists = r.get("distances", [[]])[0] or []
                for t, d in zip(texts, dists):
                    results.append({
                        "document_id": doc_id,
                        "text": _truncate(t, max_chars),
                        "distance": d,
                    })
            except Exception:
                continue

        results.sort(key=lambda x: x["distance"])
        return results[:top_k]

    # ---- 工具注册 ----

    def _register_tools(self) -> None:
        self.tools.register_tool(tool=self.search_documents)

    def get_tools(self) -> Tools:
        return self.tools


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


def _truncate(text: str, max_chars: int) -> str:
    if len(text) > max_chars:
        return text[:max_chars] + "…"
    return text


def _format_results(results: list[dict], label: str) -> str:
    if not results:
        return "未找到相关内容"
    lines = []
    for i, r in enumerate(results, 1):
        lines.append(f"[{i}] {label}片段（相关度 {r['distance']:.2f}）\n{r['text']}")
    return "\n\n".join(lines)


# 模块级单例：全局共用同一个 chroma client + 工具集
chroma_store = ChromaStore()
