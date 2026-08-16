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


def create_agent(
    tools: Tools | list[Tools] | None = None,
    system_prompt: str | None = None,
    *,
    model: str | None = None,
) -> Agent:
    """创建 tina Agent（默认后端模型配置）。"""
    llm = create_llm(model=model)
    return Agent(llm=llm, tools=tools, system_prompt=system_prompt)
