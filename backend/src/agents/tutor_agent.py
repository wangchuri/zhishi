"""苏格拉底辅导 Agent：基于题目 + 文档上下文，引导式讲解。

- 独立 Agent，每会话一个（工具隔离）
- apredict() 异步流式
- 注入：题目题干/正确答案/对应分段内容
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from ..core.llm import create_agent, format_agent_error, visible_assistant_delta
from ..core.prompts import load_prompt, render_prompt
from ..models import DocumentSegment, GlobalQuestion, QuestionProvenance, TutorSession

logger = logging.getLogger(__name__)


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
    prompt = render_prompt(
        "tutor/socratic_prompt.md.j2",
        socratic_rules=load_prompt("tutor/socratic_rules.md.j2"),
        question_block=question_block,
        user_part="",
        correct_answer=question.answer or "",
        segment_title=segment.title if segment and getattr(segment, "title", None) else "相关原文",
        segment_text=segment_context,
    )
    return create_agent(system_prompt=prompt)


async def send_message(agent, content: str) -> tuple[str, Optional[str]]:
    """发送消息，流式消费全部 chunk，返回 (内容, reasoning_content)。"""
    full = ""
    reasoning = ""
    try:
        async for chunk in agent.apredict(content):
            c, r = visible_assistant_delta(chunk)
            if c:
                full += c
            if r:
                reasoning += r
    except Exception as e:
        logger.exception("tutor 消息失败")
        full = full or f"（辅导出错了：{format_agent_error(e)}）"
    return full, reasoning or None
