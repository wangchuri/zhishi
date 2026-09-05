"""文档导出/导入服务（zip 打包与解包重建）。

书本包格式（version 2）：
  meta.json                 # display_name / page_count / version / include_original
  manifest.json             # 与 storage 一致
  pages/page_001.md ...     # 出题真源（按页）；导入优先用这个
  images/...                # 图床文件（保持原文件名，页内引用可直接用）
  questions.json            # 含 page_number / chapter_id（导入可完整恢复题库）
  learning_path.json        # 可选
  original.{ext}            # 可选：用户勾选「带上原文件」时写入
  thumbnail.png             # 可选
  # 旧包可能还有 parsed.md：仅作无 pages/ 时的兼容回退
"""

from __future__ import annotations

import io
import json
import logging
import re
from pathlib import Path
from typing import Optional

import zipfile
from sqlalchemy.orm import Session

from ..core.errors import AppError, NotFoundError
from ..core.storage import storage
from ..models import (
    Document,
    DocumentImage,
    DocumentLearningPath,
    GlobalQuestion,
    QuestionProvenance,
)
from ..services.kb import _resolve_collection, kb_service
from ..services.question import question_service
from ..utils import parse_tags, sha256_hex

logger = logging.getLogger(__name__)

_PACKAGE_VERSION = 2
_PAGE_HEAD_SPLIT = re.compile(
    r"(?mi)^#{1,3}\s*(?:第\s*(\d+)\s*页|page\s+(\d+))\s*$"
)


def _safe_filename(name: str) -> str:
    return "".join(c for c in (name or "document") if c not in '\\/:*?"<>|').replace(".", "_")


def _split_parsed_into_pages(md_text: str) -> list[str]:
    """旧包只有 parsed.md 时，尽量按「第 N 页」拆回分页。"""
    text = (md_text or "").strip()
    if not text:
        return []
    matches = list(_PAGE_HEAD_SPLIT.finditer(text))
    if not matches:
        return [text]
    pages: list[tuple[int, str]] = []
    for i, m in enumerate(matches):
        page_no = int(m.group(1) or m.group(2))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        pages.append((page_no, text[start:end].strip()))
    pages.sort(key=lambda x: x[0])
    # 按页码填洞：缺页用空串占位，避免页序错乱
    max_no = max(p for p, _ in pages)
    by_no = {n: body for n, body in pages}
    return [by_no.get(i, "") for i in range(1, max_no + 1)]


class ExportService:
    """导出/导入领域服务。"""

    def export_document(
        self,
        db: Session,
        document_id: str,
        *,
        include_original: bool = False,
    ) -> tuple[bytes, str]:
        """导出文档为 zip：pages/ + images/ + questions.json（保留分页）。"""
        doc = db.get(Document, document_id)
        if not doc:
            raise NotFoundError("文档不存在")

        listed = storage.list_pages(doc.id)
        if not listed:
            # 兼容尚未分页的旧文档：用 parsed.md 拆页，拆不出则整本一页
            parsed = storage.read_parsed(doc.id) or ""
            page_bodies = _split_parsed_into_pages(parsed)
            if not page_bodies and not parsed.strip():
                raise AppError("文档没有可导出的内容")
            if not page_bodies:
                page_bodies = [parsed]
        else:
            page_bodies = [path.read_text(encoding="utf-8") for _, path in listed]

        original_path = storage.original_path(doc.id) if include_original else None
        if include_original and original_path is None:
            logger.info("文档 %s 无原文件可导出，将仅导出解析稿", document_id)

        provs = (
            db.query(QuestionProvenance)
            .filter(QuestionProvenance.document_id == document_id)
            .all()
        )
        questions = []
        for p in provs:
            gq = db.get(GlobalQuestion, p.question_id)
            if not gq:
                continue
            questions.append({
                "stem": gq.stem,
                "question_type": gq.question_type,
                "options": json.loads(gq.options) if gq.options else [],
                "answer": gq.answer,
                "explanation": gq.explanation,
                "tags": parse_tags(gq.tags),
                "source_type": gq.source_type,
                "html_content": gq.html_content,
                "answer_params": gq.answer_params,
                "page_number": p.page_number,
                "chapter_id": p.chapter_id,
                "reference_text": p.excerpt or "",
            })

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            meta = {
                "version": _PACKAGE_VERSION,
                "display_name": doc.display_name,
                "file_type": doc.file_type,
                "page_count": len(page_bodies),
                "is_scanned_pdf": bool(doc.is_scanned_pdf),
                "include_original": bool(include_original and original_path is not None),
                "question_count": len(questions),
            }
            zf.writestr("meta.json", json.dumps(meta, ensure_ascii=False, indent=2))

            manifest = {
                "version": 1,
                "total_pages": len(page_bodies),
                "pages_dir": "pages",
            }
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

            for i, body in enumerate(page_bodies, 1):
                zf.writestr(f"pages/page_{i:03d}.md", body)

            imgs = (
                db.query(DocumentImage)
                .filter(DocumentImage.document_id == document_id)
                .all()
            )
            for img in imgs:
                data = storage.read_image(doc.id, img.file_name)
                if data:
                    zf.writestr(f"images/{img.file_name}", data)

            thumb = storage.read_thumbnail(doc.id)
            if thumb:
                zf.writestr("thumbnail.png", thumb)

            zf.writestr(
                "questions.json",
                json.dumps(questions, ensure_ascii=False, indent=2),
            )

            if include_original and original_path is not None and original_path.is_file():
                # 固定名 original.{ext}，导入时原样落盘
                zf.writestr(f"original{original_path.suffix.lower()}", original_path.read_bytes())

            lp = (
                db.query(DocumentLearningPath)
                .filter(DocumentLearningPath.document_id == document_id)
                .first()
            )
            if lp and lp.path_json:
                zf.writestr(
                    "learning_path.json",
                    json.dumps(
                        {
                            "status": lp.status,
                            "path": json.loads(lp.path_json),
                            "model": lp.model,
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                )

        safe_name = _safe_filename(doc.display_name)
        return buf.getvalue(), f"{safe_name}-书本包.zip"


    async def import_package(
        self,
        db: Session,
        content: bytes,
        filename: str,
        collection_id: Optional[str],
    ) -> dict:
        """导入 zip：优先还原 pages/，否则从 parsed.md 拆页。"""
        imported_questions = 0
        reused_questions = 0

        meta: dict = {}
        page_files: dict[int, str] = {}
        md_text = ""
        images: dict[str, bytes] = {}
        questions: list[dict] = []
        learning_path: dict | None = None
        thumbnail: bytes | None = None
        original_name: str | None = None
        original_bytes: bytes | None = None

        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for raw_name in zf.namelist():
                if raw_name.endswith("/"):
                    continue
                name = raw_name.replace("\\", "/")
                # 剥掉可能的顶层目录：Book/pages/x → pages/x
                parts = name.split("/")
                if len(parts) >= 2 and parts[0] not in ("pages", "images"):
                    second = parts[1]
                    if second in (
                        "pages",
                        "images",
                        "parsed.md",
                        "questions.json",
                        "meta.json",
                        "manifest.json",
                        "learning_path.json",
                        "thumbnail.png",
                    ) or second.startswith("original."):
                        name = "/".join(parts[1:])
                base = Path(name).name

                data = zf.read(raw_name)
                if name == "meta.json" or base == "meta.json":
                    try:
                        meta = json.loads(data.decode("utf-8"))
                    except Exception:
                        meta = {}
                elif name.startswith("pages/") and name.endswith(".md"):
                    stem = Path(name).stem
                    try:
                        num = int(stem.split("_")[1])
                    except (IndexError, ValueError):
                        continue
                    page_files[num] = data.decode("utf-8", errors="replace")
                elif name == "parsed.md" or base == "parsed.md":
                    md_text = data.decode("utf-8", errors="replace")
                elif name.startswith("images/"):
                    images[name.split("/", 1)[1]] = data
                elif name == "questions.json" or base == "questions.json":
                    try:
                        questions = json.loads(data.decode("utf-8"))
                    except Exception:
                        questions = []
                elif name == "learning_path.json" or base == "learning_path.json":
                    try:
                        learning_path = json.loads(data.decode("utf-8"))
                    except Exception:
                        learning_path = None
                elif name == "thumbnail.png" or base == "thumbnail.png":
                    thumbnail = data
                elif base.startswith("original.") and "/" not in name.strip("/"):
                    original_name = base
                    original_bytes = data


        page_bodies: list[str] = []
        if page_files:
            max_no = max(page_files)
            page_bodies = [page_files.get(i, "") for i in range(1, max_no + 1)]
        elif md_text.strip():
            page_bodies = _split_parsed_into_pages(md_text)
        if not page_bodies or not any(p.strip() for p in page_bodies):
            raise AppError("zip 中没有 pages/ 分页或可用的 parsed.md")

        joined = "\n\n".join(page_bodies)
        content_hash = sha256_hex(joined.encode("utf-8"))
        col = _resolve_collection(db, collection_id)

        existing_doc = db.query(Document).filter(Document.content_hash == content_hash).first()
        if existing_doc:
            raise AppError("该文件已上传过，请勿重复上传", status_code=409)

        display_name = (
            (meta.get("display_name") if isinstance(meta, dict) else None)
            or Path(filename).stem.replace("-书本包", "").replace("-题库", "")
            or "导入书本"
        )
        if display_name.lower().endswith(".zip"):
            display_name = display_name[:-4]

        doc = Document(
            collection_id=col.id,
            display_name=display_name,
            zone=col.zone,
            content_hash=content_hash,
            file_type=meta.get("file_type") if isinstance(meta, dict) else "md",
            pdf_page_count=len(page_bodies),
            is_scanned_pdf=bool(meta.get("is_scanned_pdf")) if isinstance(meta, dict) else False,
            indexing_status="pending",
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

        # 保留包内图片原名，避免打断 pages 里的 images/xxx 引用
        for idx, (name, data) in enumerate(images.items(), 1):
            safe = Path(name).name
            if not safe:
                continue
            storage.save_image(doc.id, safe, data)
            db.add(
                DocumentImage(
                    document_id=doc.id,
                    page_num=0,
                    image_index=idx,
                    file_name=safe,
                    relative_path=f"images/{safe}",
                )
            )
        db.commit()

        storage.save_pages(doc.id, page_bodies)
        if original_name and original_bytes is not None:
            storage.save_original(doc.id, original_name, original_bytes)
        else:
            storage.save_original(doc.id, f"{display_name}.md", joined.encode("utf-8"))
        if thumbnail:
            storage.save_thumbnail(doc.id, thumbnail)

        try:
            kb_service.segment_document(db, doc)
            doc.segment_status = "completed"
        except Exception as e:
            logger.warning("导入分段失败 doc=%s: %s", doc.id, e)

        try:
            parsed = storage.read_parsed(doc.id) or joined
            if parsed.strip():
                from ..services.rag import chroma_store

                chroma_store.index_document(doc.id, parsed)
        except Exception as e:
            logger.warning("导入向量化失败 doc=%s: %s", doc.id, e)

        if learning_path and isinstance(learning_path, dict):
            path_obj = learning_path.get("path") or learning_path
            try:
                db.add(
                    DocumentLearningPath(
                        document_id=doc.id,
                        path_json=json.dumps(path_obj, ensure_ascii=False),
                        status=str(learning_path.get("status") or "generated"),
                        model=learning_path.get("model"),
                    )
                )
                db.commit()
            except Exception as e:
                db.rollback()
                logger.warning("导入学习路径失败 doc=%s: %s", doc.id, e)

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

        doc.indexing_status = "completed"
        doc.pdf_page_count = len(page_bodies)
        if imported_questions + reused_questions > 0:
            doc.question_gen_status = "completed"
        db.commit()

        return {
            "status": "ok",
            "document_id": doc.id,
            "page_count": len(page_bodies),
            "imported_questions": imported_questions,
            "reused_questions": reused_questions,
            "has_original": bool(original_name and original_bytes is not None),
        }


# 模块级单例
export_service = ExportService()
