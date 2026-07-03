"""
Tina LLM / Agent 异步封装 — 在后台线程或同步路径中统一调用 apredict。
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, Generator, List, Optional

from app.core.config import LLM_ASYNC
from app.core.job_runner import run_async_coro

logger = logging.getLogger(__name__)


def _chunk_to_dict(chunk: Any) -> dict:
    if isinstance(chunk, dict):
        return chunk
    if hasattr(chunk, "model_dump"):
        try:
            return chunk.model_dump()
        except Exception:
            pass
    role = getattr(chunk, "role", None) or "assistant"
    content = getattr(chunk, "content", None)
    if content is None and hasattr(chunk, "get"):
        content = chunk.get("content", "")
    result = {"role": role, "content": content or ""}
    for key in ("reasoning_content", "tool_name", "tool_calls"):
        val = getattr(chunk, key, None)
        if val is None and isinstance(chunk, dict):
            val = chunk.get(key)
        if val:
            result[key] = val
    return result


def llm_predict_no_stream(llm, **kwargs) -> dict:
    """非流式 LLM 调用；LLM_ASYNC 时走 apredict_no_stream。"""
    if LLM_ASYNC:
        return run_async_coro(llm.apredict_no_stream(**kwargs))
    kwargs.setdefault("stream", False)
    return llm.predict(**kwargs)


def agent_predict_no_stream(agent, instruction: str, **kwargs) -> Any:
    if LLM_ASYNC:
        return run_async_coro(
            agent.apredict_no_stream(instruction=instruction, **kwargs)
        )
    return agent.predict(instruction=instruction, stream=False, **kwargs)


def iter_agent_predict_stream(
    agent,
    instruction: str,
    *,
    history: Optional[List[dict]] = None,
    system_prompt: Optional[str] = None,
    **kwargs,
) -> Generator[dict, None, None]:
    """同步生成器包装 Agent 流式输出（SSE 路由可直接 yield）。"""
    try:
        agent.clear_messages()
        if system_prompt and getattr(agent, "context_manager", None):
            agent.context_manager.set_system_message(system_prompt)
        if history:
            for msg in history:
                role = msg.get("role", "user")
                part = msg.get("content", "")
                if role in ("user", "assistant"):
                    agent.add_message(role=role, content=part)
    except Exception as e:
        logger.warning("恢复 Agent 上下文失败: %s", e)

    if not LLM_ASYNC:
        for chunk in agent.predict(instruction=instruction, stream=True, **kwargs):
            yield _chunk_to_dict(chunk)
        return

    async def _stream() -> AsyncIterator[dict]:
        async for chunk in agent.apredict(instruction=instruction, **kwargs):
            yield _chunk_to_dict(chunk)

    async def _collect() -> list[dict]:
        items: list[dict] = []
        async for item in _stream():
            items.append(item)
        return items

    # 流式 apredict 在独立 loop 中逐块产出
    loop = asyncio.new_event_loop()
    try:
        agen = _stream()
        while True:
            try:
                item = loop.run_until_complete(agen.__anext__())
                yield item
            except StopAsyncIteration:
                break
    finally:
        loop.close()
