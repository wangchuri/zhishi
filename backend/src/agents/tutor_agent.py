"""苏格拉底辅导 Agent：基于题目 + 文档上下文，引导式讲解。

- 独立 Agent，每会话一个（工具隔离）
- apredict() 异步流式
- 注入：题目题干/正确答案/对应分段内容
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from ..core.llm import create_agent
from ..models import DocumentSegment, GlobalQuestion, QuestionProvenance, TutorSession

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是知拾的苏格拉底式辅导老师。你的目标是引导学生自己得出答案，而不是直接给出答案。

## 规则
1. 不要直接说出正确答案，用提问和引导让学生思考
2. 结合题目对应的教材分段内容讲解相关概念
3. 当学生明显卡住时，给出适当提示
4. 用中文交流，循序渐进
5. 如果学生多次尝试仍然错误，可以逐步给出解题思路

## 当前辅导的题目
{question_block}

## 相关知识（教材原文片段）
{segment_context}
"""


def _build_context(question: GlobalQuestion, prov: Optional[QuestionProvenance], segment: Optional[DocumentSegment]) -> tuple[str, str]:
    """构造 question_block 和 segment_context。"""
    options_str = ""
    if question.options:
        try:
            opts = json.loads(question.options)
            options_str = "\n".join(f"{o['key']}. {o['text']}" for o in opts)
        except Exception:
            options_str = question.options

    question_block = f"""题干：{question.stem}
题型：{question.question_type}
选项：
{options_str}
标准答案：{question.answer}"""

    segment_context = segment.content[:2000] if segment and segment.content else "（无相关原文）"
    return question_block, segment_context


def build_tutor_agent(
    question: GlobalQuestion,
    prov: Optional[QuestionProvenance],
    segment: Optional[DocumentSegment],
):
    """创建 tutor Agent（注入题目上下文）。"""
    question_block, segment_context = _build_context(question, prov, segment)
    prompt = SYSTEM_PROMPT.format(
        question_block=question_block,
        segment_context=segment_context,
    )
    return create_agent(system_prompt=prompt)


async def send_message(agent, content: str) -> tuple[str, Optional[str]]:
    """发送消息，流式消费全部 chunk，返回 (内容, reasoning_content)。"""
    full = ""
    reasoning = ""
    try:
        async for chunk in agent.apredict(content):
            c = chunk.get("content", "")
            r = chunk.get("reasoning_content", "")
            if c:
                full += c
            if r:
                reasoning += r
    except Exception as e:
        logger.warning("tutor 消息失败: %s", e)
        full = full or f"（辅导出错了：{e}）"
    return full, reasoning or None
