"""Tina 对用户的长期记忆（偏好、习惯、个性等）。

- SQLite（UserProfile.tina_memory_json）：给 prompt 注入的最近记忆
- Chroma 向量库：按语义召回，供 recall_memory 工具使用
- 历史压缩：对话上下文接近上限时，把最老的一批消息总结成记忆存下来
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import literal_column
from sqlalchemy.orm import Session

from ..core.llm import MODEL_CONTEXT_TOKENS
from ..models.goal import UserProfile
from .profile import get_or_create_profile
from .task import USER_ID

logger = logging.getLogger(__name__)

_VALID_CATEGORIES = frozenset({"preference", "personality", "habit", "fact", "other"})

# 同一批写入的消息 created_at 可能完全相同，排序补 rowid（SQLite 插入顺序）兜底
_ROWID = literal_column("chat_messages.rowid")

# 压缩触发：上下文占模型窗口（core.llm.MODEL_CONTEXT_TOKENS，默认 1M）的 70%
COMPRESS_RATIO = 0.7
# 压缩时保留最近多少条消息原样回放（其余进记忆）
_KEEP_RECENT_MESSAGES = 12


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load_raw(row: UserProfile) -> list[dict[str, Any]]:
    raw = getattr(row, "tina_memory_json", None) or ""
    if not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def _save_raw(db: Session, row: UserProfile, items: list[dict[str, Any]]) -> None:
    row.tina_memory_json = json.dumps(items, ensure_ascii=False) if items else None
    row.updated_at = _now()
    db.commit()
    db.refresh(row)


def list_memories(db: Session, *, limit: int = 30) -> list[dict[str, Any]]:
    row = get_or_create_profile(db)
    items = _load_raw(row)
    return items[: max(1, min(limit, 50))]


def memory_brief_lines(db: Session, *, limit: int = 20) -> list[str]:
    """供 prompt 注入的简短列表。"""
    out: list[str] = []
    for item in list_memories(db, limit=limit):
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        cat = str(item.get("category") or "other")
        out.append(f"[{cat}] {content}")
    return out


def remember(
    db: Session,
    content: str,
    *,
    category: str = "preference",
    embed: bool = True,
) -> tuple[bool, str]:
    """写一条长期记忆（SQLite + 向量库）。"""
    text = (content or "").strip()
    if not text:
        return False, "记忆内容不能为空"
    if len(text) > 500:
        return False, "单条记忆不超过 500 字"
    cat = (category or "preference").strip().lower()
    if cat not in _VALID_CATEGORIES:
        cat = "other"
    row = get_or_create_profile(db)
    items = _load_raw(row)
    norm = text.lower()
    for item in items:
        if str(item.get("content") or "").strip().lower() == norm:
            return True, f"已有相同记忆，未重复保存：{text}"
    mid = uuid.uuid4().hex
    items.insert(
        0,
        {
            "id": mid,
            "content": text,
            "category": cat,
            "created_at": _now().isoformat(),
        },
    )
    items = items[:50]
    _save_raw(db, row, items)

    if embed:
        try:
            from .rag import chroma_store

            chroma_store.add_memory(
                USER_ID, text, metadata={"category": cat, "memory_id": mid}
            )
        except Exception:
            # 向量库不可用不该让"记住"失败：SQLite 里已经有这条
            logger.warning("记忆写入向量库失败：%s", text[:40])
    return True, f"已记住：{text}"


def forget(db: Session, memory_id: str) -> tuple[bool, str]:
    mid = (memory_id or "").strip()
    if not mid:
        return False, "缺少 memory_id"
    row = get_or_create_profile(db)
    items = _load_raw(row)
    kept = [x for x in items if str(x.get("id") or "") != mid]
    if len(kept) == len(items):
        return False, f"找不到记忆：{mid}"
    _save_raw(db, row, kept)
    return True, "已删除该条记忆"


def format_for_agent(db: Session) -> str:
    lines = memory_brief_lines(db)
    if not lines:
        return "（暂无长期记忆）"
    return "\n".join(f"- {line}" for line in lines)


# ---- 召回（recall_memory 工具用） ----


def recall(db: Session, query: str, *, top_k: int = 5) -> list[str]:
    """按语义召回记忆；向量库不可用时退回最近记忆。"""
    q = (query or "").strip()
    if not q:
        return memory_brief_lines(db, limit=top_k)
    hits: list[str] = []
    try:
        from .rag import chroma_store

        for item in chroma_store.search_memories(USER_ID, q, top_k=top_k):
            text = str(item.get("text") or "").strip()
            if text and text not in hits:
                hits.append(text)
    except Exception:
        logger.warning("记忆检索失败，退回最近记忆")
    if hits:
        return hits
    return memory_brief_lines(db, limit=top_k)


# ---- 历史压缩 ----


def should_compress(prompt_tokens: int) -> bool:
    """上下文占用是否到了压缩阈值（依据模型 API 返回的 prompt_tokens）。"""
    try:
        used = int(prompt_tokens or 0)
    except Exception:
        return False
    if used <= 0:
        return False
    return used >= int(MODEL_CONTEXT_TOKENS * COMPRESS_RATIO)


def context_usage(prompt_tokens: int) -> float:
    """当前占用比例（0~1），日志/调试用。"""
    try:
        used = int(prompt_tokens or 0)
    except Exception:
        return 0.0
    if used <= 0:
        return 0.0
    return min(1.0, used / float(MODEL_CONTEXT_TOKENS))


def compress_to_memory(
    db: Session,
    messages: list[dict],
    *,
    max_items: int = 6,
) -> list[str]:
    """把一段历史消息总结成几条长期记忆并落库，返回写入的记忆文本。"""
    if not messages:
        return []
    transcript_lines = []
    for m in messages:
        role = m.get("role") or "user"
        content = (m.get("content") or "").strip()
        if not content:
            continue
        who = "用户" if role == "user" else "Tina"
        transcript_lines.append(f"{who}：{content}")
    transcript = "\n".join(transcript_lines).strip()
    if not transcript:
        return []

    summary = _summarize(transcript, max_items=max_items)
    if not summary:
        return []

    written: list[str] = []
    for line in summary:
        ok, _ = remember(db, line, category="fact", embed=True)
        if ok:
            written.append(line)
    return written


def _summarize(transcript: str, *, max_items: int = 6) -> list[str]:
    """调模型把对话压成「值得长期记住」的要点。失败返回空列表。"""
    try:
        from ..core.llm import create_llm

        llm = create_llm()
        prompt = (
            "下面是一段学习助手与用户的对话。请提炼出**值得长期记住**的信息，"
            f"最多 {max_items} 条，每条一行，用「- 」开头。\n"
            "只保留：学习目标与计划、薄弱点与错因、偏好与习惯、正在推进的具体事项。\n"
            "不要保留寒暄、重复内容和一次性问答。每条不超过 60 字。\n\n"
            f"{transcript[:12000]}"
        )
        resp = llm.predict_no_stream(
            input_text=prompt,
            sys_prompt="你是学习档案整理助手，只输出要点列表，不要解释。",
            temperature=0.3,
            max_tokens=800,
        )
        text = ""
        if isinstance(resp, dict):
            text = str(resp.get("content") or "")
        else:
            text = str(resp or "")
        out: list[str] = []
        for raw in text.splitlines():
            line = raw.strip().lstrip("-•*").strip()
            if not line or line.endswith("：") or line.endswith(":"):
                continue
            if len(line) < 4:
                continue
            out.append(line[:200])
        return out[:max_items]
    except Exception:
        logger.exception("对话压缩失败")
        return []


def maybe_compress_history(db: Session, session, *, max_messages: int = 50) -> int:
    """把最老的一批历史消息压成长期记忆（调用方已确认上下文占用到阈值）。

    返回本轮压缩掉的消息条数（0 表示没压）。压缩后 session.memory_cursor
    前移，回放时这些消息不再进上下文，改由记忆摘要承接。
    """
    from ..models import ChatMessage

    base = db.query(ChatMessage).filter(ChatMessage.session_id == session.id)
    total = base.count()
    cursor = int(getattr(session, "memory_cursor", 0) or 0)
    if total <= cursor:
        return 0

    rows = (
        base.order_by(ChatMessage.created_at, _ROWID)
        .offset(cursor)
        .limit(max_messages)
        .all()
    )
    messages = [{"role": r.role, "content": r.content or ""} for r in rows]
    if len(messages) <= _KEEP_RECENT_MESSAGES:
        return 0

    cut = len(messages) - _KEEP_RECENT_MESSAGES
    written = compress_to_memory(db, messages[:cut])
    if not written:
        return 0

    before_tokens = int(getattr(session, "last_prompt_tokens", 0) or 0)
    session.memory_cursor = cursor + cut
    # 压缩后上下文已经变小，等下一轮 API 返回新的占用再判断
    session.last_prompt_tokens = 0
    db.commit()
    logger.info(
        "会话 %s 压缩 %s 条历史为 %s 条记忆（压缩前占用 %s token）",
        session.id,
        cut,
        len(written),
        before_tokens,
    )
    return cut
