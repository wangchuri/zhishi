"""
知拾 Agent — 封装 Tina Agent + 本地/Dify 检索，提供流式对话
"""
import logging
from typing import AsyncGenerator, List, Optional, TYPE_CHECKING

from app.core.config import is_local_rag
from app.services.prompt_service import load_prompt, render_prompt
from app.utils.tina_loader import tina_env_path
from tina import Agent
from tina.llm import BaseAPI

from app.services.citation_service import build_citations_from_hits
from app.tools.rag_tools import RAGTools

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = load_prompt("chat/zhishi_agent.md.j2")


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

    def set_system_prompt(self, prompt: str) -> None:
        """动态更新 Agent 的系统提示词（伴学等场景按上下文注入）。"""
        if self.agent is not None:
            self.agent.set_system_prompt(prompt)
            logger.debug("ZhishiAgent system_prompt updated: user_id=%s", self.user_id)

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
            enhanced_message = render_prompt(
                "chat/zhishi_rag_context.md.j2",
                variables={
                    "knowledge_context": knowledge_context,
                    "user_message": message,
                },
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