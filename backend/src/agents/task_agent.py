"""任务 Agent：程序给出候选人（kind/checker/页码题号），条数和数量由模型自己定。"""

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
            "只调用 assign_task；candidate_id 必须来自列表；quantity 不能超过该候选人资料里实际有的量。"
        )
    else:
        user = (
            "根据目标和学情设计今天的任务。条数、每条做多少都由你决定。"
            "只调用 assign_task；candidate_id 必须来自列表；quantity 不能超过该候选人资料里实际有的量。"
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
