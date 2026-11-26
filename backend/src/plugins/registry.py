"""插件注册表：内置领域插件 + 外部 MCP server。

两条来源
--------
1. **内置插件**（``plugins/builtin/<id>/``）：Python 包，能注册 API 路由、Agent 工具、
   钩子、提示词补充。这是主推形态——知拾的有价值扩展（发音、词典、判题器、
   复习算法、出题模板）都得读自己的数据库，MCP 接不进来。
2. **MCP server**（``config.yml`` 的 ``plugins.mcp_servers``）：逃生口，默认空。
   tina 自带客户端，零成本，想接 Notion / Obsidian / 某个学校服务时加一行配置就行。

开关在 ``config.yml``::

    plugins:
      builtin:
        english: true
      mcp_servers: []

加载是**惰性 + 后台预热**的：启动时 ``warmup_async()`` 在后台线程跑一遍，
第一次对话就不用等连接。任何插件出错都只记日志，不影响主流程。
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Optional

from tina.agent.core.tools import Tools

from ..core.config import config
from . import hooks
from .api import PluginAPI
from .builtin import iter_builtin

logger = logging.getLogger(__name__)

# 连不上的 MCP server 会阻塞启动流程，超时给短一点
_DEFAULT_TIMEOUT = 15


def _mcp_server_configs() -> list[dict]:
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


def _builtin_enabled(plugin_id: str, meta: dict) -> bool:
    """配置里显式写的开关优先，否则用插件自己声明的默认值。"""
    raw = config.plugins.get("builtin")
    if isinstance(raw, dict) and plugin_id in raw:
        return bool(raw[plugin_id])
    return bool(meta.get("default_enabled", False))


class PluginRegistry:
    """进程级单例。"""

    def __init__(self) -> None:
        # 内置插件
        self._apis: dict[str, PluginAPI] = {}
        self._builtin_tools: list[Tools] = []
        self._builtin_errors: list[dict] = []
        self._builtin_loaded = False
        # MCP
        self._client: Optional[Any] = None
        self._mcp_tools: Optional[Tools] = None
        self._mcp_errors: list[dict] = []
        self._mcp_loaded = False

        self._lock = threading.Lock()

    # ---- 加载 ----

    def _ensure_builtin(self) -> None:
        """内置插件是纯 Python 注册，很快，可以同步做（挂路由需要）。"""
        if self._builtin_loaded:
            return
        with self._lock:
            if self._builtin_loaded:
                return
            try:
                self._load_builtin()
            except Exception:
                logger.warning("内置插件加载失败", exc_info=True)
                self._builtin_errors.append({"plugin_id": "*", "error": "加载异常"})
            finally:
                self._builtin_loaded = True

    def _ensure_mcp(self) -> None:
        """MCP 要起子进程/建连接，可能慢，只在后台预热或首次用到时加载。"""
        if self._mcp_loaded:
            return
        with self._lock:
            if self._mcp_loaded:
                return
            try:
                self._load_mcp()
            except Exception:
                logger.warning("MCP 插件加载失败", exc_info=True)
                self._mcp_errors.append({"server_id": "*", "error": "加载异常"})
            finally:
                self._mcp_loaded = True

    def _ensure_loaded(self) -> None:
        self._ensure_builtin()
        self._ensure_mcp()

    def _load_builtin(self) -> None:
        for plugin_id, meta, register in iter_builtin():
            if not _builtin_enabled(plugin_id, meta):
                logger.info("内置插件 %s 已禁用", plugin_id)
                continue
            # 幂等：先清掉这个插件可能残留的钩子（reload / 重复加载时不会叠加）
            hooks.unregister_plugin(plugin_id)
            api = PluginAPI(plugin_id)
            try:
                register(api)
            except Exception as exc:
                logger.warning("内置插件 %s 注册失败", plugin_id, exc_info=True)
                self._builtin_errors.append({"plugin_id": plugin_id, "error": str(exc)})
                hooks.unregister_plugin(plugin_id)
                continue
            self._apis[plugin_id] = api
            if api.tools.tools:
                self._builtin_tools.append(api.tools)
            logger.info(
                "内置插件已加载：%s（%d 个工具、%d 个接口）",
                plugin_id,
                len(api.tools.tools),
                len(api.routes),
            )

    def _load_mcp(self) -> None:
        servers = [s for s in _mcp_server_configs() if s.get("enabled", True) is not False]
        if not servers:
            return
        try:
            from tina.mcp.client import MCPClient
        except ImportError:
            self._mcp_errors.append(
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
            except Exception as exc:
                logger.warning("MCP server %s 启动失败：%s", server_id, exc)
                self._mcp_errors.append({"server_id": server_id, "error": str(exc)})
                continue
            if ok:
                connected += 1
            else:
                self._mcp_errors.append(
                    {"server_id": server_id, "error": f"连接失败（{transport}）"}
                )

        self._client = client
        if connected:
            try:
                self._mcp_tools = client.to_tina_tools()
                logger.info(
                    "MCP 插件已加载：%d 个 server，%d 个工具",
                    connected,
                    len(self._mcp_tools.tools),
                )
            except Exception as exc:
                logger.warning("MCP 工具转换失败：%s", exc)
                self._mcp_errors.append({"server_id": "*", "error": str(exc)})
                self._mcp_tools = None

    def warmup_async(self) -> None:
        """启动时后台预热，避免第一次对话卡在连接上。"""

        def _run() -> None:
            try:
                self._ensure_loaded()
            except Exception:  # pragma: no cover
                logger.warning("插件预热失败", exc_info=True)

        threading.Thread(target=_run, name="plugin-warmup", daemon=True).start()

    # ---- 供 Agent / 主流程使用 ----

    def tools(self) -> Optional[list[Tools]]:
        """插件工具包列表；没有任何插件工具时返回 None。"""
        self._ensure_loaded()
        out: list[Tools] = list(self._builtin_tools)
        if self._mcp_tools is not None and self._mcp_tools.tools:
            out.append(self._mcp_tools)
        return out or None

    def mcp_client(self) -> Optional[Any]:
        """执行 MCP 工具必须用同一个 client 实例（按工具名反查 server）。"""
        self._ensure_loaded()
        return self._client if self._mcp_tools is not None else None

    def mount_routes(self, app) -> None:
        """把内置插件注册的接口挂到 FastAPI app 上。

        必须在 app 创建后、开始服务前调用（见 ``main.py``）。
        插件接口走 ``/api/v1/plugins/<plugin_id><path>``。

        这里只加载内置插件（纯 Python，毫秒级）——MCP 要起子进程/建连接，
        交给 ``warmup_async()`` 在后台做，不能拖慢启动。
        """
        self._ensure_builtin()
        from fastapi import APIRouter

        for plugin_id, api in self._apis.items():
            if not api.routes:
                continue
            router = APIRouter(prefix=f"/api/v1/plugins/{plugin_id}", tags=[f"plugin:{plugin_id}"])
            for path, handler, methods in api.routes:
                router.add_api_route(path, handler, methods=list(methods))
            app.include_router(router)
            logger.info("插件 %s 已挂载 %d 个接口", plugin_id, len(api.routes))

    def prompt_section(self) -> str:
        """给系统提示词用的插件段落；没有插件时返回空串。"""
        self._ensure_loaded()
        parts: list[str] = []
        for api in self._apis.values():
            block = api.prompt_block()
            if block:
                parts.append(block)

        if self._mcp_tools is not None and self._mcp_tools.tools:
            lines = []
            for tool in self._mcp_tools.tools:
                desc = (tool.description or "").replace("\n", " ").strip()
                lines.append(f"- `{tool.name}`：{desc}")
            parts.append(
                "## 插件工具（外部 MCP，用户自己装的）\n"
                "这些是用户通过插件接进来的外部能力。需要用到对应数据时才调，"
                "拿不到就直说，不要编造结果。\n" + "\n".join(lines) + "\n"
            )

        return "\n".join(parts)

    # ---- 状态（设置页 / 排查用）----

    def status(self) -> dict:
        """插件状态（设置页用）。

        只同步加载内置插件（毫秒级）；MCP 由启动时的 warmup_async 在后台连，
        这里只报当前已连上的，不为了看一眼状态去等 15 秒超时。
        """
        self._ensure_builtin()
        from .builtin import BUILTIN_PLUGINS, iter_builtin

        all_meta = {pid: meta for pid, meta, _fn in iter_builtin()}
        builtin = []
        for plugin_id in BUILTIN_PLUGINS:
            meta = all_meta.get(plugin_id) or {}
            api = self._apis.get(plugin_id)
            builtin.append(
                {
                    "plugin_id": plugin_id,
                    "name": meta.get("name") or plugin_id,
                    "description": meta.get("description") or "",
                    "enabled": api is not None,
                    "routes": [path for path, _h, _m in api.routes] if api else [],
                    "tools": api.tools.tools_names if api else [],
                    "prompt": bool(api.prompt_parts) if api else False,
                }
            )

        mcp_servers: dict[str, list[str]] = {}
        if self._mcp_tools is not None:
            for tool in self._mcp_tools.tools:
                parts = tool.name.split("_", 2)
                sid = parts[1] if len(parts) >= 3 and parts[0] == "mcp" else "*"
                mcp_servers.setdefault(sid, []).append(tool.name)
        return {
            "builtin": builtin,
            "mcp": {
                "configured": bool(_mcp_server_configs()),
                "connected": self._mcp_tools is not None,
                "servers": [
                    {"server_id": sid, "tools": names}
                    for sid, names in mcp_servers.items()
                ],
            },
            "hooks": hooks.describe(),
            "errors": [*self._builtin_errors, *self._mcp_errors],
        }

    def reload(self) -> None:
        """改完配置后重建（会断开 MCP 会话、清掉钩子）。

        管理员主动操作，所以这里**同步**加载（含 MCP），让调用方拿到最新状态。
        """
        with self._lock:
            if self._client is not None:
                try:
                    self._client.close()
                except Exception:  # pragma: no cover
                    pass
            for plugin_id in self._apis:
                hooks.unregister_plugin(plugin_id)
            self._apis = {}
            self._builtin_tools = []
            self._builtin_errors = []
            self._builtin_loaded = False
            self._client = None
            self._mcp_tools = None
            self._mcp_errors = []
            self._mcp_loaded = False
        self._ensure_loaded()


plugin_registry = PluginRegistry()
