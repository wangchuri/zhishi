"""笔记/报告服务：保存 tip、列出笔记、报告写入。"""

from __future__ import annotations

import json
import re
from typing import Optional

from sqlalchemy.orm import Session

from ..models import Document, UserNote
from ..utils import parse_tags

_MD_FENCE = re.compile(r"^```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n```\s*$", re.I)


def unwrap_markdown_fence(text: str) -> str:
    raw = (text or "").strip()
    m = _MD_FENCE.match(raw)
    if m:
        return m.group(1).strip()
    m2 = re.match(r"^```(?:markdown|md)?\s*\r?\n([\s\S]*)$", raw, re.I)
    if m2:
        body = m2.group(1)
        if body.rstrip().endswith("```"):
            body = body.rstrip()[:-3]
        return body.strip()
    return text or ""


def _dump_user_tags(tags: list[str] | None) -> str | None:
    names = parse_tags(tags)
    if not names:
        return None
    return json.dumps(names, ensure_ascii=False)


def _note_out(n: UserNote, names: dict[str, str] | None = None) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "content_md": unwrap_markdown_fence(n.content_md or "") if n.note_type == "report" else n.content_md,
        "note_type": n.note_type,
        "document_id": n.document_id,
        "document_name": (names or {}).get(n.document_id or "") if n.document_id else None,
        "page_number": n.page_number,
        "tags": parse_tags(getattr(n, "user_tags", None)),
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


def _doc_names(db: Session, notes: list[UserNote]) -> dict[str, str]:
    ids = {n.document_id for n in notes if n.document_id}
    if not ids:
        return {}
    rows = db.query(Document.id, Document.display_name).filter(Document.id.in_(ids)).all()
    return {row.id: row.display_name for row in rows}


class NoteService:
    """笔记领域服务。"""

    def save_tip(
        self,
        db: Session,
        *,
        document_id: Optional[str],
        page_number: Optional[int],
        title: str,
        content: str,
        tags: Optional[list[str]] = None,
    ) -> UserNote:
        note = UserNote(
            document_id=document_id or None,
            page_number=page_number,
            title=title,
            content_md=content,
            note_type="tip",
            user_tags=_dump_user_tags(tags),
        )
        db.add(note)
        db.commit()
        db.refresh(note)
        return note

    def list_notes(
        self,
        db: Session,
        document_id: Optional[str] = None,
        note_type: Optional[str] = None,
        limit: int = 100,
    ) -> dict:
        q = db.query(UserNote)
        if document_id:
            q = q.filter(UserNote.document_id == document_id)
        if note_type:
            q = q.filter(UserNote.note_type == note_type)
        notes = q.order_by(UserNote.created_at.desc()).limit(limit).all()
        names = _doc_names(db, notes)
        return {
            "notes": [_note_out(n, names) for n in notes],
            "total": len(notes),
        }

    def get_note(self, db: Session, note_id: str) -> Optional[UserNote]:
        return db.query(UserNote).filter(UserNote.id == note_id).first()

    def note_to_item(self, db: Session, note: UserNote) -> dict:
        names = _doc_names(db, [note])
        return _note_out(note, names)

    def list_tips(self, db: Session, document_id: str) -> dict:
        return self.list_notes(db, document_id=document_id, note_type="tip")

    def list_tip_tags(self, db: Session) -> list[str]:
        rows = (
            db.query(UserNote.user_tags)
            .filter(UserNote.note_type == "tip", UserNote.user_tags.isnot(None))
            .all()
        )
        names: list[str] = []
        for (raw,) in rows:
            names.extend(parse_tags(raw))
        seen: set[str] = set()
        out: list[str] = []
        for name in names:
            if name not in seen:
                seen.add(name)
                out.append(name)
        return out

    def search_tips(
        self,
        db: Session,
        *,
        keyword: str = "",
        tag: str = "",
        document_id: str = "",
        limit: int = 10,
    ) -> dict:
        """按关键词 / tag / 资料检索 tip。返回 {total, tips}，tips 不含全文。"""
        q = db.query(UserNote).filter(UserNote.note_type == "tip")
        doc_id = (document_id or "").strip()
        if doc_id:
            q = q.filter(UserNote.document_id == doc_id)
        rows = q.order_by(UserNote.created_at.desc()).all()
        kw = (keyword or "").strip().lower()
        tag_need = (tag or "").strip()
        matched: list[dict] = []
        names = _doc_names(db, rows)
        for n in rows:
            tags = parse_tags(n.user_tags)
            if tag_need and tag_need not in tags:
                continue
            title = (n.title or "").strip()
            body = (n.content_md or "").strip()
            hay = f"{title}\n{body}".lower()
            if kw and kw not in hay:
                continue
            preview = " ".join(body.replace("!", "").replace("#", "").split())
            if len(preview) > 120:
                preview = preview[:119] + "…"
            matched.append({
                "tip_id": n.id,
                "title": title or "无标题",
                "preview": preview,
                "document_id": n.document_id,
                "document_name": names.get(n.document_id or "") if n.document_id else None,
                "page_number": n.page_number,
                "tags": tags,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            })
        cap = max(1, min(int(limit or 10), 30))
        return {"total": len(matched), "tips": matched[:cap]}

    def save_report(self, db: Session, title: str, content_md: str) -> UserNote:
        note = UserNote(title=title, content_md=unwrap_markdown_fence(content_md), note_type="report")
        db.add(note)
        db.commit()
        db.refresh(note)
        return note


# 模块级单例
note_service = NoteService()
