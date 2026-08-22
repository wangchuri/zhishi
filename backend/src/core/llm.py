"""LLM 统一封装（tina 异步流式）。

所有需要 LLM 推理的场景都走这里的 apredict 流式接口：
- Agent 对话 / 伴学 / 辅导 / 报告 / 训练 / 学习路径
- 统一读取 backend/tina.env 的模型配置

约定：
- 一律使用流式接口 apredict()，不使用非流式
- 后台任务同样托管流式（消费全部 chunk），不向前端转发
"""

from __future__ import annotations

import os
from pathlib import Path

from tina.agent import Agent, Tools
from tina.llm import BaseAPI

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


def create_llm(
    model: str | None = None,
    env_path: str | None = None,
) -> BaseAPI:
    """创建 tina LLM 客户端，默认读取 backend/tina.env。"""
    env = env_path or str(_BACKEND_DIR / "tina.env")
    return BaseAPI(
        model=model,
        env_path=env if os.path.isfile(env) else None,
    )


def visible_assistant_delta(chunk) -> tuple[str, str]:
    """从 Tina 流式 chunk 取出给用户看的 (正文, 思考)。

    工具名/参数碎片、tool_calls、以及检索结果（role=tool 的 content）一律丢掉。
    """
    if isinstance(chunk, dict):
        role = chunk.get("role") or ""
        content = chunk.get("content") or ""
        reasoning = chunk.get("reasoning_content") or ""
        tool_name = chunk.get("tool_name")
        tool_arguments = chunk.get("tool_arguments")
        tool_calls = chunk.get("tool_calls")
        tool_call_id = chunk.get("tool_call_id")
    else:
        role = getattr(chunk, "role", None) or ""
        content = getattr(chunk, "content", None) or ""
        reasoning = getattr(chunk, "reasoning_content", None) or ""
        tool_name = getattr(chunk, "tool_name", None)
        tool_arguments = getattr(chunk, "tool_arguments", None)
        tool_calls = getattr(chunk, "tool_calls", None)
        tool_call_id = getattr(chunk, "tool_call_id", None)

    if (
        role == "tool"
        or tool_name
        or tool_arguments
        or tool_calls
        or tool_call_id
    ):
        return "", ""
    return str(content), str(reasoning)


def _last_tool_calls_assistant(messages: list[dict]) -> dict | None:
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        role = msg.get("role")
        if role == "assistant" and msg.get("tool_calls"):
            return msg
        if role in ("user", "system"):
            break
    return None


def _tool_turn_key(tool_calls: list) -> str:
    ids = []
    for call in tool_calls or []:
        ids.append(str(call.get("id") or call.get("tool_call_id") or ""))
    return "|".join(ids)


def _merge_split_assistant(messages: list[dict], target: dict) -> None:
    """Tina 会把同一轮拆成 content 一条 + tool_calls 一条，合回 DeepSeek 要的一条。"""
    try:
        idx = messages.index(target)
    except ValueError:
        return
    if idx == 0:
        return
    prev = messages[idx - 1]
    if prev.get("role") != "assistant" or prev.get("tool_calls"):
        return
    if prev.get("content") and not target.get("content"):
        target["content"] = prev["content"]
    if prev.get("reasoning_content") and not target.get("reasoning_content"):
        target["reasoning_content"] = prev["reasoning_content"]
    messages.pop(idx - 1)


def _chunk_reasoning(chunk) -> str:
    if isinstance(chunk, dict):
        return str(chunk.get("reasoning_content") or "")
    return str(getattr(chunk, "reasoning_content", None) or "")


def _attach_reasoning_roundtrip(agent: Agent) -> None:
    """DeepSeek 思考模式 + tools：工具回合必须回传 reasoning_content。

    Tina 会丢掉思考，并把同一轮拆成 content 一条 + tool_calls 一条。
    用 on_stream_chunk 记下思考，在 before_tool_calls（json.loads 之前）写回。
    工具参数解析失败时 after_tool_call 不会触发，所以不能只靠 after_tool_call。
    """
    parts: list[str] = []
    patched: set[str] = set()

    def _on_stream_chunk(chunk) -> None:
        text = _chunk_reasoning(chunk)
        if text:
            parts.append(text)

    def _patch_last_tool_turn() -> None:
        messages = agent.context_manager.get_messages()
        target = _last_tool_calls_assistant(messages)
        if target is None:
            return
        key = _tool_turn_key(target.get("tool_calls") or [])
        if key in patched:
            return
        patched.add(key)
        reasoning = "".join(parts)
        parts.clear()
        if reasoning and not target.get("reasoning_content"):
            target["reasoning_content"] = reasoning
        _merge_split_assistant(messages, target)

    def _before_tool_calls(tool_calls) -> None:
        _patch_last_tool_turn()

    def _after_tool_call(tool_name: str, tool_arguments: dict, tool_result):
        _patch_last_tool_turn()
        return tool_name, tool_arguments, tool_result

    agent.add_on_stream_chunk_handler(_on_stream_chunk)
    agent.add_before_tool_calls_handler(_before_tool_calls)
    agent.add_after_tool_call_handler(_after_tool_call)


def create_agent(
    tools: Tools | list[Tools] | None = None,
    system_prompt: str | None = None,
    *,
    model: str | None = None,
    max_tool_loop: int | None = None,
    max_context_length: int = 500_000,
) -> Agent:
    """创建 tina Agent（默认后端模型配置）。"""
    llm = create_llm(model=model)
    kwargs: dict = {"max_context_length": max_context_length}
    if max_tool_loop is not None:
        kwargs["max_tool_loop"] = max_tool_loop
    agent = Agent(llm=llm, tools=tools, system_prompt=system_prompt, **kwargs)
    _attach_reasoning_roundtrip(agent)
    return agent
