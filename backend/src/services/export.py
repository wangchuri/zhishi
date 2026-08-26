"""文档导出/导入服务（zip 打包与解包重建）。"""

from __future__ import annotations

import io
import json
import zipfile
from typing import Optional

from sqlalchemy.orm import Session

from ..core.errors import AppError, NotFoundError
from ..core.storage import storage
from ..models import Document, DocumentImage, GlobalQuestion, QuestionProvenance, QuestionRef
from ..services.kb import kb_service
from ..utils import parse_tags
from ..services.question import question_service


class ExportService:
    """导出/导入领域服务。"""

    def export_document(self, db: Session, document_id: str) -> tuple[bytes, str]:
        """导出文档为 zip：parsed.md + images/ + questions.json。"""
        doc = db.get(Document, document_id)
        if not doc:
            raise NotFoundError("文档不存在")

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            parsed = storage.read_parsed(doc.id) or ""
            zf.writestr("parsed.md", parsed)

            imgs = db.query(DocumentImage).filter(DocumentImage.document_id == document_id).all()
            for img in imgs:
                data = storage.read_image(doc.id, img.file_name)
                if data:
                    zf.writestr(f"images/{img.file_name}", data)

            provs = db.query(QuestionProvenance).filter(QuestionProvenance.document_id == document_id).all()
            questions = []
            for p in provs:
                gq = db.get(GlobalQuestion, p.question_id)
                if gq:
                    questions.append({
                        "stem": gq.stem,
                        "question_type": gq.question_type,
                        "options": json.loads(gq.options) if gq.options else [],
                        "answer": gq.answer,
                        "explanation": gq.explanation,
                        "tags": parse_tags(gq.tags),
                        "source_type": gq.source_type,
                    })
            zf.writestr("questions.json", json.dumps(questions, ensure_ascii=False, indent=2))

        safe_name = "".join(c for c in doc.display_name if c not in '\\/:*?"<>|').replace(".", "_")
        return buf.getvalue(), f"{safe_name}.zip"

    async def import_package(
        self,
        db: Session,
        content: bytes,
        filename: str,
        collection_id: Optional[str],
    ) -> dict:
        """导入 zip 包：parsed.md + images/ + questions.json → 重建文档。"""
        imported_questions = 0
        reused_questions = 0

        md_text = ""
        images: dict[str, bytes] = {}
        questions: list[dict] = []

        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for name in zf.namelist():
                if name.endswith("/"):
                    continue
                if name == "parsed.md":
                    md_text = zf.read(name).decode("utf-8", errors="replace")
                elif name.startswith("images/"):
                    images[name.split("/", 1)[1]] = zf.read(name)
                elif name == "questions.json":
                    try:
                        questions = json.loads(zf.read(name).decode("utf-8"))
                    except Exception:
                        questions = []

        if not md_text.strip():
            raise AppError("zip 中没有 parsed.md")

        doc = kb_service.ingest_md_text(
            db,
            filename=filename.replace(".zip", ".md"),
            md_text=md_text,
            images_map=images,
            collection_id=collection_id,
        )

        for q in questions:
            try:
                _gq, is_new = question_service.store_question(db, doc, q)
                db.commit()
                if is_new:
                    imported_questions += 1
                else:
                    reused_questions += 1
            except Exception:
                db.rollback()

        return {
            "status": "ok",
            "document_id": doc.id,
            "imported_questions": imported_questions,
            "reused_questions": reused_questions,
        }


# 模块级单例
export_service = ExportService()
