"""插件钩子总线。

知拾的插入点分两类（见 ``plugins/api.py``）：

- **provider**：替换某种能力（解析器、判题器、复习算法）。影响结果，
  找不到实现时要回退默认实现。
- **hook**：在某件事之后补充数据（比如题目要展示前挂上发音按钮）。只追加，
  **失败必须吞掉**——不能因为一个插件挂了，整条业务链路断掉。

本模块只管 hook。provider 等真有第二个实现时再加，避免过早抽象。

事件命名约定 ``<名词>.<时机>``，例如 ``question.presented``。
"""

from __future__ import annotations

import logging
import threading
from typing import Callable

logger = logging.getLogger(__name__)

# event -> [(priority, plugin_id, handler)]
_handlers: dict[str, list[tuple[int, str, Callable]]] = {}
_lock = threading.Lock()


def register(event: str, plugin_id: str, handler: Callable, priority: int = 100) -> None:
    """注册钩子。priority 小的先跑。"""
    with _lock:
        bucket = _handlers.setdefault(event, [])
        bucket.append((int(priority), plugin_id, handler))
        bucket.sort(key=lambda item: item[0])


def unregister_plugin(plugin_id: str) -> None:
    """插件被禁用/重载时清掉它的钩子。"""
    with _lock:
        for event, bucket in list(_handlers.items()):
            _handlers[event] = [item for item in bucket if item[1] != plugin_id]
            if not _handlers[event]:
                _handlers.pop(event, None)


def clear() -> None:
    with _lock:
        _handlers.clear()


def handlers_for(event: str) -> list[tuple[int, str, Callable]]:
    with _lock:
        return list(_handlers.get(event, []))


def emit(event: str, payload: dict) -> dict:
    """依次调用钩子，每个都能改写 payload。

    handler 返回 dict 表示"用这个替换 payload"，返回 None 表示不改。
    任何异常都只记日志——钩子不能影响主流程。
    """
    handlers = handlers_for(event)
    if not handlers:
        return payload
    current = payload
    for _priority, plugin_id, handler in handlers:
        try:
            result = handler(current)
        except Exception:
            logger.warning(
                "插件 %s 处理钩子 %s 失败，已跳过", plugin_id, event, exc_info=True
            )
            continue
        if isinstance(result, dict):
            current = result
    return current


def has_handlers(event: str) -> bool:
    return bool(handlers_for(event))


# ---- 实体扩展槽（extensions）----


def add_extension(payload: dict, plugin_id: str, data: dict) -> dict:
    """往实体的 ``extensions`` 槽里塞一个插件的数据。

    前端不认识具体插件，只按固定键渲染（audio / words / dict / iframe …），
    见 ``frontend/src/components/blocks/EntityExtensions.tsx``。
    """
    if not isinstance(payload, dict) or not isinstance(data, dict) or not data:
        return payload
    extensions = payload.get("extensions")
    if not isinstance(extensions, dict):
        extensions = {}
    extensions[plugin_id] = {**extensions.get(plugin_id, {}), **data}
    payload["extensions"] = extensions
    return payload


def emit_entity(kind: str, payload: dict) -> dict:
    """实体要发给前端前调用：``kind`` 如 question / material / tip / message。"""
    return emit(f"{kind}.presented", payload)


def describe() -> dict[str, list[str]]:
    """当前注册了哪些事件、分别被哪些插件挂过（排查用）。"""
    out: dict[str, list[str]] = {}
    for event, bucket in list(_handlers.items()):
        out[event] = [f"{pid}@{prio}" for prio, pid, _fn in bucket]
    return out
