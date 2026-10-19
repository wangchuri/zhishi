"""笔记/报告服务：保存 tip、列出笔记、报告写入。"""

from __future__ import annotations

import json
import re
from typing import Optional

from sqlalchemy.orm import Session

from ..models import Document, NoteFolder, UserNote
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


def _note_folder(n: UserNote) -> str:
    """笔记所属文件夹：报告固定学习报告，tip 归 tip，其余用存储值。"""
    if n.note_type == "report":
        return "学习报告"
    # question_reflection 是旧的「题目思路」，现在统一归到 tip（见 save_question_reflection）
    if n.note_type in ("tip", "question_reflection"):
        return "tip"
    return ((getattr(n, "folder", None) or "我的笔记") or "").strip() or "我的笔记"


def _note_out(n: UserNote, names: dict[str, str] | None = None) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "content_md": unwrap_markdown_fence(n.content_md or "") if n.note_type == "report" else n.content_md,
        "note_type": n.note_type,
        "folder": _note_folder(n),
        "document_id": n.document_id,
        "document_name": (names or {}).get(n.document_id or "") if n.document_id else None,
        "question_id": getattr(n, "question_id", None),
        "page_number": n.page_number,
        "tags": parse_tags(getattr(n, "user_tags", None)),
        "is_draft": bool(getattr(n, "is_draft", False)),
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


def _register_folder(db: Session, name: str | None) -> str:
    """把文件夹名登记进 note_folders（不提交），空文件夹也能被记住。"""
    clean = (name or "").strip()[:100]
    if not clean:
        return ""
    exists = db.query(NoteFolder).filter(NoteFolder.name == clean).first()
    if not exists:
        db.add(NoteFolder(name=clean))
    return clean


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
            folder="tip",
            user_tags=_dump_user_tags(tags),
        )
        db.add(note)
        db.commit()
        db.refresh(note)
        return note

    def save_question_reflection(
        self,
        db: Session,
        *,
        question_id: str,
        content_md: str,
        document_id: Optional[str] = None,
        title: Optional[str] = None,
    ) -> UserNote:
        """追加一条「题目感想」（只增不改），直接记成 tip。

        以前写的是 note_type="question_reflection" / folder="题目思路"，会跑到笔记页，
        但那边没有题目上下文、看着像一堆散落的句子。现在归到 tip：阅读页的 tip 面板
        里能按「上面题目、下面感想」展示，笔记页不再出现。
        """
        from ..models import GlobalQuestion, QuestionProvenance, QuestionRef

        doc_id = document_id or None
        if not doc_id:
            prov = (
                db.query(QuestionProvenance)
                .filter(QuestionProvenance.question_id == question_id)
                .first()
            )
            doc_id = prov.document_id if prov else None

        # 系统 tag：资料名 / 感想 / 难度，答错或不会再加一个「错题」
        tags: list[str] = []
        if doc_id:
            doc = db.get(Document, doc_id)
            if doc and doc.display_name:
                tags.append(doc.display_name)
        tags.append("感想")
        gq = db.get(GlobalQuestion, question_id)
        diff = getattr(gq, "difficulty", None) if gq else None
        if diff in (1, 2, 3):
            tags.append({1: "难度·简单", 2: "难度·中等", 3: "难度·困难"}[diff])
        ref = (
            db.query(QuestionRef)
            .filter(QuestionRef.question_id == question_id)
            .order_by(QuestionRef.last_answered_at.desc(), QuestionRef.created_at.desc())
            .first()
        )
        if ref and ref.last_status in ("wrong", "unknown"):
            tags.append("错题")

        note = UserNote(
            question_id=question_id,
            document_id=doc_id,
            title=(title or "").strip()[:255] or None,
            content_md=content_md or "",
            note_type="tip",
            folder="tip",
            user_tags=_dump_user_tags(tags),
        )
        db.add(note)
        db.commit()
        db.refresh(note)
        return note

    def list_question_reflections(self, db: Session, question_id: str) -> list[UserNote]:
        """某题的全部感想，按时间升序（旧 → 新）。

        新数据写的是 note_type="tip"（见 save_question_reflection），
        旧的 question_reflection 记录也一并返回，避免历史感想凭空消失。
        """
        return (
            db.query(UserNote)
            .filter(
                UserNote.question_id == question_id,
                UserNote.note_type.in_(("tip", "question_reflection")),
            )
            .order_by(UserNote.created_at.asc())
            .all()
        )

    def create_note(
        self,
        db: Session,
        *,
        title: str = "无标题",
        content_md: str = "",
        folder: Optional[str] = None,
        document_id: Optional[str] = None,
        page_number: Optional[int] = None,
        tags: Optional[list[str]] = None,
        is_draft: bool = False,
    ) -> UserNote:
        """新建一条手写笔记。"""
        note = UserNote(
            title=(title or "").strip()[:255] or "无标题",
            content_md=content_md or "",
            note_type="manual",
            folder=(folder or "我的笔记").strip()[:100] or "我的笔记",
            document_id=document_id or None,
            page_number=page_number,
            user_tags=_dump_user_tags(tags),
            is_draft=bool(is_draft),
        )
        _register_folder(db, note.folder)
        db.add(note)
        db.commit()
        db.refresh(note)
        return note

    def update_note(
        self,
        db: Session,
        note_id: str,
        *,
        title: Optional[str] = None,
        content_md: Optional[str] = None,
        folder: Optional[str] = None,
        document_id: Optional[str] = None,
        page_number: Optional[int] = None,
        tags: Optional[list[str]] = None,
        is_draft: Optional[bool] = None,
    ) -> Optional[UserNote]:
        """更新手写笔记；只改传入的字段。tip/report 不允许改。"""
        note = self.get_note(db, note_id)
        if not note:
            return None
        if note.note_type != "manual":
            return note
        if title is not None:
            note.title = (title or "").strip()[:255] or "无标题"
        if content_md is not None:
            note.content_md = content_md
        if folder is not None:
            note.folder = (folder or "").strip()[:100] or "我的笔记"
            _register_folder(db, note.folder)
        if document_id is not None:
            note.document_id = document_id or None
        if page_number is not None:
            note.page_number = page_number
        if tags is not None:
            note.user_tags = _dump_user_tags(tags)
        if is_draft is not None:
            note.is_draft = bool(is_draft)
        db.commit()
        db.refresh(note)
        return note

    def delete_note(self, db: Session, note_id: str) -> bool:
        note = self.get_note(db, note_id)
        if not note:
            return False
        db.delete(note)
        db.commit()
        return True

    def list_folders(self, db: Session) -> list[dict]:
        """笔记文件夹及数量（不含 tip / 旧的题目思路）。含自建的空文件夹。"""
        rows = (
            db.query(UserNote)
            .filter(UserNote.note_type.notin_(("tip", "question_reflection")))
            .all()
        )
        counts: dict[str, int] = {}
        for n in rows:
            name = _note_folder(n)
            counts[name] = counts.get(name, 0) + 1
        names: set[str] = set(counts.keys())
        names.add("我的笔记")
        for (raw,) in db.query(NoteFolder.name).all():
            clean = (raw or "").strip()
            if clean:
                names.add(clean)
        ordered = sorted(names, key=lambda name: (-counts.get(name, 0), name))
        return [{"name": name, "count": counts.get(name, 0)} for name in ordered]

    def create_folder(self, db: Session, name: str) -> str:
        """登记一个（可为空的）笔记文件夹。"""
        clean = _register_folder(db, name)
        if clean:
            db.commit()
        return clean

    def list_notes(
        self,
        db: Session,
        document_id: Optional[str] = None,
        note_type: Optional[str] = None,
        folder: Optional[str] = None,
        limit: int = 100,
    ) -> dict:
        q = db.query(UserNote)
        if document_id:
            q = q.filter(UserNote.document_id == document_id)
        if note_type:
            q = q.filter(UserNote.note_type == note_type)
        notes = q.order_by(UserNote.created_at.desc()).all()
        if folder:
            notes = [n for n in notes if _note_folder(n) == folder]
        if limit and limit > 0:
            notes = notes[:limit]
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
        """本书的 tip（含旧的「题目思路」记录），并给题目感想补上题干。"""
        notes = (
            db.query(UserNote)
            .filter(
                UserNote.document_id == document_id,
                UserNote.note_type.in_(("tip", "question_reflection")),
            )
            .order_by(UserNote.created_at.desc())
            .all()
        )
        names = _doc_names(db, notes)
        items = [_note_out(n, names) for n in notes]
        self._attach_question_brief(db, items)
        return {"notes": items, "total": len(items)}

    def _attach_question_brief(self, db: Session, items: list[dict]) -> None:
        """给带 question_id 的 tip 补题干/答案，前端按「上面题目、下面感想」展示。"""
        ids = {it.get("question_id") for it in items if it.get("question_id")}
        if not ids:
            return
        from ..models import GlobalQuestion
        from ..utils import absolutize_image_refs, document_image_base

        rows = db.query(GlobalQuestion).filter(GlobalQuestion.id.in_(ids)).all()
        by_id = {g.id: g for g in rows}
        for it in items:
            gq = by_id.get(it.get("question_id"))
            if not gq:
                continue
            base = document_image_base(it.get("document_id"))
            it["question"] = {
                "id": gq.id,
                "stem": absolutize_image_refs(gq.stem or "", base),
                "question_type": gq.question_type,
                "difficulty": gq.difficulty,
                "answer": absolutize_image_refs(gq.answer or "", base),
            }

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
        note = UserNote(
            title=title,
            content_md=unwrap_markdown_fence(content_md),
            note_type="report",
            folder="学习报告",
        )
        db.add(note)
        db.commit()
        db.refresh(note)
        return note


# 模块级单例
note_service = NoteService()
