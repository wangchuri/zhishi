"""LLM 统一封装（tina 异步流式）。

所有需要 LLM 推理的场景都走这里的 apredict 流式接口：
- Agent 对话 / 伴学 / 辅导 / 报告 / 训练 / 学习路径
- 统一读取 backend/tina.env 的模型配置

约定：
- 一律使用流式接口 apredict()，不使用非流式
- 后台任务同样托管流式（消费全部 chunk），不向前端转发
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path
from typing import AsyncGenerator, Optional

from tina.agent import Agent, MultimodalAgent, Tools
from tina.llm import BaseAPI, BaseMultimodalAPI, FilesAPI

try:
    from tina import KeywordActions
except ImportError:  # pragma: no cover
    KeywordActions = None  # type: ignore

logger = logging.getLogger(__name__)

# 模型上下文窗口（token）。压缩触发按模型 API 返回的真实 prompt_tokens 算，
# 窗口大小按实际模型配 ZHISHI_MODEL_CONTEXT_TOKENS（默认 1M）。
MODEL_CONTEXT_TOKENS = max(
    8_000, int(os.environ.get("ZHISHI_MODEL_CONTEXT_TOKENS") or 1_000_000)
)

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


def format_agent_error(exc: BaseException) -> str:
    """拼给用户看的错误。TimeoutError 等 str(e) 为空，必须带上类型名。"""
    name = type(exc).__name__
    detail = str(exc).strip()
    return f"{name}: {detail}" if detail else name


def create_llm(
    model: str | None = None,
    env_path: str | None = None,
    *,
    multimodal: bool = False,
) -> BaseAPI:
    """创建 tina LLM 客户端，默认读取 backend/tina.env。

    multimodal=True 时返回 BaseMultimodalAPI（支持图片 / file_id 内容块）。
    """
    if env_path is None:
        from .paths import tina_env_path

        env = str(tina_env_path())
    else:
        env = env_path
    cls = BaseMultimodalAPI if multimodal else BaseAPI
    return cls(
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


def is_tool_related_chunk(chunk) -> bool:
    """是否为工具调用相关 chunk（用于前端颜文字 ? 眼）。"""
    if isinstance(chunk, dict):
        role = chunk.get("role") or ""
        return bool(
            role == "tool"
            or chunk.get("tool_name")
            or chunk.get("tool_arguments")
            or chunk.get("tool_calls")
            or chunk.get("tool_call_id")
        )
    role = getattr(chunk, "role", None) or ""
    return bool(
        role == "tool"
        or getattr(chunk, "tool_name", None)
        or getattr(chunk, "tool_arguments", None)
        or getattr(chunk, "tool_calls", None)
        or getattr(chunk, "tool_call_id", None)
    )


def _attach_usage_recorder(agent: Agent) -> None:
    """记下每次请求模型 API 返回的 usage（含 prompt_tokens）。

    上下文占用以模型自己报的 token 数为准，不靠字符数估算。
    """

    def _on_usage(usage) -> None:
        try:
            prompt = getattr(usage, "prompt_tokens", None)
            if prompt is None and isinstance(usage, dict):
                prompt = usage.get("prompt_tokens")
            total = getattr(usage, "total_tokens", None)
            if total is None and isinstance(usage, dict):
                total = usage.get("total_tokens")
            setattr(
                agent,
                "_zhishi_last_usage",
                {
                    "prompt_tokens": int(prompt or 0),
                    "total_tokens": int(total or 0),
                },
            )
        except Exception:
            logger.debug("记录 usage 失败", exc_info=True)

    try:
        agent.events.add_on_usage_handler(_on_usage)
    except Exception:
        logger.warning("注册 usage 事件失败，上下文占用将无法统计")


def last_prompt_tokens(agent: Agent) -> int:
    """最近一次请求实际占用的 prompt token 数（拿不到时返回 0）。"""
    usage = getattr(agent, "_zhishi_last_usage", None) or {}
    try:
        return int(usage.get("prompt_tokens") or 0)
    except Exception:
        return 0


def create_agent(
    tools: Tools | list[Tools] | None = None,
    system_prompt: str | None = None,
    *,
    model: str | None = None,
    max_tool_loop: int | None = None,
    keyword_actions: "KeywordActions | None" = None,
    multimodal: bool = False,
    mcp_client=None,
) -> Agent:
    """创建 tina Agent（默认后端模型配置）。

    multimodal=True 时返回 MultimodalAgent，apredict 支持 image= / file_id=。

    **上下文裁剪归应用层**：tina 0.7.4 起移除了 `max_context_length`，框架不再
    按字符硬截断（它猜不准应用的度量口径）。知拾只靠一层机制，**不做兜底裁剪**：

    services/memory.py 每轮把模型 API 返回的真实 prompt_tokens 记到
    ChatSession.last_prompt_tokens，下一轮开始前检查，到窗口 70% 就后台压缩进
    长期记忆（memory_cursor 前移、回放时跳过已压缩部分）。

    为什么不做「超阈值裁历史」的兜底：
    - 1M 窗口 × 70% = 700k token，正常对话到不了；真到了说明是单轮暴涨，
      而那时超窗口的是当前这轮本身，裁历史救不了；
    - 裁剪会和后台压缩线程抢 messages，memory_cursor 会错位。

    真要防的是「压缩失败后每轮重试」和「换小窗口模型时压缩来不及」，
    前者该退避、后者该把压缩改成同步——都不是裁历史能解决的。

    mcp_client 是插件用的 MCPClient。插件工具名形如 mcp_<server>_<tool>，
    执行时由 tina 的 MCPToolExecutor 按名字反查 server，所以这里必须传
    **和注册插件工具时同一个** client 实例（见 src/plugins/registry.py）。
    """
    llm = create_llm(model=model, multimodal=multimodal)
    kwargs: dict = {}
    if max_tool_loop is not None:
        kwargs["max_tool_loop"] = max_tool_loop
    if keyword_actions is not None:
        kwargs["keyword_actions"] = keyword_actions
    if mcp_client is not None:
        kwargs["mcp"] = mcp_client
    agent_cls = MultimodalAgent if multimodal else Agent
    # context_manager 交给 tina 自建：Agent → ContextManager，
    # MultimodalAgent → MultimodalContextManager(tools=self.tools)
    agent = agent_cls(llm=llm, tools=tools, system_prompt=system_prompt, **kwargs)
    _attach_usage_recorder(agent)
    return agent


# ---- 图片上传（Files API）与多模态调用 ----

_files_api: FilesAPI | None = None
_files_api_lock = threading.Lock()


def get_files_api() -> FilesAPI:
    """服务端 Files API 客户端（上传图片换 file_id），惰性单例。"""
    global _files_api
    if _files_api is None:
        with _files_api_lock:
            if _files_api is None:
                from .config import config

                _files_api = FilesAPI.from_llm(
                    create_llm(),
                    cache_path=str(config.storage_dir / "files_cache.json"),
                )
    return _files_api


def upload_images(paths: list[str]) -> list[str]:
    """把本地图片上传到服务端换取 file_id；单张失败跳过，不抛异常。"""
    ids: list[str] = []
    if not paths:
        return ids
    try:
        files = get_files_api()
    except Exception:
        logger.warning("Files API 初始化失败，图片将走 base64 兜底", exc_info=True)
        return ids
    for path in paths:
        try:
            file_id = files.upload_cached(path)
        except Exception:
            logger.warning("图片上传失败：%s", path, exc_info=True)
            continue
        if file_id:
            ids.append(file_id)
    return ids


def predict_stream(
    agent: Agent,
    content: str,
    *,
    file_ids: Optional[list[str]] = None,
    image_paths: Optional[list[str]] = None,
    multimodal: bool = False,
) -> AsyncGenerator:
    """统一入口：多模态 Agent 优先用 file_id，退化到本地图片 base64，最后纯文本。"""
    if multimodal:
        if file_ids:
            return agent.apredict(content, file_id=file_ids)
        if image_paths:
            return agent.apredict(content, image=image_paths)
    return agent.apredict(content)


async def prepare_images(attachments: Optional[list[str]]) -> tuple[list[str], list[str]]:
    """上传 id 列表 → (本地图片路径, 服务端 file_id)。一次上传，两处可用。"""
    if not attachments:
        return [], []
    from .storage import upload_paths

    paths = upload_paths(attachments)
    if not paths:
        return [], []
    file_ids = await asyncio.to_thread(upload_images, paths)
    return paths, file_ids
