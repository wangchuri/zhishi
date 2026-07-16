"""
知拾 Agent — 封装 Tina Agent + 本地/Dify 检索，提供流式对话
"""
import logging
from typing import AsyncGenerator, List, Optional, TYPE_CHECKING

from app.core.config import is_local_rag
from app.utils.tina_loader import tina_env_path
from tina import Agent
from tina.llm import BaseAPI

from app.services.citation_service import build_citations_from_hits
from app.tools.rag_tools import RAGTools

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是知拾（Zhishi）的知识管理助手 Tina。你帮助用户管理知识、解答问题。

## 核心能力
- 基于用户知识库中的文档内容回答问题
- 需要检索知识库时请调用 `zhishi_search_knowledge_base` 工具
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
        1. 持有 RAGTools（本地 Chroma 或 DifyKB）
        2. 持有 Tina Agent 实例（共享 LLM）
        3. 对话时自动检索知识库，注入上下文后流式输出
    """

    def __init__(self, user_id: int, dataset_id: str = ""):
        self.user_id = user_id
        self.dataset_id = dataset_id or ""

        self.rag = RAGTools(user_id=user_id, dataset_id=dataset_id)

        try:
            self.llm = BaseAPI(env_path=tina_env_path())

            self.agent = Agent(
                llm=self.llm,
                tools=[self.rag.get_tools()],
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

    @property
    def is_ready(self) -> bool:
        """Agent 是否可用"""
        return self.agent is not None

    async def predict_stream(
        self,
        message: str,
        collection_id: Optional[str] = None,
        db: Optional["Session"] = None,
    ) -> AsyncGenerator[dict, None]:
        """
        流式对话（异步生成器）

        流程：
            1. 恢复历史上下文
            2. 检索知识片段（可按 collection_id 过滤）
            3. 构建增强后的 instruction
            4. Tina Agent 流式预测
            5. 末包附带 citations
        """
        self.rag.set_filter(collection_id, db)

        if not self.agent:
            yield {"role": "assistant", "content": "抱歉，AI 服务暂时不可用，请稍后重试。"}
            return

        enhanced_message = message
        retrieval_hits: List[dict] = []

        knowledge_context = ""
        try:
            retrieval_hits = self.rag._retrieve(message, top_k=3)
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
            async for chunk in self.agent.apredict(instruction=enhanced_message):
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

        self.rag.reset_filter()