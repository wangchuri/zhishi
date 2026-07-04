"""
知拾 Agent — 封装 Tina Agent + 本地/Dify 检索，提供流式对话
"""
import logging
from typing import Generator, List, Optional, TYPE_CHECKING

from app.core.config import is_local_rag
from app.utils.tina_loader import tina_env_path
from tina import Agent
from tina.agent.core.context_manager import ContextManager
from tina.agent.core.tools import Tools
from tina.llm import BaseAPI

from app.services.citation_service import build_citations_from_hits
from app.services.local_retrieval_service import search as local_search
from app.services.llm_runner import iter_agent_predict_stream

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

if not is_local_rag():
    from app.services.citation_service import filter_hits_by_collection
    from app.services.dify_kb import DifyKB

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是知拾（Zhishi）的知识管理助手 Tina。你帮助用户管理知识、解答问题。

## 核心能力
- 基于用户知识库中的文档内容回答问题
- 如果知识库中有相关内容，优先基于知识库回答，并引用来源
- 如果知识库中没有相关内容，基于你自身的知识诚实回答
- 帮助用户整理笔记、生成学习路径、解释复杂概念

## 回答风格
- 清晰、有条理，适当使用 Markdown 格式
- 对于复杂问题，先给出概述再展开细节
- 如果引用了知识库内容，可以标明"根据你的知识库..."
- 使用中文回答，专业术语保留英文原文
"""


class ZhishiAgent:
    """
    知拾智能体 — 每个用户一个实例

    职责：
        1. 持有检索后端（本地 Chroma 或 DifyKB）
        2. 持有 Tina Agent 实例（共享 LLM）
        3. 对话时自动检索知识库，注入上下文后流式输出
    """

    def __init__(self, user_id: int, dataset_id: str = ""):
        self.user_id = user_id
        self.dataset_id = dataset_id or ""
        self._active_collection_id: Optional[str] = None
        self._active_db: Optional["Session"] = None

        self.kb = None
        if not is_local_rag() and dataset_id:
            self.kb = DifyKB(dataset_id)

        try:
            context_manager = ContextManager(max_length=100000, max_tool_result_length=6000)
            context_manager.set_system_message(SYSTEM_PROMPT)

            self.llm = BaseAPI(env_path=tina_env_path())

            self.tools = Tools(name="zhishi")
            self.tools.register_tool(self.search_knowledge_base)
            self._db_for_tools: Optional["Session"] = None
            self._register_training_tools_on_init()

            self.agent = Agent(
                llm=self.llm,
                tools=self.tools,
                system_prompt=SYSTEM_PROMPT,
                max_context_length=100000,
                max_tool_result_length=6000,
                name=f"zhishi_agent_{user_id}",
            )
            logger.info(
                "ZhishiAgent 初始化成功: user_id=%s, rag=%s",
                user_id,
                "local" if is_local_rag() else f"dify:{dataset_id}",
            )
        except Exception as e:
            logger.error(f"ZhishiAgent 初始化失败: user_id={user_id}, error={e}")
            self.agent = None
            self.llm = None
            self.tools = None

    def _register_training_tools_on_init(self) -> None:
        """注册训练工具骨架（需 db 会话时在 predict 前 bind_db）。"""
        if not self.tools:
            return
        from app.services.training_tools import register_training_tools

        if self._db_for_tools:
            register_training_tools(self.tools, self._db_for_tools, self.user_id)

    def bind_db(self, db: "Session") -> None:
        """绑定数据库会话以启用 search_questions_by_tags 等训练工具。"""
        self._db_for_tools = db
        if self.tools:
            from app.services.training_tools import register_training_tools

            register_training_tools(self.tools, db, self.user_id)

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
            results = filter_hits_by_collection(
                self._active_db,
                self.user_id,
                self._active_collection_id,
                results,
            )
        return results

    def search_knowledge_base(self, query: str) -> str:
        """
        搜索用户知识库中的相关内容
        返回匹配的文档片段和相似度分数

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

    @property
    def is_ready(self) -> bool:
        """Agent 是否可用"""
        return self.agent is not None

    def predict_stream(
        self,
        message: str,
        history: Optional[List[dict]] = None,
        collection_id: Optional[str] = None,
        db: Optional["Session"] = None,
    ) -> Generator[dict, None, None]:
        """
        流式对话

        流程：
            1. 恢复历史上下文
            2. 检索知识片段（可按 collection_id 过滤）
            3. 构建增强后的 instruction
            4. Tina Agent 流式预测
            5. 末包附带 citations

        Args:
            message: 用户消息
            history: 历史消息列表 [{role, content}, ...]
            collection_id: 知识库分区 ID，限定检索与 citation 范围
            db: 数据库会话，用于 citation 映射

        Yields:
            dict: {"role": "assistant", "content": "...", ...}
        """
        self._active_collection_id = collection_id
        self._active_db = db

        if not self.agent:
            yield {"role": "assistant", "content": "抱歉，AI 服务暂时不可用，请稍后重试。"}
            return

        enhanced_message = message
        retrieval_hits: List[dict] = []

        knowledge_context = ""
        try:
            retrieval_hits = self._retrieve(message, top_k=3)
            if retrieval_hits:
                fragments = []
                for i, r in enumerate(retrieval_hits, 1):
                    fragments.append(
                        f"[片段{i}] (相关度: {r['score']:.2f})\n{r['content']}"
                    )
                knowledge_context = "\n\n".join(fragments)
        except Exception as e:
            logger.warning(f"ZhishiAgent 知识库检索失败: {e}")

        if knowledge_context:
            enhanced_message = (
                f"请基于以下知识库内容回答用户问题。\n\n"
                f"## 知识库相关内容\n{knowledge_context}\n\n"
                f"## 用户问题\n{message}"
            )

        try:
            for chunk in iter_agent_predict_stream(
                self.agent,
                enhanced_message,
                history=history,
                system_prompt=SYSTEM_PROMPT,
            ):
                result = {
                    "role": chunk.get("role", "assistant"),
                    "content": chunk.get("content", ""),
                }
                reasoning = chunk.get("reasoning_content")
                if reasoning:
                    result["reasoning_content"] = reasoning
                tool_name = chunk.get("tool_name")
                if tool_name:
                    result["tool_name"] = tool_name
                yield result
        except Exception as e:
            logger.error(f"ZhishiAgent.predict_stream 错误: {e}")
            yield {"role": "assistant", "content": f"抱歉，生成回复时出错了：{str(e)}"}

        if db and retrieval_hits:
            try:
                citations = build_citations_from_hits(
                    db, self.user_id, collection_id, retrieval_hits
                )
                if citations:
                    yield {
                        "role": "assistant",
                        "content": "",
                        "citations": [c.model_dump() for c in citations],
                    }
            except Exception as e:
                logger.warning(f"ZhishiAgent 构建 citations 失败: {e}")

        self._active_collection_id = None
        self._active_db = None
