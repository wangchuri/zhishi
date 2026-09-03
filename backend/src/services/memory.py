"""Tina 对用户的长期记忆（偏好、习惯、个性等）。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models.goal import UserProfile
from .profile import get_or_create_profile
from .task import USER_ID

_VALID_CATEGORIES = frozenset({"preference", "personality", "habit", "fact", "other"})


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
) -> tuple[bool, str]:
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
    items.insert(
        0,
        {
            "id": uuid.uuid4().hex,
            "content": text,
            "category": cat,
            "created_at": _now().isoformat(),
        },
    )
    items = items[:50]
    _save_raw(db, row, items)
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
