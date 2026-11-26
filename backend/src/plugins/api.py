"""插件注册接口：内置插件在 ``register(api)`` 里拿到的句柄。

一个领域插件（比如「英语」）往往要同时做几件事，所以 API 覆盖四个面：

- ``api.route(path, handler)``   → 挂到 ``/api/v1/plugins/<plugin_id>/<path>``
- ``api.tool(fn)``               → 给 Tina 的工具（工具名 ``<plugin_id>_<fn_name>``）
- ``api.on(event, fn)``          → 钩子（见 ``plugins/hooks.py``）
- ``api.prompt_section(text)``   → 往系统提示词末尾追加领域说明

插件**不碰前端代码**：要出界面就往实体的 ``extensions`` 槽里塞数据，
前端用内置的通用渲染器画（audio / words / dict / iframe …）。
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

from tina.agent.core.tools import Tools

from . import hooks

logger = logging.getLogger(__name__)


class PluginAPI:
    """单个插件的注册句柄。"""

    def __init__(self, plugin_id: str) -> None:
        self.plugin_id = plugin_id
        self.routes: list[tuple[str, Callable, tuple[str, ...]]] = []
        self.tools = Tools(name=plugin_id)
        self.prompt_parts: list[str] = []
        self._tool_count = 0

    # ---- API 路由 ----

    def route(self, path: str, handler: Callable, methods: tuple[str, ...] = ("GET",)) -> None:
        """注册一个接口，最终路径是 ``/api/v1/plugins/<plugin_id><path>``。"""
        if not path.startswith("/"):
            path = "/" + path
        self.routes.append((path, handler, tuple(methods)))

    # ---- Agent 工具 ----

    def tool(self, fn: Optional[Callable] = None):
        """注册工具。可以当装饰器用：``@api.tool``。"""

        def _add(func: Callable):
            self.tools.register_tool(tool=func)
            self._tool_count += 1
            return func

        if fn is None:
            return _add
        return _add(fn)

    # ---- 钩子 ----

    def on(self, event: str, fn: Optional[Callable] = None, priority: int = 100):
        """注册钩子。可以当装饰器用：``@api.on("question.presented")``。"""

        def _add(func: Callable):
            hooks.register(event, self.plugin_id, func, priority=priority)
            return func

        if fn is None:
            return _add
        return _add(fn)

    # ---- 提示词 ----

    def prompt_section(self, text: str) -> None:
        """往系统提示词末尾追加一段领域说明。"""
        text = (text or "").strip()
        if text:
            self.prompt_parts.append(text)

    # ---- 汇总 ----

    def prompt_block(self) -> str:
        if not self.prompt_parts:
            return ""
        body = "\n".join(self.prompt_parts)
        return f"## 插件能力（{self.plugin_id}）\n{body}\n"

    def summary(self) -> dict:
        return {
            "plugin_id": self.plugin_id,
            "routes": [path for path, _h, _m in self.routes],
            "tools": self.tools.tools_names,
            "hooks": hooks.describe(),
            "prompt": bool(self.prompt_parts),
        }
