"""学习报告服务：基于统计数据生成报告（LLM）+ 读写。"""

from __future__ import annotations

import json
import logging
from typing import Optional

from sqlalchemy.orm import Session

from ..core.errors import NotFoundError
from ..models import UserNote
from ..services import analytics as analytics_service
from ..services import note as note_service

logger = logging.getLogger(__name__)

REPORT_SYS_PROMPT = """你是知拾的学习报告生成器。根据用户的学习统计数据，生成一份结构化的学习报告（Markdown）。

报告结构：
# 学习报告
## 一、总体概览
## 二、各文档学习情况
## 三、薄弱知识点分析
## 四、建议

用中文，语气积极。基于给定数据如实分析，不要编造数据。"""


def _stats_text(db: Session) -> str:
    stats = analytics_service.get_stats(db)
    tag_stats = analytics_service.get_tag_stats(db)
    lines = [
        f"总文档数：{stats['documents']['total']}（已索引 {stats['documents']['indexed']}，学习区 {stats['documents']['study_zone']}）",
        f"总题目数：{stats['questions']['total']}，已答 {stats['questions']['answered']}，答对 {stats['questions']['correct']}，答错 {stats['questions']['wrong']}，不会 {stats['questions']['unknown']}",
        f"正确率：{stats['questions']['accuracy_rate'] * 100:.1f}%",
    ]
    for p in stats["document_progress"][:5]:
        lines.append(f"- {p['document_name']}: {p['answered_count']}/{p['question_total']} 题，正确率 {p['accuracy_rate']*100:.1f}%")
    weak = [t for t in tag_stats["by_tag"] if t["total_attempts"] > 0 and t["accuracy_rate"] < 0.6]
    if weak:
        lines.append("薄弱标签：" + "、".join(f"{t['tag']}({t['accuracy_rate']*100:.0f}%)" for t in weak[:5]))
    return "\n".join(lines)


async def generate_report(db: Session) -> dict:
    """生成学习报告，返回 (report, saved_to_notes)。"""
    stats_text = _stats_text(db)
    from ..core.llm import create_agent
    agent = create_agent(system_prompt=REPORT_SYS_PROMPT)
    content = ""
    try:
        async for chunk in agent.apredict(f"以下是我的学习数据，请生成学习报告：\n{stats_text}"):
            c = chunk.get("content", "")
            if c:
                content += c
    except Exception as e:
        logger.warning("报告生成失败: %s", e)
        content = content or f"（报告生成失败：{e}）"

    note = note_service.save_report(db, f"学习报告 {__import__('datetime').datetime.now().strftime('%Y-%m-%d')}", content)
    return _report_out(note), True


def list_reports(db: Session) -> dict:
    notes = db.query(UserNote).filter(UserNote.note_type == "report").order_by(UserNote.created_at.desc()).all()
    return {"reports": [_report_out(n) for n in notes], "total": len(notes)}


def get_latest_report(db: Session) -> Optional[dict]:
    note = db.query(UserNote).filter(UserNote.note_type == "report").order_by(UserNote.created_at.desc()).first()
    return _report_out(note) if note else None


def get_report(db: Session, report_id: str) -> dict:
    note = db.get(UserNote, report_id)
    if not note:
        raise NotFoundError("报告不存在")
    return _report_out(note)


def _report_out(n: UserNote) -> dict:
    return {
        "id": n.id,
        "title": n.title or "",
        "content_md": n.content_md or "",
        "collection_id": n.collection_id,
        "note_type": n.note_type,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }
