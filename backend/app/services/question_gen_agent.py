"""
出题 Agent — 批量提交题目 + Chroma 检索辅助

Agent 流程：
  1. Agent 接收选中页内容作为初始上下文
  2. Agent 通过 search_document_content 检索 Chroma 获取补充上下文
  3. Agent 逐页生成题目后，通过 submit_questions 批量提交
"""
from __future__ import annotations

import json
import logging
from typing import List

from app.utils.tina_loader import tina_env_path
from tina import Agent
from tina.llm import BaseAPI

from app.tools.rag_tools import RAGTools
from app.tools.question_gen_tools import QuestionGenTools

logger = logging.getLogger(__name__)

GENERATE_SYSTEM_PROMPT = """你是知拾（Zhishi）的智能出题助手，根据给定的教材页面内容生成练习题。

## 工作流程
1. 阅读选中页面的内容
2. 如果需要对某个知识点补充更多上下文，调用 search_document_content 检索本文档的段落
3. 按页面组织题目，完成后调用 submit_questions 批量提交全部题目
4. 全部提交完毕后回复「出题完成」

## 出题要求
- 覆盖该页面的核心知识点，难度适中
- 题型包括：single_choice（单选）、fill_blank（填空）、short_answer（简答）、application（应用题）
- 单选题需提供 4 个选项 A/B/C/D，answer 必须是 A/B/C/D 之一
- 填空题 stem 用 ___ 或 {{blank}} 表示空位，answer 为 JSON 数组如 ["答案1","答案2"]
- 简答题/应用题 options 可为空数组 []，answer 为标准答案要点
- 每道题附带 reference_text（题目所依据的原文关键片段，50-200字）
- tags 字段是知识点标签，用于归类，从已有的 tag 列表中选择或复用相同含义的名称，避免创建同义不同名的标签
  tags 示例：["微积分", "定积分", "牛顿-莱布尼茨公式"]、["Python", "列表推导式", "性能优化"]
  不要创建 "自动生成"、"第1页" 这类无意义的标签"""


class QuestionGenAgent:
    """出题 Agent — 带 Chroma 检索 + 批量提交"""

    def __init__(self, db, document_id: str, user_id: int, tag_hint: str = ""):
        self.db = db
        self.document_id = document_id
        self.user_id = user_id
        self.tag_hint = tag_hint
        self.agent = None

        self.qgen = QuestionGenTools()
        self.rag = RAGTools(user_id=user_id, dataset_id="")
        self.rag.set_filter(collection_id=document_id)

        try:
            self.llm = BaseAPI(env_path=tina_env_path())

            system = GENERATE_SYSTEM_PROMPT
            if tag_hint:
                system += f"\n\n用户已有 TAG 列表（优先复用）：{tag_hint}"

            self.agent = Agent(
                llm=self.llm,
                tools=[self.rag.get_tools(), self.qgen.get_tools()],
                system_prompt=system,
                max_context_length=60000,
                max_tool_result_length=4000,
                name="question_gen",
            )
        except Exception as e:
            logger.error("QuestionGenAgent 初始化失败: %s", e)

    @property
    def is_ready(self) -> bool:
        return self.agent is not None

    async def generate_from_pages(
        self,
        pages: List[dict],
        *,
        questions_per_page: int = 1,
    ) -> List[tuple[dict, dict]]:
        """
        对选中页批量出题。
        返回 [(page_dict, normalized_question_dict), ...]
        """
        if not self.agent:
            return []
        if not pages:
            return []

        # 构造初始上下文：全部选中页内容
        context_parts = []
        for p in pages:
            title = p.get("title") or f"第 {p.get('page_number', '?')} 页"
            content = (p.get("content") or "")[:3000]
            context_parts.append(f"## {title}\n\n{content}")
        all_content = "\n\n---\n\n".join(context_parts)

        page_numbers_str = ", ".join(str(p.get("page_number", "?")) for p in pages)
        total_pages = len(pages)
        total_expected = total_pages * questions_per_page

        instruction = (
            f"你正在为以下 {total_pages} 页内容出题（共需要约 {total_expected} 道题，每页 {questions_per_page} 道）。\n"
            f"选中页码：{page_numbers_str}\n\n"
            f"### 页面内容\n\n{all_content}\n\n"
            f"{self.tag_hint}\n\n"
            f"请按页面逐页出题，每页 {questions_per_page} 道。对每页内容梳理知识点后，批量调用 submit_questions 提交该页的全部题目。"
        )

        self.qgen.clear_submitted()
        try:
            await self.agent.apredict_no_stream(instruction=instruction)
        except Exception as e:
            logger.warning("QuestionGenAgent.generate_from_pages 失败: %s", e, exc_info=True)

        submitted = self.qgen.get_submitted_questions()
        if not submitted:
            return []

        # 将题目与页面关联
        result: List[tuple[dict, dict]] = []
        q_per_page = max(1, len(submitted) // len(pages))
        q_idx = 0
        for p in pages:
            for _ in range(q_per_page):
                if q_idx >= len(submitted):
                    break
                result.append((p, submitted[q_idx]))
                q_idx += 1
        while q_idx < len(submitted):
            result.append((pages[-1], submitted[q_idx]))
            q_idx += 1

        return result


async def agent_generate_from_pages(
    db,
    user_id: int,
    document_id: str,
    pages: List[dict],
    *,
    questions_per_page: int = 1,
    tag_hint: str = "",
) -> List[tuple[dict, dict]]:
    """Agent 路径：按选中页批量出题。"""
    agent = QuestionGenAgent(
        db=db,
        document_id=document_id,
        user_id=user_id,
        tag_hint=tag_hint,
    )
    if not agent.is_ready:
        return []
    return await agent.generate_from_pages(pages, questions_per_page=questions_per_page)