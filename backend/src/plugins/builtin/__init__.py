"""内置插件（领域包）。

每个插件是 ``builtin/<id>/`` 下一个 Python 包，必须提供：

- ``PLUGIN``：元数据字典（id / name / description / default_enabled）
- ``register(api)``：用 ``plugins.api.PluginAPI`` 注册路由、工具、钩子、提示词

``config.yml`` 里用 ``plugins.builtin.<id>: true/false`` 开关。
不在清单里的插件不会被导入，所以写坏一个插件不会影响后端启动。
"""

from __future__ import annotations

import importlib
import logging
from typing import Iterator

logger = logging.getLogger(__name__)

# 内置插件清单。新增插件时在这里登记，并按需在 config.yml.example 里加开关示例。
BUILTIN_PLUGINS: tuple[str, ...] = ("english",)


def iter_builtin() -> Iterator[tuple[str, dict, object]]:
    """逐个产出 (plugin_id, PLUGIN 元数据, register 函数)。

    导入失败只记日志——插件写错不该拖垮后端。
    """
    for plugin_id in BUILTIN_PLUGINS:
        try:
            module = importlib.import_module(f"{__name__}.{plugin_id}")
        except Exception:
            logger.warning("内置插件 %s 导入失败，已跳过", plugin_id, exc_info=True)
            continue
        meta = getattr(module, "PLUGIN", None)
        register = getattr(module, "register", None)
        if not isinstance(meta, dict) or not callable(register):
            logger.warning("内置插件 %s 缺少 PLUGIN 元数据或 register()", plugin_id)
            continue
        yield plugin_id, meta, register
