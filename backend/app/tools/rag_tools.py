"""
RAG 检索工具 — 知识库搜索（Chroma / Dify）
"""
import json
import logging
from typing import List, Optional, TYPE_CHECKING

from tina.agent.core.tools import Tools

from app.core.config import is_local_rag
from app.services.local_retrieval_service import search as local_search

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

if not is_local_rag():
    from app.services.dify_kb import DifyKB

logger = logging.getLogger(__name__)


class RAGTools:
    """知识库检索工具包，支持本地 Chroma 和 Dify 两种后端。"""

    tools: Tools

    def __init__(self, user_id: int, dataset_id: str = ""):
        self.user_id = user_id
        self.dataset_id = dataset_id or ""
        self._active_collection_id: Optional[str] = None
        self._active_db: Optional["Session"] = None

        self.kb = None
        if not is_local_rag() and dataset_id:
            self.kb = DifyKB(dataset_id)

        self.tools = Tools(name="rag")
        self.tools.register_tool(tool=self.search_knowledge_base)

    def get_tools(self) -> Tools:
        """公开 Tools 实例供 Agent 使用。"""
        return self.tools

    def set_filter(self, collection_id: Optional[str], db: Optional["Session"] = None) -> None:
        """设置检索过滤条件（按 collection_id 限定范围）。"""
        self._active_collection_id = collection_id
        self._active_db = db

    def reset_filter(self) -> None:
        """清除检索过滤条件。"""
        self._active_collection_id = None
        self._active_db = None

    def _retrieve(self, query: str, top_k: int = 5) -> List[dict]:
        if is_local_rag():
            return local_search(
                query,
                user_id=self.user_id,
                collection_id=self._active_collection_id,
                top_k=top_k,
            )
        if not self.kb:
            return []
        results = self.kb.query(query, top_k=top_k)
        if self._active_db and self._active_collection_id is not None:
            from app.services.citation_service import filter_hits_by_collection
            results = filter_hits_by_collection(
                self._active_db,
                self.user_id,
                self._active_collection_id,
                results,
            )
        return results

    def search_knowledge_base(self, query: str) -> str:
        """
        搜索用户知识库中的相关内容。
        返回匹配的文档片段和相似度分数。

        Args:
            query (str): 检索查询文本
        """
        results = self._retrieve(query, top_k=5)
        if not results:
            return "未找到相关内容"
        lines = []
        for i, r in enumerate(results, 1):
            lines.append(f"[{i}] (相关度: {r['score']:.2f})\n{r['content']}")
        return "\n\n".join(lines)

    def search_document_content(self, query: str, top_k: int = 5) -> str:
        """
        在指定文档中检索与 query 语义相似的内容片段。
        仅限本文档范围。

        Args:
            query (str): 检索关键词或自然语言问题
            top_k (int): 返回相关片段的数量，默认 5，最大 10
        Returns:
            JSON 字符串，每项包含 content（内容）、title（段落标题）、score（相关度）
        """
        from app.services.chroma_store import chroma_store

        if not self._active_collection_id:
            return json.dumps({"error": "未指定文档，无法检索"})
        try:
            results = chroma_store.search_by_document(
                query=query,
                document_id=self._active_collection_id,
                top_k=min(top_k, 10),
            )
            return json.dumps(results, ensure_ascii=False)
        except Exception as e:
            logger.warning("search_document_content 失败: %s", e)
            return json.dumps({"error": str(e)})