"""资料组：系列文档的聚合管理与统计。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.errors import AppError, NotFoundError
from ..models import Document, DocumentGroup, GlobalQuestion, QuestionProvenance, QuestionRef
from ..utils import parse_tags


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _doc_out(d: Document) -> dict:
    tags = []
    if d.tags:
        try:
            import json

            tags = json.loads(d.tags) if isinstance(d.tags, str) else (d.tags or [])
        except Exception:
            tags = []
    if d.indexing_status == "processing" and (d.is_scanned_pdf or (d.file_type or "").lower() == "pdf"):
        ocr_status = "processing"
    elif d.is_scanned_pdf:
        ocr_status = "completed"
    else:
        ocr_status = None
    return {
        "id": d.id,
        "name": d.display_name,
        "type": d.file_type or "txt",
        "tags": tags if isinstance(tags, list) else [],
        "status": d.indexing_status,
        "segment_status": d.segment_status,
        "question_gen_status": d.question_gen_status,
        "ocr_status": ocr_status,
        "pdf_page_count": d.pdf_page_count,
        "zone": d.zone,
        "group_id": d.group_id,
        "wordCount": 0,
        "updatedAt": d.updated_at,
    }


def _aggregate_stats(db: Session, doc_ids: list[str]) -> dict:
    if not doc_ids:
        return {"total": 0, "answered": 0, "correct": 0, "wrong": 0, "unknown": 0}
    qids = [
        r[0]
        for r in db.query(QuestionProvenance.question_id)
        .filter(QuestionProvenance.document_id.in_(doc_ids))
        .distinct()
        .all()
    ]
    total = len(qids)
    if not total:
        return {"total": 0, "answered": 0, "correct": 0, "wrong": 0, "unknown": 0}
    refs = db.query(QuestionRef).filter(QuestionRef.document_id.in_(doc_ids)).all()
    # 同一题可能有多文档 ref；按 question_id 合并「是否做过」取任意文档上的 last_status
    by_q: dict[str, QuestionRef] = {}
    for r in refs:
        prev = by_q.get(r.question_id)
        if prev is None or (r.attempt_count or 0) > (prev.attempt_count or 0):
            by_q[r.question_id] = r
    answered = correct = wrong = unknown = 0
    for qid in qids:
        r = by_q.get(qid)
        if not r or (r.attempt_count or 0) <= 0:
            continue
        answered += 1
        st = r.last_status
        if st == "correct":
            correct += 1
        elif st == "wrong":
            wrong += 1
        elif st == "unknown":
            unknown += 1
    return {
        "total": total,
        "answered": answered,
        "correct": correct,
        "wrong": wrong,
        "unknown": unknown,
    }


def _group_tags(db: Session, doc_ids: list[str]) -> list[str]:
    if not doc_ids:
        return []
    qids = [
        r[0]
        for r in db.query(QuestionProvenance.question_id)
        .filter(QuestionProvenance.document_id.in_(doc_ids))
        .distinct()
        .all()
    ]
    if not qids:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for gq in db.query(GlobalQuestion).filter(GlobalQuestion.id.in_(qids)).all():
        for t in parse_tags(gq.tags):
            if t not in seen:
                seen.add(t)
                out.append(t)
    return out


class DocGroupService:
    def create(
        self,
        db: Session,
        *,
        name: str,
        collection_id: Optional[str] = None,
        description: Optional[str] = None,
    ) -> DocumentGroup:
        name = (name or "").strip()
        if not name:
            raise AppError("资料组名称不能为空")
        g = DocumentGroup(
            name=name,
            collection_id=collection_id,
            description=(description or "").strip() or None,
        )
        db.add(g)
        db.commit()
        db.refresh(g)
        return g

    def get(self, db: Session, group_id: str) -> DocumentGroup:
        g = db.get(DocumentGroup, group_id)
        if not g:
            raise NotFoundError("资料组不存在")
        return g

    def list_groups(self, db: Session, collection_id: Optional[str] = None) -> list[DocumentGroup]:
        q = db.query(DocumentGroup)
        if collection_id:
            q = q.filter(DocumentGroup.collection_id == collection_id)
        return q.order_by(DocumentGroup.updated_at.desc()).all()

    def member_docs(self, db: Session, group_id: str) -> list[Document]:
        return (
            db.query(Document)
            .filter(Document.group_id == group_id)
            .order_by(Document.created_at.desc())
            .all()
        )

    def group_item(self, db: Session, g: DocumentGroup) -> dict:
        docs = self.member_docs(db, g.id)
        ids = [d.id for d in docs]
        return {
            "id": g.id,
            "name": g.name,
            "description": g.description,
            "collection_id": g.collection_id,
            "cover_document_id": g.cover_document_id or (ids[0] if ids else None),
            "doc_count": len(docs),
            "stats": _aggregate_stats(db, ids),
            "created_at": g.created_at,
            "updated_at": g.updated_at,
        }

    def group_detail(self, db: Session, group_id: str) -> dict:
        g = self.get(db, group_id)
        docs = self.member_docs(db, group_id)
        ids = [d.id for d in docs]
        item = self.group_item(db, g)
        item["documents"] = [_doc_out(d) for d in docs]
        item["tags"] = _group_tags(db, ids)
        return item

    def update(
        self,
        db: Session,
        group_id: str,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        cover_document_id: Optional[str] = None,
    ) -> DocumentGroup:
        g = self.get(db, group_id)
        if name is not None:
            name = name.strip()
            if not name:
                raise AppError("资料组名称不能为空")
            g.name = name
        if description is not None:
            g.description = description.strip() or None
        if cover_document_id is not None:
            if cover_document_id:
                doc = db.get(Document, cover_document_id)
                if not doc or doc.group_id != group_id:
                    raise AppError("封面文档须属于本资料组")
            g.cover_document_id = cover_document_id or None
        g.updated_at = _now()
        db.commit()
        db.refresh(g)
        return g

    def delete(self, db: Session, group_id: str) -> None:
        g = self.get(db, group_id)
        db.query(Document).filter(Document.group_id == group_id).update(
            {Document.group_id: None}, synchronize_session=False
        )
        db.delete(g)
        db.commit()

    def add_documents(self, db: Session, group_id: str, document_ids: list[str]) -> dict:
        g = self.get(db, group_id)
        added = 0
        for did in document_ids:
            doc = db.get(Document, did)
            if not doc:
                continue
            if g.collection_id and doc.collection_id and doc.collection_id != g.collection_id:
                raise AppError(f"文档「{doc.display_name}」不在该组所属分区")
            doc.group_id = group_id
            if g.collection_id and not doc.collection_id:
                doc.collection_id = g.collection_id
            added += 1
        g.updated_at = _now()
        if not g.cover_document_id and document_ids:
            g.cover_document_id = document_ids[0]
        db.commit()
        return self.group_detail(db, group_id) | {"added": added}

    def remove_document(self, db: Session, group_id: str, document_id: str) -> dict:
        g = self.get(db, group_id)
        doc = db.get(Document, document_id)
        if not doc or doc.group_id != group_id:
            raise NotFoundError("文档不在该资料组中")
        doc.group_id = None
        if g.cover_document_id == document_id:
            rest = self.member_docs(db, group_id)
            g.cover_document_id = rest[0].id if rest else None
        g.updated_at = _now()
        db.commit()
        return self.group_detail(db, group_id)

    def assign_doc(self, db: Session, doc: Document, group_id: Optional[str]) -> None:
        if not group_id:
            return
        g = self.get(db, group_id)
        if g.collection_id and doc.collection_id and doc.collection_id != g.collection_id:
            raise AppError("文档分区与资料组不一致")
        doc.group_id = group_id
        if g.collection_id and not doc.collection_id:
            doc.collection_id = g.collection_id
        if not g.cover_document_id:
            g.cover_document_id = doc.id
        g.updated_at = _now()


doc_group_service = DocGroupService()
