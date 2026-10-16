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

from sqlalchemy import inspect as sa_inspect, text as sql_text
from sqlalchemy.orm import Session

from ..core.config import config
from ..core.errors import AppError, NotFoundError
from ..core.storage import storage
from ..models import (
    CompanionMessage,
    CompanionSession,
    Document,
    DocumentImage,
    DocumentLearningPath,
    DocumentSegment,
    GlobalDocument,
    GlobalQuestion,
    KBCollection,
    QuestionProvenance,
    QuestionRef,
    QuizAnswer,
    QuizSession,
    QuizSessionQuestion,
    TutorSession,
    UserNote,
)
from ..utils import image_file_name, sha256_hex
from . import parser
from .mineru import MineruUnavailable, mineru_service
from .question_gen_jobs import question_gen_jobs
from .rag import chroma_store

logger = logging.getLogger(__name__)

_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_pdf_parse(
    content: bytes, *, force_scanned: bool
) -> tuple[bool, str, str, "parser.PdfInspection"]:
    """决定 PDF 怎么解析。

    返回 (use_mineru, parse_method, reason, inspection)。
    - 扫描件（无文本层）→ MinerU，parse_method=auto；
    - 有文本层但公式/结构缺失（可疑）或策略=all → MinerU，parse_method=ocr；
    - 否则 → PyMuPDF。
    """
    inspection = parser.inspect_pdf(content)
    if force_scanned:
        return (
            True,
            "auto" if inspection.is_scanned else "ocr",
            "手动强制 OCR",
            inspection,
        )
    if inspection.is_scanned:
        return True, "auto", "扫描件（无文本层）", inspection
    policy = config.pdf_parse_policy
    if policy == "all":
        return True, "ocr", "策略：全部 PDF 走 MinerU", inspection
    if policy == "smart" and inspection.needs_mineru:
        return True, "ocr", f"可疑：{inspection.reason}", inspection
    return False, "", "", inspection


def _background_parse(doc_id: str, filename: str, content: bytes, collection_id: Optional[str], force_scanned: bool) -> None:
    """后台线程执行文档解析（MinerU 可能耗时数分钟）。

    MinerU 轮询期间不占用 DB 连接，避免拖垮连接池。
    """
    from ..core.database import SessionLocal

    # 重活先在无 Session 下做：扫描 PDF 的 MinerU 可能长达数十分钟
    pre_mineru: dict | None = None
    pre_reason: str | None = None
    blocked_reason: str | None = None
    ext = parser.file_extension(filename)
    try:
        if ext in parser.PDF_EXTENSIONS:
            use_mineru, parse_method, reason, _insp = _resolve_pdf_parse(
                content, force_scanned=force_scanned
            )
            if use_mineru:
                try:
                    logger.info(
                        "后台 MinerU 开始（不占 DB）doc=%s parse_method=%s reason=%s",
                        doc_id,
                        parse_method,
                        reason,
                    )
                    pre_mineru = mineru_service.parse_pdf(content, parse_method=parse_method)
                    pre_reason = reason
                except MineruUnavailable as exc:
                    # 需要 OCR 但本机不可用：排队等待，不算失败
                    blocked_reason = f"{reason}（等待 OCR：{exc.message}）"
    except Exception as e:
        logger.warning("后台 MinerU 失败 doc=%s: %s", doc_id, e)
        db = SessionLocal()
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
        return

    if blocked_reason is not None:
        # 需要 OCR 但本机 MinerU 不可用：排队等待，不占资源、不自动重试
        db = SessionLocal()
        try:
            doc = db.query(Document).filter(Document.id == doc_id).first()
            if doc:
                doc.indexing_status = "blocked"
                doc.parse_reason = blocked_reason
                doc.updated_at = datetime.now(timezone.utc)
                db.commit()
                logger.info("文档等待 OCR（MinerU 未就绪）doc=%s", doc_id)
        finally:
            db.close()
        return

    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            return
        kb = KnowledgeBaseService()
        if pre_mineru is not None:
            pages_md = pre_mineru["page_mds"]
            all_images = pre_mineru["images"] or {}
            name_map = kb._persist_mineru_images_once(db, doc, all_images)
            rewritten_pages: list[str] = []
            for p in pages_md:
                rewritten = kb._apply_image_refs(p["markdown"], name_map)
                rewritten_pages.append(rewritten)
                p["markdown"] = rewritten
            storage.save_pages(doc.id, rewritten_pages)
            doc.is_scanned_pdf = True
            doc.parse_reason = pre_reason
        else:
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

        if doc.zone == "study":
            try:
                from ..agents.learning_path_agent import schedule_learning_path

                def _schedule():
                    try:
                        schedule_learning_path(doc_id)
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
    """在后台执行：统一走有界 worker，避免"随用随开裸线程"把并发打满。

    以前这里是直接 threading.Thread(...)，几个大活一起来就会同时读大文件、
    抢 SQLite 写。现在由 services/jobs.py 统一限并发（见 JOB_MAX_WORKERS）。
    """
    from .jobs import jobs

    jobs.spawn(fn, *args)


def ensure_default_collections(db: Session) -> None:
    """确保默认学习区/生活区存在。"""
    if db.query(KBCollection).first() is None:
        study = KBCollection(name="学习区", zone="study", is_default=True)
        life = KBCollection(name="生活区", zone="life")
        db.add_all([study, life])
        db.commit()


def resume_interrupted_parses(db: Session) -> tuple[int, int]:
    """进程启动时处理「中断的解析」：优先重新入队，而不是一律标失败。

    背景：解析跑在后台线程里，进程一重启线程就没了；而文档行可能停在
    pending（线程还没起）或 processing（跑到一半）。旧实现只把 processing
    标成 failed，pending 则永远显示「排队中」，既没有线程也没有出口。

    返回 (重新入队数, 判失败数)：
    - 原文件还在       → 重新起线程解析（结果覆盖写，可重入）
    - 原文件缺失/读不出 → 标 failed，别再假装在排队
    """
    rows = (
        db.query(Document)
        .filter(Document.indexing_status.in_(("pending", "processing")))
        .all()
    )
    if not rows:
        return (0, 0)

    requeued = 0
    failed = 0
    for doc in rows:
        path = storage.original_path(doc.id)
        content: bytes | None = None
        if path is not None and path.is_file():
            try:
                content = path.read_bytes()
            except Exception:
                content = None
        if not content:
            doc.indexing_status = "failed"
            doc.parse_reason = "重启导致解析中断，且原文件缺失，请删除后重新上传"
            doc.updated_at = datetime.now(timezone.utc)
            failed += 1
            continue
        doc.indexing_status = "processing"
        doc.parse_reason = None
        doc.updated_at = datetime.now(timezone.utc)
        db.commit()
        _spawn_background(
            _background_parse,
            doc.id,
            path.name if path is not None else doc.display_name,
            content,
            doc.collection_id,
            bool(doc.is_scanned_pdf),
        )
        requeued += 1
    db.commit()
    return (requeued, failed)


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
            # 同 ingest_upload：本函数在请求内同步完成解析，直接写 processing，
            # 不要留下「已入库但没人在解析」的 pending 中间态
            indexing_status="processing",
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
        group_id: Optional[str] = None,
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
            # 直接写 processing：以前是先落 pending、等文件落盘后才改 processing 并起线程，
            # 那个窗口里数据库写着「排队中」但根本没人干活 —— 请求一旦在这窗口里中断
            # 或进程被杀，文档就永久卡在 pending（无线程、也没有任何重试能救）。
            indexing_status="processing",
        )
        if not doc.id:
            from ..utils import new_id

            doc.id = new_id()
        if group_id:
            from .doc_group import doc_group_service

            doc_group_service.assign_doc(db, doc, group_id)
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

    def reparse_document(
        self,
        db: Session,
        doc_id: str,
        *,
        force_scanned: bool = False,
    ) -> Document:
        """用当前策略重新解析已入库文档：覆盖解析稿/分段/向量索引。

        旧的分段与图片注册表先清空；原始文件已在库时直接复用。
        """
        doc = self.get_document(db, doc_id)
        content = storage.read_original(doc_id)
        if not content:
            raise AppError("原始文件不存在，无法重新解析")

        # 旧分段将被替换：先解除挂在分段上的引用（旧库对 document_segments 有外键约束）
        existing_tables = set(sa_inspect(db.get_bind()).get_table_names())
        for table in ("question_provenance", "user_question_refs", "tutor_sessions"):
            if table in existing_tables:
                db.execute(
                    sql_text(f"UPDATE {table} SET segment_id = NULL WHERE document_id = :d"),
                    {"d": doc_id},
                )
        db.query(DocumentSegment).filter(DocumentSegment.document_id == doc_id).delete(
            synchronize_session=False
        )
        db.query(DocumentImage).filter(DocumentImage.document_id == doc_id).delete(
            synchronize_session=False
        )
        doc.indexing_status = "processing"
        doc.segment_status = "not_started"
        doc.is_scanned_pdf = False
        doc.parse_reason = None
        doc.pdf_page_count = None
        doc.updated_at = datetime.now(timezone.utc)
        db.commit()

        _spawn_background(
            _background_parse,
            doc_id,
            doc.display_name,
            content,
            doc.collection_id,
            force_scanned,
        )
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
            use_mineru, parse_method, reason, inspection = _resolve_pdf_parse(
                content, force_scanned=force_scanned
            )
            text, pages = inspection.text, inspection.pages
            if use_mineru:
                try:
                    mineru = mineru_service.parse_pdf(content, parse_method=parse_method)
                except MineruUnavailable as exc:
                    doc.indexing_status = "blocked"
                    doc.parse_reason = f"{reason}（等待 OCR：{exc.message}）"
                    doc.updated_at = datetime.now(timezone.utc)
                    return result
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
                doc.parse_reason = reason
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

    def reindex_vectors(self, db: Session, *, document_id: Optional[str] = None) -> int:
        """用当前 embedding 重建向量索引（更换嵌入实现后调用）。返回处理的文档数。"""
        q = db.query(Document).filter(Document.indexing_status == "completed")
        if document_id:
            q = q.filter(Document.id == document_id)
        done = 0
        for doc in q.all():
            text = storage.read_parsed(doc.id) or ""
            if not text.strip():
                continue
            try:
                chroma_store.index_document(doc.id, text)
                done += 1
            except Exception as e:
                logger.warning("重建向量失败 doc=%s: %s", doc.id, e)
        return done

    def retry_blocked(self, db: Session, *, document_id: Optional[str] = None) -> int:
        """把「等待 OCR」的文档重新入队解析（MinerU 就绪后调用）。返回入队数量。"""
        q = db.query(Document).filter(Document.indexing_status == "blocked")
        if document_id:
            q = q.filter(Document.id == document_id)
        n = 0
        for doc in q.all():
            content = storage.read_original(doc.id)
            if not content:
                doc.indexing_status = "failed"
                doc.parse_reason = "原始文件不存在，无法重试"
                db.commit()
                continue
            doc.indexing_status = "processing"
            doc.updated_at = datetime.now(timezone.utc)
            db.commit()
            _spawn_background(
                _background_parse, doc.id, doc.display_name, content, doc.collection_id, False
            )
            n += 1
        return n

    def retry_stuck(self, db: Session, *, document_id: Optional[str] = None) -> int:
        """重试「卡住」的解析（前端 banner 的「重试」按钮）。

        - blocked：等 OCR，MinerU 就绪后重排（等同 retry_blocked）
        - pending：说明线程压根没起来过，直接重排（现在新数据不会再出现这个态）
        - processing：可能真的还在跑，所以只在 updated_at 超过 10 分钟才重排，
          避免把正在解析的文档重复跑一遍
        """
        n = self.retry_blocked(db, document_id=document_id)

        stuck_seconds = 10 * 60
        now = datetime.now(timezone.utc)
        q = db.query(Document).filter(
            Document.indexing_status.in_(("pending", "processing"))
        )
        if document_id:
            q = q.filter(Document.id == document_id)
        for doc in q.all():
            if doc.indexing_status == "processing" and doc.updated_at is not None:
                updated = doc.updated_at
                if updated.tzinfo is None:
                    updated = updated.replace(tzinfo=timezone.utc)
                if (now - updated).total_seconds() < stuck_seconds:
                    continue
            content = storage.read_original(doc.id)
            if not content:
                doc.indexing_status = "failed"
                doc.parse_reason = "原始文件不存在，无法重试"
                db.commit()
                continue
            doc.indexing_status = "processing"
            doc.parse_reason = None
            doc.updated_at = now
            db.commit()
            _spawn_background(
                _background_parse, doc.id, doc.display_name, content, doc.collection_id, False
            )
            n += 1
        return n

    # ---- 查询 ----

    def list_documents(
        self,
        db: Session,
        page: int = 1,
        limit: int = 20,
        collection_id: Optional[str] = None,
        *,
        group_id: Optional[str] = None,
        ungrouped_only: bool = False,
    ) -> dict:
        q = db.query(Document)
        if collection_id:
            q = q.filter(Document.collection_id == collection_id)
        if group_id:
            q = q.filter(Document.group_id == group_id)
        elif ungrouped_only:
            q = q.filter(Document.group_id.is_(None))
        total = q.count()
        docs = q.order_by(Document.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
        return {"documents": docs, "total": total, "page": page, "limit": limit}

    def list_active_tasks(self, db: Session, limit: int = 50) -> list[dict]:
        """全局解析/上传任务：仍待处理（pending/processing）或等待 OCR（blocked）的文档。"""
        rows = (
            db.query(Document)
            .filter(Document.indexing_status.in_(("pending", "processing", "blocked")))
            .order_by(Document.updated_at.desc())
            .limit(limit)
            .all()
        )
        col_names = {c.id: c.name for c in db.query(KBCollection).all()}
        return [
            {
                "id": d.id,
                "name": d.display_name,
                "file_type": d.file_type or "txt",
                "status": d.indexing_status,
                "is_scanned_pdf": bool(d.is_scanned_pdf),
                "parse_reason": d.parse_reason,
                "collection_id": d.collection_id,
                "collection_name": col_names.get(d.collection_id),
                "zone": d.zone,
                "updated_at": d.updated_at,
            }
            for d in rows
        ]

    def get_document(self, db: Session, doc_id: str) -> Document:
        doc = db.get(Document, doc_id)
        if not doc:
            raise NotFoundError("文档不存在")
        return doc

    def delete_document(self, db: Session, doc_id: str) -> None:
        """删除资料及其全部关联：分段/图片、题库引用、刷题会话、伴学、Tip、学习路径、文件与向量。"""
        doc = self.get_document(db, doc_id)

        # 刷题会话 → 答题 / 会话题目
        session_ids = [
            sid
            for (sid,) in db.query(QuizSession.id)
            .filter(QuizSession.document_id == doc_id)
            .all()
        ]
        if session_ids:
            db.query(QuizAnswer).filter(QuizAnswer.session_id.in_(session_ids)).delete(
                synchronize_session=False
            )
            db.query(QuizSessionQuestion).filter(
                QuizSessionQuestion.session_id.in_(session_ids)
            ).delete(synchronize_session=False)
            db.query(QuizSession).filter(QuizSession.id.in_(session_ids)).delete(
                synchronize_session=False
            )

        db.query(TutorSession).filter(TutorSession.document_id == doc_id).delete(
            synchronize_session=False
        )

        # 伴学
        companion = (
            db.query(CompanionSession).filter(CompanionSession.document_id == doc_id).first()
        )
        if companion:
            db.query(CompanionMessage).filter(
                CompanionMessage.session_id == companion.id
            ).delete(synchronize_session=False)
            db.delete(companion)

        # Tip / 笔记（挂在该资料上的）
        db.query(UserNote).filter(UserNote.document_id == doc_id).delete(
            synchronize_session=False
        )

        db.query(DocumentLearningPath).filter(
            DocumentLearningPath.document_id == doc_id
        ).delete(synchronize_session=False)

        # 题库：溯源 + 文档级引用；仅当全局题不再被其它资料引用时才删掉 GlobalQuestion
        provs = (
            db.query(QuestionProvenance)
            .filter(QuestionProvenance.document_id == doc_id)
            .all()
        )
        question_ids = {p.question_id for p in provs}
        db.query(QuestionProvenance).filter(
            QuestionProvenance.document_id == doc_id
        ).delete(synchronize_session=False)
        db.query(QuestionRef).filter(QuestionRef.document_id == doc_id).delete(
            synchronize_session=False
        )
        for qid in question_ids:
            still = (
                db.query(QuestionProvenance)
                .filter(QuestionProvenance.question_id == qid)
                .count()
            )
            still_ref = (
                db.query(QuestionRef).filter(QuestionRef.question_id == qid).count()
            )
            if still == 0 and still_ref == 0:
                gq = db.get(GlobalQuestion, qid)
                if gq:
                    db.delete(gq)

        db.query(DocumentSegment).filter(DocumentSegment.document_id == doc_id).delete(
            synchronize_session=False
        )
        db.query(DocumentImage).filter(DocumentImage.document_id == doc_id).delete(
            synchronize_session=False
        )
        db.delete(doc)
        db.commit()

        try:
            question_gen_jobs.discard_by_document(doc_id)
        except Exception as je:
            logger.warning("清理出题任务失败 doc=%s: %s", doc_id, je)

        storage.delete_document(doc_id)
        storage.delete_thumbnail(doc_id)
        try:
            chroma_store.delete_document_index(doc_id)
        except Exception as ie:
            logger.warning("删除向量索引失败 doc=%s: %s", doc_id, ie)


# 模块级单例：调用方仍用 kb_service.xxx()
kb_service = KnowledgeBaseService()
