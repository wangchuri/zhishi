"""任务 Agent：候选人派发 + 按章节/标签检索后布置刷题/学习验收。"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from ..core.llm import create_agent, visible_assistant_delta
from ..core.prompts import render_prompt
from ..core.database import SessionLocal
from ..services.task import collect_task_candidates, task_agent_context
from ..tools.task_tools import TaskAssignTools

logger = logging.getLogger(__name__)


async def run_task_agent(*, is_refill: bool = False) -> int:
    db = SessionLocal()
    try:
        candidates = collect_task_candidates(db)
        ctx = task_agent_context(db, is_refill=is_refill)
    finally:
        db.close()

    if not candidates:
        return 0

    tools = TaskAssignTools(candidates)
    prompt = render_prompt(
        "chat/task_agent.md.j2",
        candidates=candidates,
        **ctx,
    )
    agent = create_agent(tools=tools.get_tools(), system_prompt=prompt, max_tool_loop=16)
    if is_refill:
        user = (
            "用户已经做完今天目前所有任务。根据已完成任务和学情决定要不要再派一轮。"
            "原则：清晰、具体、对用户有帮助。不要为凑数而派。今天已经够了就一条都不要派。"
            "可用 assign_task（候选人）或 list_book_chapters / search_book_questions + assign_quiz_task / assign_learn_task。"
            "刷题务必带具体 question_ids；学习验收用章节 id。"
        )
    else:
        user = (
            "根据目标和学情设计今天的任务。条数、每条做多少都由你决定。"
            "可用 assign_task（候选人）或检索后 assign_quiz_task / assign_learn_task。"
            "刷题优先 search_book_questions 再布置，确保任务里有题目 id 列表。"
            "可以一条都不派。"
        )
    try:
        async for chunk in agent.apredict(user):
            visible_assistant_delta(chunk)
    except Exception:
        logger.warning("任务 Agent 推理失败", exc_info=True)
    return len(tools.assigned)


def run_task_agent_sync(*, is_refill: bool = False) -> int:
    """可在已有事件循环里调用（对话工具），也可在普通请求里调用。"""

    def _inner() -> int:
        return asyncio.run(run_task_agent(is_refill=is_refill))

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return _inner()

    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(_inner).result(timeout=90)
