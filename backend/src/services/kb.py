"""知识库服务：上传入库、解析分发、图片落图床、分段、查询。

KnowledgeBaseService 持有知识库领域逻辑；模块级保留 ensure_default_collections
（启动种子）与 _resolve_collection / _now_iso helper。
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from ..core.errors import AppError, NotFoundError
from ..core.storage import storage
from ..models import (
    Document,
    DocumentImage,
    DocumentSegment,
    GlobalDocument,
    KBCollection,
)
from ..utils import image_file_name, sha256_hex
from . import parser
from .mineru import mineru_service
from .rag import chroma_store

logger = logging.getLogger(__name__)

_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _background_parse(doc_id: str, filename: str, content: bytes, collection_id: Optional[str], force_scanned: bool) -> None:
    """后台线程执行文档解析（MinerU 可能耗时数分钟）。"""
    from ..core.database import SessionLocal

    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            return
        kb = KnowledgeBaseService()
        kb._parse_and_ingest(db, doc, content, force_scanned=force_scanned)
        doc.indexing_status = "completed"
        doc.pdf_page_count = len(storage.list_pages(doc_id))
        kb.segment_document(db, doc)
        doc.segment_status = "completed"
        doc.updated_at = datetime.now(timezone.utc)
        db.commit()
        parsed_text = storage.read_parsed(doc_id) or ""
        if parsed_text.strip():
            try:
                chroma_store.index_document(doc_id, parsed_text)
            except Exception as ie:
                logger.warning("向量化失败 doc=%s: %s", doc_id, ie)
        logger.info("后台解析完成 doc=%s", doc_id)
        try:
            from .task import evaluate
            evaluate(db)
        except Exception as te:
            logger.warning("任务检查失败 doc=%s: %s", doc_id, te)

        # 解析完成后异步调度学习路径 Agent
        if doc.zone == "study":
            try:
                import asyncio
                from ..agents.learning_path_agent import schedule_learning_path

                # 后台线程无事件循环，用新线程跑 asyncio
                def _schedule():
                    try:
                        asyncio.run(schedule_learning_path(doc_id))
                    except Exception as le:
                        logger.warning("后台调度学习路径失败 doc=%s: %s", doc_id, le)

                _spawn_background(_schedule)
            except Exception as le:
                logger.warning("调度学习路径失败 doc=%s: %s", doc_id, le)
    except Exception as e:
        logger.warning("后台解析失败 doc=%s: %s", doc_id, e)
        try:
            doc = db.query(Document).filter(Document.id == doc_id).first()
            if doc:
                doc.indexing_status = "failed"
                doc.updated_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def _spawn_background(fn, *args) -> None:
    """在后台线程执行。"""
    import threading

    t = threading.Thread(target=fn, args=args, daemon=True)
    t.start()


def ensure_default_collections(db: Session) -> None:
    """确保默认学习区/生活区存在。"""
    if db.query(KBCollection).first() is None:
        study = KBCollection(name="学习区", zone="study", is_default=True)
        life = KBCollection(name="生活区", zone="life")
        db.add_all([study, life])
        db.commit()


def reset_stale_processing(db: Session) -> int:
    """进程重启后后台解析线程已不在，把仍标记 processing 的文档标为失败。"""
    rows = db.query(Document).filter(Document.indexing_status == "processing").all()
    if not rows:
        return 0
    for doc in rows:
        doc.indexing_status = "failed"
        doc.updated_at = datetime.now(timezone.utc)
    db.commit()
    return len(rows)


def _resolve_collection(db: Session, collection_id: Optional[str]) -> KBCollection:
    if collection_id:
        col = db.get(KBCollection, collection_id)
        if not col:
            raise AppError("集合不存在")
        return col
    col = db.query(KBCollection).filter(KBCollection.zone == "study").first()
    if not col:
        col = KBCollection(name="默认", zone="study")
        db.add(col)
        db.commit()
    return col


class KnowledgeBaseService:
    """知识库领域服务。"""

    # 是否在解析完成后自动调度学习路径 Agent（由 api 层设置）
    AUTO_LEARNING_PATH = True

    # ---- 集合 ----

    def list_collections(self, db: Session) -> list[KBCollection]:
        return db.query(KBCollection).order_by(KBCollection.created_at).all()

    def create_collection(self, db: Session, name: str, zone: str = "study", description: Optional[str] = None) -> KBCollection:
        col = KBCollection(name=name, zone=zone, description=description)
        db.add(col)
        db.commit()
        db.refresh(col)
        return col

    def update_collection(self, db: Session, collection_id: str, name: Optional[str], description: Optional[str]) -> KBCollection:
        col = db.get(KBCollection, collection_id)
        if not col:
            raise NotFoundError("集合不存在")
        if name is not None:
            col.name = name
        if description is not None:
            col.description = description
        db.commit()
        db.refresh(col)
        return col

    # ---- 文档上传 ----

    def ingest_md_text(
        self,
        db: Session,
        *,
        filename: str,
        md_text: str,
        images_map: dict[str, bytes] | None = None,
        collection_id: Optional[str] = None,
    ) -> Document:
        """导入 markdown 文本（含图片）：落图床 + 改写引用 + 注册 + 入库 + 分段 + 向量化。

        用于 doc-parse 工坊（MinerU 解析结果导入）与 md.zip 导入。
        """
        content = md_text.encode("utf-8")
        content_hash = sha256_hex(content)
        col = _resolve_collection(db, collection_id)

        existing_doc = db.query(Document).filter(Document.content_hash == content_hash).first()
        if existing_doc:
            raise AppError("该文件已上传过，请勿重复上传", status_code=409)

        doc = Document(
            collection_id=col.id,
            display_name=filename,
            zone=col.zone,
            content_hash=content_hash,
            file_type="md",
            indexing_status="pending",
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

        # 保存 md 文本 + 原始文件
        storage.save_parsed(doc.id, md_text)
        storage.save_original(doc.id, filename, content)

        # 图片落图床 + 改写引用 + 注册
        md_final = md_text
        for idx, (name, data) in enumerate((images_map or {}).items(), 1):
            ext = Path(name).suffix or ".png"
            new_name = image_file_name(Path(filename).stem, 0, idx, ext.lstrip("."))
            storage.save_image(doc.id, new_name, data)
            db.add(DocumentImage(
                document_id=doc.id, page_num=0, image_index=idx,
                file_name=new_name, relative_path=f"images/{new_name}",
            ))
            md_final = md_final.replace(name, f"images/{new_name}")
            md_final = md_final.replace(f"images/images/{new_name}", f"images/{new_name}")
        db.commit()
        storage.save_parsed(doc.id, md_final)

        # 分段 + 向量化
        try:
            self.segment_document(db, doc)
            doc.segment_status = "completed"
        except Exception as e:
            logger.warning("分段失败 doc=%s: %s", doc.id, e)
        try:
            if md_final.strip():
                chroma_store.index_document(doc.id, md_final)
        except Exception as e:
            logger.warning("向量化失败 doc=%s: %s", doc.id, e)

        doc.indexing_status = "completed"
        db.commit()
        return doc

    def ingest_upload(
        self,
        db: Session,
        *,
        filename: str,
        content: bytes,
        collection_id: Optional[str] = None,
        force_scanned: bool = False,
        async_parse: bool = False,
    ) -> Document:
        """上传入库：全局去重 + 存储 + 解析分发。async_parse=True 时解析放后台。"""
        ext = parser.file_extension(filename)
        if ext not in parser.SUPPORTED_EXTENSIONS:
            raise AppError(f"不支持的文件类型: {ext}")

        content_hash = sha256_hex(content)
        col = _resolve_collection(db, collection_id)

        # 全局文件去重
        existing_doc = db.query(Document).filter(Document.content_hash == content_hash).first()
        if existing_doc:
            raise AppError("该文件已上传过，请勿重复上传", status_code=409)

        global_doc = db.query(GlobalDocument).filter(GlobalDocument.content_hash == content_hash).first()

        doc = Document(
            collection_id=col.id,
            global_document_id=global_doc.id if global_doc else None,
            display_name=filename,
            zone=col.zone,
            content_hash=content_hash,
            file_type=parser.detect_file_type(filename),
            indexing_status="pending",
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

        # 保存原始文件到文档文件夹
        storage.save_original(doc.id, filename, content)
        if not global_doc:
            original_path = storage.original_path(doc.id)
            gpath = original_path if original_path else storage.save_original(doc.id, filename, content)
            global_doc = GlobalDocument(
                content_hash=content_hash,
                original_filename=filename,
                mime_type=ext,
                file_size=len(content),
                storage_path=str(gpath),
            )
            db.add(global_doc)
            db.commit()
            doc.global_document_id = global_doc.id
            db.commit()

        # 解析分发：async_parse=True 时后台执行（扫描件可能耗时数分钟），立即返回 pending
        if async_parse:
            doc.indexing_status = "processing"
            if force_scanned:
                doc.is_scanned_pdf = True
            doc.updated_at = datetime.now(timezone.utc)
            db.commit()
            _spawn_background(
                _background_parse,
                doc.id,
                filename,
                content,
                collection_id,
                force_scanned,
            )
            return doc

        try:
            result = self._parse_and_ingest(db, doc, content, force_scanned=force_scanned)
            doc.indexing_status = "completed"
            doc.pdf_page_count = len(result.get("pages", [])) if result.get("pages") else None
            self.segment_document(db, doc)
            doc.segment_status = "completed"
            parsed_text = storage.read_parsed(doc.id) or ""
            if parsed_text.strip():
                try:
                    chroma_store.index_document(doc.id, parsed_text)
                except Exception as ie:
                    logger.warning("向量化失败 doc=%s: %s", doc.id, ie)
        except Exception as e:
            doc.indexing_status = "failed"
            doc.updated_at = datetime.now(timezone.utc)
            db.commit()
            raise AppError(f"解析失败: {e}") from e

        doc.updated_at = datetime.now(timezone.utc)
        db.commit()
        return doc

    def _parse_and_ingest(
        self,
        db: Session,
        doc: Document,
        content: bytes,
        *,
        force_scanned: bool = False,
    ) -> dict:
        """解析 + 图片落图床 + 图片注册表 + 分段。"""
        ext = parser.file_extension(doc.display_name)
        result: dict = {"pages": [], "images": {}}

        # 1) md.zip：解压 md + 图片
        if ext in parser.ZIP_EXTENSIONS:
            md_text, zip_images = parser.parse_zip_markdown(content)
            self._ingest_md_with_images(db, doc, md_text, zip_images, page_num=0)
            result["pages"] = []
            return result

        # 2) 图片文件 / 扫描 PDF → MinerU
        is_image = ext in parser.IMAGE_EXTENSIONS
        if is_image:
            img_name = image_file_name(Path(doc.display_name).stem, 1, 1, ext.lstrip("."))
            storage.save_image(doc.id, img_name, content)
            db.add(DocumentImage(
                document_id=doc.id, page_num=1, image_index=1,
                file_name=img_name, relative_path=f"images/{img_name}",
            ))
            db.commit()
            storage.save_parsed(doc.id, f"![image](images/{img_name})")
            return result

        # 3) PDF
        if ext in parser.PDF_EXTENSIONS:
            text, pages = parser.parse_pdf_text(content)
            is_scanned = force_scanned or parser.is_pdf_scanned(content) or not text.strip()
            if is_scanned:
                mineru = mineru_service.parse_pdf(content)
                pages_md = mineru["page_mds"]
                all_images = mineru["images"] or {}
                name_map = self._persist_mineru_images_once(db, doc, all_images)
                rewritten_pages: list[str] = []
                for p in pages_md:
                    rewritten = self._apply_image_refs(p["markdown"], name_map)
                    rewritten_pages.append(rewritten)
                    p["markdown"] = rewritten
                storage.save_pages(doc.id, rewritten_pages)
                result["pages"] = pages_md
                doc.is_scanned_pdf = True
                return result
            if pages:
                storage.save_pages(doc.id, pages)
                result["pages"] = [{"page": i + 1, "markdown": t} for i, t in enumerate(pages)]
            else:
                storage.save_parsed(doc.id, text)
            return result

        # 4) docx / 文本类
        if ext in parser.RICH_EXTENSIONS:
            md_text = parser.parse_docx_bytes(content)
        else:
            md_text = parser.parse_text_bytes(content, ext)
        self._ingest_md_with_images(db, doc, md_text, {}, page_num=0)
        storage.save_parsed(doc.id, md_text)
        return result

    def _ingest_md_with_images(
        self,
        db: Session,
        doc: Document,
        md_text: str,
        zip_images: dict[str, bytes],
        *,
        page_num: int,
    ) -> None:
        """md 文本入库：zip 附带图片落图床并改写引用。"""
        if not zip_images:
            return
        for idx, (name, data) in enumerate(zip_images.items(), 1):
            ext = Path(name).suffix
            new_name = image_file_name(doc.display_name, page_num, idx, ext.lstrip("."))
            storage.save_image(doc.id, new_name, data)
            db.add(DocumentImage(
                document_id=doc.id, page_num=page_num, image_index=idx,
                file_name=new_name, relative_path=f"images/{new_name}",
            ))
            md_text = md_text.replace(f"images/{name}", f"images/{new_name}")
            md_text = md_text.replace(name, f"images/{new_name}")
        db.commit()
        storage.save_parsed(doc.id, md_text)

    def _persist_mineru_images_once(
        self,
        db: Session,
        doc: Document,
        images: dict[str, bytes],
    ) -> dict[str, str]:
        """全书图片只落盘一次，返回 MinerU 原文件名 → 图床文件名。"""
        name_map: dict[str, str] = {}
        for idx, (name, data) in enumerate(images.items(), 1):
            ext = Path(name).suffix or ".png"
            new_name = image_file_name(doc.display_name, 0, idx, ext.lstrip("."))
            storage.save_image(doc.id, new_name, data)
            db.add(DocumentImage(
                document_id=doc.id, page_num=0, image_index=idx,
                file_name=new_name, relative_path=f"images/{new_name}",
            ))
            name_map[name] = new_name
            name_map[Path(name).name] = new_name
        db.commit()
        return name_map

    def _apply_image_refs(self, md_text: str, name_map: dict[str, str]) -> str:
        """只改 markdown 引用，不再写盘。"""
        for old, new in name_map.items():
            md_text = md_text.replace(f"images/{old}", f"images/{new}")
            md_text = md_text.replace(old, f"images/{new}")
            md_text = md_text.replace(f"images/images/{new}", f"images/{new}")
        return md_text

    def _rewrite_md_images(
        self,
        db: Session,
        doc: Document,
        md_text: str,
        page_images: dict[str, bytes],
        *,
        page_num: int,
    ) -> str:
        """MinerU 该页图片：落图床 + 注册 + 改写引用。返回改写后的 md。"""
        for idx, (name, data) in enumerate(page_images.items(), 1):
            ext = Path(name).suffix or ".png"
            new_name = image_file_name(doc.display_name, page_num, idx, ext.lstrip("."))
            storage.save_image(doc.id, new_name, data)
            db.add(DocumentImage(
                document_id=doc.id, page_num=page_num, image_index=idx,
                file_name=new_name, relative_path=f"images/{new_name}",
            ))
            md_text = md_text.replace(name, f"images/{new_name}")
            md_text = md_text.replace(f"images/images/{new_name}", f"images/{new_name}")
        db.commit()
        return md_text

    # ---- 分段 ----

    def segment_document(self, db: Session, doc: Document) -> int:
        """文档分段：按标题切分，写 document_segments。返回段数。"""
        text = storage.read_parsed(doc.id) or ""
        if not text.strip():
            return 0

        db.query(DocumentSegment).filter(DocumentSegment.document_id == doc.id).delete()

        lines = text.splitlines()
        sections: list[list[str]] = []
        current: list[str] = []

        def flush():
            if current and any(l.strip() for l in current):
                sections.append(list(current))
                current.clear()

        for line in lines:
            stripped = line.strip()
            if re.match(r"^#{1,6}\s", stripped):
                flush()
            current.append(line)
        flush()

        if not sections:
            sections = [lines]

        for i, section in enumerate(sections):
            content = "\n".join(section).strip()
            if not content:
                continue
            title = None
            for line in section:
                m = re.match(r"^#{1,6}\s+(.*)", line.strip())
                if m:
                    title = m.group(1).strip()
                    break
            db.add(DocumentSegment(
                document_id=doc.id,
                order_index=i,
                title=title,
                content=content,
                char_start=0,
                char_end=len(content),
            ))

        db.commit()
        return len(sections)

    # ---- 查询 ----

    def list_documents(
        self,
        db: Session,
        page: int = 1,
        limit: int = 20,
        collection_id: Optional[str] = None,
    ) -> dict:
        q = db.query(Document)
        if collection_id:
            q = q.filter(Document.collection_id == collection_id)
        total = q.count()
        docs = q.order_by(Document.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
        return {"documents": docs, "total": total, "page": page, "limit": limit}

    def get_document(self, db: Session, doc_id: str) -> Document:
        doc = db.get(Document, doc_id)
        if not doc:
            raise NotFoundError("文档不存在")
        return doc

    def delete_document(self, db: Session, doc_id: str) -> None:
        doc = self.get_document(db, doc_id)
        db.query(DocumentSegment).filter(DocumentSegment.document_id == doc_id).delete()
        db.query(DocumentImage).filter(DocumentImage.document_id == doc_id).delete()
        db.delete(doc)
        db.commit()
        storage.delete_document(doc_id)
        storage.delete_thumbnail(doc_id)
        try:
            chroma_store.delete_document_index(doc_id)
        except Exception as ie:
            logger.warning("删除向量索引失败 doc=%s: %s", doc_id, ie)


# 模块级单例：调用方仍用 kb_service.xxx()
kb_service = KnowledgeBaseService()
