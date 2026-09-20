"""题目服务：入库（hash 去重）、溯源、文档级统计、查询、删除。

QuestionService 持有题目领域逻辑；纯函数（规范化/hash/输出）保留为模块级工具。
"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.errors import AppError
from ..models import (
    Document,
    GlobalQuestion,
    QuestionMaterial,
    QuestionProvenance,
    QuestionRef,
)
from ..utils import parse_tags, sha256_hex


# ---- 纯函数工具 ----

def _canonical(question: dict, material_hash: Optional[str] = None) -> str:
    """规范化题目用于 hash：材料内容 + 题干 + 选项 + 答案。

    带 material_hash 时纳入 hash，避免不同材料下同一道子题被误判为重复。
    """
    parts = [
        str(question.get("stem", "")),
        json.dumps(question.get("options", []), ensure_ascii=False, sort_keys=True),
        str(question.get("answer", "")),
    ]
    if material_hash:
        parts.insert(0, f"material:{material_hash}")
    return "|".join(parts)


def _hash_question(question: dict, material_hash: Optional[str] = None) -> str:
    return sha256_hex(_canonical(question, material_hash).encode("utf-8"))


def _hash_material(kind: str, content: str) -> str:
    return sha256_hex(f"{kind or ''}|{content or ''}".encode("utf-8"))


def _pages_from_json(raw: Optional[str]) -> list[int]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    out: list[int] = []
    for n in data:
        try:
            out.append(int(n))
        except (TypeError, ValueError):
            continue
    return sorted(set(out))


def _material_out(m: QuestionMaterial) -> dict:
    return {
        "id": m.id,
        "document_id": m.document_id,
        "kind": m.kind,
        "title": m.title,
        "content": m.content,
        "pages": _pages_from_json(m.pages_json),
        "chapter_id": m.chapter_id,
        "audio_ref": m.audio_ref,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def normalize_question(q: dict) -> dict | None:
    """规范题目标准形态。"""
    stem = str(q.get("stem", "")).strip()
    if not stem:
        return None
    qtype = q.get("question_type") or "single_choice"
    page_number = q.get("page_number")
    try:
        page_number = int(page_number) if page_number is not None else None
    except (TypeError, ValueError):
        page_number = None
    sub_index = q.get("sub_index")
    try:
        sub_index = int(sub_index) if sub_index is not None else None
    except (TypeError, ValueError):
        sub_index = None
    return {
        "stem": stem,
        "question_type": qtype,
        "options": q.get("options") or [],
        "answer": q.get("answer") or "",
        "explanation": q.get("explanation") or "",
        "tags": parse_tags(q.get("tags")),
        "source_type": q.get("source") or q.get("source_type") or "ai_generated",
        "reference_text": q.get("reference_text") or "",
        "html_content": q.get("html_content"),
        "answer_params": q.get("answer_params"),
        "page_number": page_number,
        "chapter_id": str(q.get("chapter_id") or "").strip() or None,
        "material_id": str(q.get("material_id") or "").strip() or None,
        "sub_index": sub_index,
    }


def _question_out(
    gq: GlobalQuestion,
    ref: QuestionRef | None,
    doc_id: Optional[str],
    chapter_id: Optional[str] = None,
):
    tags = parse_tags(gq.tags)
    options = json.loads(gq.options) if gq.options else None
    if ref and ref.attempt_count > 0:
        user_status = ref.last_status
    else:
        user_status = None
    return {
        "id": gq.id,
        "stem": gq.stem,
        "question_type": gq.question_type,
        "options": options,
        "answer": gq.answer,
        "explanation": gq.explanation,
        "tags": tags,
        "source_type": gq.source_type,
        "document_id": doc_id,
        "chapter_id": chapter_id,
        "html_content": gq.html_content,
        "answer_params": gq.answer_params,
        "material_id": gq.material_id,
        "sub_index": gq.sub_index,
        "created_at": gq.created_at.isoformat() if gq.created_at else None,
        "user_answer_status": user_status,
        "attempt_count": ref.attempt_count if ref else 0,
    }


class QuestionService:
    """题库领域服务。"""

    def store_question(
        self,
        db: Session,
        document: Document,
        question: dict,
    ) -> tuple[GlobalQuestion, bool]:
        """入库一道题。返回 (题目, 是否新建)。hash 相同则复用。"""
        q = normalize_question(question)
        if q is None:
            raise AppError("题目缺题干")

        material = None
        if q["material_id"]:
            material = db.get(QuestionMaterial, q["material_id"])
            if material is not None and material.document_id != document.id:
                material = None  # 材料不跨文档
        content_hash = _hash_question(q, material.content_hash if material else None)

        gq = db.query(GlobalQuestion).filter(GlobalQuestion.content_hash == content_hash).first()
        created = gq is None
        if created:
            gq = GlobalQuestion(
                content_hash=content_hash,
                stem=q["stem"],
                question_type=q["question_type"],
                options=json.dumps(q["options"], ensure_ascii=False) if q["options"] else None,
                answer=q["answer"],
                explanation=q["explanation"],
                tags=json.dumps(q["tags"], ensure_ascii=False) if q["tags"] else None,
                source_type=q["source_type"],
                html_content=q["html_content"],
                answer_params=q["answer_params"],
                material_id=q["material_id"] if material else None,
                sub_index=q["sub_index"],
            )
            db.add(gq)
            db.flush()
        elif material and not gq.material_id:
            gq.material_id = material.id
            if q["sub_index"] is not None:
                gq.sub_index = q["sub_index"]

        # 溯源
        existing = db.query(QuestionProvenance).filter_by(
            question_id=gq.id, document_id=document.id
        ).first()
        if not existing:
            db.add(QuestionProvenance(
                question_id=gq.id,
                document_id=document.id,
                excerpt=q["reference_text"][:500] or None,
                page_number=q.get("page_number"),
                chapter_id=q.get("chapter_id"),
            ))
        else:
            if existing.page_number is None and q.get("page_number") is not None:
                existing.page_number = q.get("page_number")
            if not existing.chapter_id and q.get("chapter_id"):
                existing.chapter_id = q.get("chapter_id")

        # 文档级 refs（统计，未写过则计数 0）
        ref = db.query(QuestionRef).filter_by(
            question_id=gq.id, document_id=document.id
        ).first()
        if not ref:
            db.add(QuestionRef(
                question_id=gq.id,
                document_id=document.id,
                collection_id=document.collection_id,
            ))

        return gq, created

    def get_or_create_material(
        self,
        db: Session,
        document: Document,
        *,
        kind: str,
        title: str = "",
        content: str = "",
        pages: Optional[list[int]] = None,
        chapter_id: Optional[str] = None,
        audio_ref: Optional[str] = None,
    ) -> tuple[QuestionMaterial, bool]:
        """按 (文档, kind, 内容) 去重地取或建一个材料。返回 (材料, 是否新建)。"""
        kind = (kind or "").strip() or "material"
        content = (content or "").strip()
        if not content:
            raise AppError("材料内容为空")
        content_hash = _hash_material(kind, content)
        mat = (
            db.query(QuestionMaterial)
            .filter(
                QuestionMaterial.document_id == document.id,
                QuestionMaterial.content_hash == content_hash,
            )
            .first()
        )
        page_list = sorted({int(p) for p in (pages or []) if p is not None})
        created = mat is None
        if created:
            mat = QuestionMaterial(
                document_id=document.id,
                kind=kind,
                title=(title or "").strip()[:200] or None,
                content=content,
                pages_json=json.dumps(page_list) if page_list else None,
                chapter_id=chapter_id or None,
                audio_ref=audio_ref or None,
                content_hash=content_hash,
            )
            db.add(mat)
            db.flush()
        else:
            # 复用已有材料：并入覆盖页；补标题
            covered = _pages_from_json(mat.pages_json)
            merged = sorted(set(covered) | set(page_list))
            if merged and merged != covered:
                mat.pages_json = json.dumps(merged)
            if not mat.title and (title or "").strip():
                mat.title = (title or "").strip()[:200]
        return mat, created

    def get_material(self, db: Session, material_id: str) -> Optional[QuestionMaterial]:
        if not material_id:
            return None
        return db.get(QuestionMaterial, material_id)

    def materials_covering(
        self,
        db: Session,
        document_id: str,
        pages: list[int],
    ) -> list[QuestionMaterial]:
        """返回覆盖了给定页面中任意一页的材料（按创建时间倒序）。"""
        want = {int(p) for p in (pages or []) if p is not None}
        if not document_id or not want:
            return []
        rows = (
            db.query(QuestionMaterial)
            .filter(QuestionMaterial.document_id == document_id)
            .order_by(QuestionMaterial.created_at.desc())
            .all()
        )
        return [m for m in rows if set(_pages_from_json(m.pages_json)) & want]

    def list_materials(
        self,
        db: Session,
        *,
        document_id: Optional[str] = None,
        keyword: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """列出材料（可按文档 / 关键词过滤），供笔记侧栏检索。"""
        q = db.query(QuestionMaterial)
        if document_id:
            q = q.filter(QuestionMaterial.document_id == document_id)
        rows = q.order_by(QuestionMaterial.created_at.desc()).all()
        kw = (keyword or "").strip().lower()
        if kw:
            rows = [
                m for m in rows
                if kw in f"{m.title or ''}\n{m.content or ''}".lower()
            ]
        if limit and limit > 0:
            rows = rows[:limit]
        return [_material_out(m) for m in rows]

    def attach_materials(self, db: Session, items: list[dict]) -> list[dict]:
        """给题目输出补上 material 详情（批量查询，避免 N+1）。"""
        ids = {it.get("material_id") for it in items if it.get("material_id")}
        if not ids:
            return items
        mats = {
            m.id: _material_out(m)
            for m in db.query(QuestionMaterial).filter(QuestionMaterial.id.in_(ids)).all()
        }
        for it in items:
            mid = it.get("material_id")
            if mid:
                it["material"] = mats.get(mid)
        return items

    def list_questions(
        self,
        db: Session,
        document_id: Optional[str] = None,
        collection_id: Optional[str] = None,
        keyword: Optional[str] = None,
        group_id: Optional[str] = None,
    ) -> dict:
        """列出题目（带文档级统计）。"""
        q = db.query(GlobalQuestion).join(
            QuestionProvenance,
            QuestionProvenance.question_id == GlobalQuestion.id,
        )
        scope_doc_ids: list[str] | None = None
        if group_id:
            from ..models import Document

            scope_doc_ids = [
                r[0] for r in db.query(Document.id).filter(Document.group_id == group_id).all()
            ]
            if not scope_doc_ids:
                return {
                    "questions": [],
                    "total": 0,
                    "document_id": document_id,
                    "collection_id": collection_id,
                    "group_id": group_id,
                    "answered_count": 0,
                    "correct_count": 0,
                    "wrong_count": 0,
                    "unknown_count": 0,
                    "best_streak": 0,
                }
            q = q.filter(QuestionProvenance.document_id.in_(scope_doc_ids))
        elif document_id:
            scope_doc_ids = [document_id]
            q = q.filter(QuestionProvenance.document_id == document_id)
        if collection_id:
            q = q.join(QuestionRef, QuestionRef.question_id == GlobalQuestion.id).filter(
                QuestionRef.collection_id == collection_id
            )
        if keyword:
            q = q.filter(GlobalQuestion.stem.like(f"%{keyword}%"))

        # 去重（组内同题可能多 provenance）
        questions = q.order_by(GlobalQuestion.created_at.desc()).all()
        seen: set[str] = set()
        unique: list = []
        for gq in questions:
            if gq.id in seen:
                continue
            seen.add(gq.id)
            unique.append(gq)
        questions = unique
        total = len(questions)

        result = []
        for gq in questions:
            doc_id = document_id
            prov = None
            if doc_id:
                prov = db.query(QuestionProvenance).filter_by(
                    question_id=gq.id, document_id=doc_id
                ).first()
            elif scope_doc_ids:
                prov = (
                    db.query(QuestionProvenance)
                    .filter(
                        QuestionProvenance.question_id == gq.id,
                        QuestionProvenance.document_id.in_(scope_doc_ids),
                    )
                    .first()
                )
                doc_id = prov.document_id if prov else None
            else:
                prov = db.query(QuestionProvenance).filter_by(question_id=gq.id).first()
                doc_id = prov.document_id if prov else None
            ref = None
            if scope_doc_ids and len(scope_doc_ids) > 1:
                refs = (
                    db.query(QuestionRef)
                    .filter(
                        QuestionRef.question_id == gq.id,
                        QuestionRef.document_id.in_(scope_doc_ids),
                    )
                    .all()
                )
                for r in refs:
                    if ref is None or (r.attempt_count or 0) > (ref.attempt_count or 0):
                        ref = r
            elif doc_id:
                ref = db.query(QuestionRef).filter_by(question_id=gq.id, document_id=doc_id).first()
            result.append(_question_out(
                gq, ref, doc_id, chapter_id=prov.chapter_id if prov else None,
            ))

        # 统计
        answered = correct = wrong = unknown = 0
        best_streak = 0
        if scope_doc_ids:
            refs = db.query(QuestionRef).filter(QuestionRef.document_id.in_(scope_doc_ids)).all()
            for r in refs:
                answered += r.attempt_count or 0
                correct += r.correct_count or 0
                wrong += r.wrong_count or 0
                unknown += r.unknown_count or 0
                best_streak = max(best_streak, r.best_streak or 0)

        self.attach_materials(db, result)
        return {
            "questions": result,
            "total": total,
            "document_id": document_id,
            "collection_id": collection_id,
            "group_id": group_id,
            "answered_count": answered,
            "correct_count": correct,
            "wrong_count": wrong,
            "unknown_count": unknown,
            "best_streak": best_streak,
        }

    def get_question(self, db: Session, question_id: str) -> dict:
        gq = db.get(GlobalQuestion, question_id)
        if not gq:
            raise AppError("题目不存在", status_code=404)
        provs = db.query(QuestionProvenance).filter_by(question_id=question_id).all()
        provenance = [
            {
                "id": p.id,
                "document_id": p.document_id,
                "segment_id": p.segment_id,
                "excerpt": p.excerpt,
                "page_number": p.page_number,
                "chapter_id": p.chapter_id,
            }
            for p in provs
        ]
        out = {
            **_question_out(
                gq, None, provs[0].document_id if provs else None,
                chapter_id=provs[0].chapter_id if provs else None,
            ),
            "provenance": provenance,
        }
        self.attach_materials(db, [out])
        return out

    def delete_by_document(self, db: Session, document_id: str) -> int:
        provs = db.query(QuestionProvenance).filter_by(document_id=document_id).all()
        question_ids = {p.question_id for p in provs}
        db.query(QuestionProvenance).filter_by(document_id=document_id).delete()
        db.query(QuestionRef).filter_by(document_id=document_id).delete()
        db.query(QuestionMaterial).filter_by(document_id=document_id).delete()
        db.commit()
        return len(question_ids)

    def delete_bulk(
        self,
        db: Session,
        document_id: Optional[str] = None,
        collection_id: Optional[str] = None,
        question_ids: Optional[list[str]] = None,
    ) -> int:
        q = db.query(QuestionRef)
        if document_id:
            q = q.filter(QuestionRef.document_id == document_id)
        if collection_id:
            q = q.filter(QuestionRef.collection_id == collection_id)
        if question_ids:
            q = q.filter(QuestionRef.question_id.in_(question_ids))
        deleted = q.delete()
        db.commit()
        return deleted

    def page_question_counts(self, db: Session, document_id: str) -> dict[int, int]:
        """各页已入库题目数量。"""
        rows = (
            db.query(QuestionProvenance.page_number, func.count())
            .filter(
                QuestionProvenance.document_id == document_id,
                QuestionProvenance.page_number.isnot(None),
            )
            .group_by(QuestionProvenance.page_number)
            .all()
        )
        return {int(page): int(n) for page, n in rows if page is not None}


# 模块级单例：调用方仍用 question_service.xxx()
question_service = QuestionService()
