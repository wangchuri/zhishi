"""Tina 心情标签 → KeywordActions（Hide + 待推送 mood 队列）。"""

from __future__ import annotations

from tina import KeywordActions

# 与前端 tinaBursts / 傲娇 prompt 一致（Hide 需与模型输出大小写一致）
TINA_MOODS = (
    "NORMAL",
    "HAPPY",
    "SAD",
    "THINK",
    "HELPLESS",
    "MOCK",
    "DISDAIN",
)

_MOOD_HINT = {
    "NORMAL": "平静日常",
    "HAPPY": "开心、夸奖、成功",
    "SAD": "遗憾、道歉、同情",
    "THINK": "思考、不确定",
    "HELPLESS": "无奈",
    "MOCK": "调侃、傲娇、小嘲讽",
    "DISDAIN": "不屑、惊讶",
}


class TinaMoodActions:
    """挂到普通 Agent 的 keyword_actions；drain() 供 SSE 推 tina_mood。"""

    def __init__(self) -> None:
        self.actions = KeywordActions()
        self._pending: list[str] = []
        for mood in TINA_MOODS:
            hint = _MOOD_HINT.get(mood, mood)
            kw = f"[{mood}]"

            def _make(m: str = mood):
                def _emit() -> None:
                    self._pending.append(m)

                _emit.__name__ = f"mood_{m.lower()}"
                _emit.__doc__ = f"切换表情为 {m}（{hint}）"
                return _emit

            self.actions.bind_action(
                keyword=kw,
                func=_make(),
                match="contains",
                display=False,
                description=f"切换表情为 {mood}（{hint}）",
            )

    def drain(self) -> list[str]:
        out = self._pending[:]
        self._pending.clear()
        return out


def last_assistant_raw_text(agent) -> str:
    """从 Agent 上下文取最后一条 assistant 正文（可见流可能已 Hide）。

    tina 0.7.4 起 ``get_messages()`` 返回 ``Message`` / ``ToolCalls`` 对象
    （不再是 dict），所以要按属性读；这里同时兼容旧版的 dict 形态。
    """
    try:
        messages = agent.context_manager.get_messages()
    except Exception:
        return ""
    for msg in reversed(messages or []):
        if isinstance(msg, dict):
            role = msg.get("role")
            content = msg.get("content")
        else:
            role = getattr(msg, "role", None)
            content = getattr(msg, "content", None)
        if role != "assistant":
            continue
        # content 可能是 str，也可能是多模态块列表
        if isinstance(content, str) and content.strip():
            return content
    return ""
