"""插件系统。

当前只支持 MCP server（在 ``config.yml`` 的 ``plugins.mcp_servers`` 里声明），
详见 :mod:`src.plugins.registry`。
"""

from .registry import plugin_registry

__all__ = ["plugin_registry"]
