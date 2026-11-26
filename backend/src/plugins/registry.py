"""插件注册表：把外部 MCP server 变成 Tina 能调用的工具包。

设计取舍
--------
- **插件 = 一个具名的 tina ``Tools`` 子包**。tina 的 ``Tools`` 支持 ``+=`` 挂载子包
  并自动做重名检查，所以插件天然就是一个独立的 ``Tools(name="mcp")``。
- **第一版只支持 MCP**（tina 内置客户端，stdio / sse / http 三种传输）。
  进程内 Python 插件能直接读数据库、能力更大，但也意味着任意代码执行，
  等真有需求再开。
- **单用户自托管**：插件由管理员在 ``config.yml`` 里声明，跑在自己机器上，
  不做租户隔离、不做沙箱。风险模型等同于自己 ``pip install``。
- **工具名形如 ``mcp_<server_id>_<tool>``**，执行时由 tina 的 ``MCPToolExecutor``
  按名字反查 server，所以 Agent 必须拿到**同一个** ``MCPClient`` 实例
  （见 ``core/llm.py`` 的 ``create_agent(mcp_client=...)``）。
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Optional

from tina.agent.core.tools import Tools

from ..core.config import config

logger = logging.getLogger(__name__)

# 连不上的 server 会阻塞启动流程，超时给短一点
_DEFAULT_TIMEOUT = 15


def _server_configs() -> list[dict]:
    """读 ``config.yml`` 的 ``plugins.mcp_servers``，容忍各种残缺写法。"""
    raw = config.plugins
    servers = raw.get("mcp_servers")
    if not isinstance(servers, list):
        return []
    out: list[dict] = []
    for item in servers:
        if isinstance(item, dict) and str(item.get("id") or "").strip():
            out.append(item)
    return out


class PluginRegistry:
    """进程级单例：管理 MCP 连接和插件工具包。"""

    def __init__(self) -> None:
        self._client: Optional[Any] = None  # MCPClient
        self._tools: Optional[Tools] = None
        self._errors: list[dict] = []
        self._loaded = False
        self._lock = threading.Lock()

    # ---- 加载 ----

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            try:
                self._load()
            except Exception:
                logger.warning("插件加载失败", exc_info=True)
                self._errors.append({"server_id": "*", "error": "插件加载异常，详见后端日志"})
            finally:
                self._loaded = True

    def _load(self) -> None:
        servers = [s for s in _server_configs() if s.get("enabled", True) is not False]
        if not servers:
            return

        try:
            from tina.mcp.client import MCPClient
        except ImportError:
            self._errors.append(
                {"server_id": "*", "error": "未安装 mcp 依赖，请 pip install mcp"}
            )
            return

        client = MCPClient()
        connected = 0
        for item in servers:
            server_id = str(item.get("id") or "").strip()
            transport = str(item.get("type") or "stdio").strip().lower()
            try:
                ok = client.add_server(
                    server_id,
                    type=transport,
                    command=item.get("command"),
                    args=item.get("args"),
                    env=item.get("env"),
                    url=item.get("url"),
                    headers=item.get("headers"),
                    max_retries=int(item.get("max_retries") or 1),
                    timeout=int(item.get("timeout") or _DEFAULT_TIMEOUT),
                )
            except Exception as exc:  # 配置写错 / 命令不存在
                logger.warning("MCP server %s 启动失败：%s", server_id, exc)
                self._errors.append({"server_id": server_id, "error": str(exc)})
                continue
            if ok:
                connected += 1
            else:
                self._errors.append(
                    {"server_id": server_id, "error": f"连接失败（{transport}）"}
                )

        self._client = client
        if connected:
            try:
                self._tools = client.to_tina_tools()
                logger.info(
                    "插件已加载：%d 个 MCP server，%d 个工具",
                    connected,
                    len(self._tools.tools),
                )
            except Exception as exc:
                logger.warning("MCP 工具转换失败：%s", exc)
                self._errors.append({"server_id": "*", "error": str(exc)})
                self._tools = None

    def warmup_async(self) -> None:
        """启动时后台预热，避免第一次对话卡在连接上。"""

        def _run() -> None:
            try:
                self._ensure_loaded()
            except Exception:  # pragma: no cover
                logger.warning("插件预热失败", exc_info=True)

        threading.Thread(target=_run, name="plugin-warmup", daemon=True).start()

    # ---- 供 Agent 使用 ----

    def tools(self) -> Optional[Tools]:
        """插件工具包；没有可用插件时返回 None。"""
        self._ensure_loaded()
        return self._tools

    def mcp_client(self) -> Optional[Any]:
        """执行 MCP 工具必须用同一个 client 实例（按工具名反查 server）。"""
        self._ensure_loaded()
        return self._client if self._tools is not None else None

    def prompt_section(self) -> str:
        """给系统提示词用的「插件工具」段落；没有插件时返回空串。"""
        tools = self.tools()
        if not tools or not tools.tools:
            return ""
        lines: list[str] = []
        for tool in tools.tools:
            desc = (tool.description or "").replace("\n", " ").strip()
            lines.append(f"- `{tool.name}`：{desc}")
        if not lines:
            return ""
        return (
            "## 插件工具（外部 MCP，用户自己装的）\n"
            "这些是用户通过插件接进来的外部能力。需要用到对应数据时才调，"
            "拿不到就直说，不要编造结果。\n" + "\n".join(lines) + "\n"
        )

    # ---- 状态（设置页 / 排查用）----

    def status(self) -> dict:
        self._ensure_loaded()
        tools = self._tools.tools if self._tools else []
        by_server: dict[str, list[str]] = {}
        for tool in tools:
            # 名字是 mcp_<server_id>_<tool>，server_id 里可能有下划线，按前缀宽松归组
            parts = tool.name.split("_", 2)
            sid = parts[1] if len(parts) >= 3 and parts[0] == "mcp" else "*"
            by_server.setdefault(sid, []).append(tool.name)
        return {
            "enabled": bool(_server_configs()),
            "connected": self._tools is not None,
            "servers": [
                {"server_id": sid, "tools": names} for sid, names in by_server.items()
            ],
            "errors": list(self._errors),
        }

    def reload(self) -> None:
        """改完配置后重建连接（会断开现有 MCP 会话）。"""
        with self._lock:
            if self._client is not None:
                try:
                    self._client.close()
                except Exception:  # pragma: no cover
                    pass
            self._client = None
            self._tools = None
            self._errors = []
            self._loaded = False


plugin_registry = PluginRegistry()
