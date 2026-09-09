"""知识库 API：集合 CRUD、上传、文档列表/状态/内容/文件/分段/页、图片、缩略图。"""

from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..core.config import config
from ..core.database import get_db
from ..core.errors import AppError
from ..core.storage import storage
from ..models import Document, DocumentImage, DocumentLearningPath, DocumentSegment
from ..schemas import kb as kb_schemas
from ..services.kb import kb_service
from ..services.question import question_service
from ..services.thumbnail import thumb_service
from ..services.export import export_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/kb", tags=["kb"])


@router.get("/collections", response_model=kb_schemas.CollectionList)
def list_collections(db: Session = Depends(get_db)):
    cols = kb_service.list_collections(db)
    return {
        "collections": [kb_schemas.KbCollection(**vars(c)) for c in cols],
        "total": len(cols),
    }


@router.post("/collections", response_model=kb_schemas.KbCollection)
def create_collection(body: kb_schemas.CollectionCreate, db: Session = Depends(get_db)):
    col = kb_service.create_collection(db, body.name, body.zone, body.description)
    return kb_schemas.KbCollection(**vars(col))


@router.patch("/collections/{collection_id}", response_model=kb_schemas.KbCollection)
def update_collection(collection_id: str, body: kb_schemas.CollectionUpdate, db: Session = Depends(get_db)):
    col = kb_service.update_collection(db, collection_id, body.name, body.description)
    return kb_schemas.KbCollection(**vars(col))


@router.post("/upload", response_model=kb_schemas.UploadResult)
async def upload(
    file: UploadFile = File(...),
    collection_id: Optional[str] = Form(None),
    force_scanned: Optional[str] = Form(None),
    group_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    content = await file.read()
    if not content:
        raise AppError("空文件不能入库")
    is_pdf = (file.filename or "").lower().endswith(".pdf")
    force = (force_scanned or "").lower() in ("1", "true", "yes", "on")
    doc = kb_service.ingest_upload(
        db,
        filename=file.filename or "unnamed",
        content=content,
        collection_id=collection_id,
        force_scanned=force,
        # PDF（尤其扫描件）解析耗时，放后台执行，前端轮询状态
        async_parse=is_pdf,
        group_id=group_id or None,
    )
    ocr_status = "processing" if (doc.indexing_status == "processing" and doc.is_scanned_pdf) else None
    from ..services.task import evaluate
    completed = evaluate(db)
    return kb_schemas.UploadResult(
        message="上传成功",
        batch_id=doc.id,
        document_id=doc.id,
        id=doc.id,
        file_name=doc.display_name,
        collection_id=doc.collection_id,
        status=doc.indexing_status,
        ocr_processed=doc.is_scanned_pdf,
        ocr_status=ocr_status,
        completed_tasks=completed or None,
    )


@router.get("/documents")
def list_documents(
    page: int = 1,
    limit: int = 20,
    collection_id: Optional[str] = None,
    group_id: Optional[str] = None,
    ungrouped_only: bool = Query(False),
    db: Session = Depends(get_db),
):
    data = kb_service.list_documents(
        db,
        page=page,
        limit=limit,
        collection_id=collection_id,
        group_id=group_id,
        ungrouped_only=ungrouped_only,
    )
    docs = []
    for d in data["documents"]:
        tags = json.loads(d.tags) if d.tags else []
        if d.indexing_status == "processing" and (d.is_scanned_pdf or (d.file_type or "").lower() == "pdf"):
            ocr_status = "processing"
        elif d.is_scanned_pdf:
            ocr_status = "completed"
        else:
            ocr_status = None
        docs.append(kb_schemas.KnowledgeDoc(
            id=d.id,
            name=d.display_name,
            type=d.file_type or "txt",
            tags=tags,
            status=d.indexing_status,
            segment_status=d.segment_status,
            question_gen_status=d.question_gen_status,
            ocr_status=ocr_status,
            pdf_page_count=d.pdf_page_count,
            zone=d.zone,
            group_id=d.group_id,
        ))
    return {**data, "documents": docs}


@router.get("/documents/{doc_id}/status", response_model=kb_schemas.DocumentStatus)
def document_status(doc_id: str, db: Session = Depends(get_db)):
    doc = kb_service.get_document(db, doc_id)
    if doc.indexing_status == "processing" and (doc.is_scanned_pdf or (doc.file_type or "").lower() == "pdf"):
        ocr_status = "processing"
    elif doc.is_scanned_pdf:
        ocr_status = "completed"
    else:
        ocr_status = None
    from ..services.task import evaluate
    completed = evaluate(db) if doc.indexing_status == "completed" else []
    return kb_schemas.DocumentStatus(
        batch_id=doc.id,
        status=doc.indexing_status,
        error_message=None,
        completed_segments=None,
        total_segments=None,
        ocr_status=ocr_status,
        completed_tasks=completed or None,
    )


@router.delete("/documents/{doc_id}", response_model=kb_schemas.DeleteResult)
def delete_document(doc_id: str, db: Session = Depends(get_db)):
    kb_service.delete_document(db, doc_id)
    return kb_schemas.DeleteResult(message="已删除", doc_id=doc_id)


def _reading_preview_mode(doc) -> str:
    """阅读页打开方式：原 PDF / 原 DOCX / MD；扫描件 PDF 强制走解析稿。"""
    ft = (doc.file_type or "").lower()
    has_raw = storage.original_path(doc.id) is not None
    if ft == "md":
        return "markdown"
    if ft == "pdf":
        if getattr(doc, "is_scanned_pdf", False) or not has_raw:
            return "markdown"
        return "pdf"
    if ft == "docx":
        return "docx" if has_raw else "markdown"
    return "markdown" if ft in ("txt",) else "text"


@router.get("/documents/{doc_id}/content", response_model=kb_schemas.DocumentContentMeta)
def document_content(
    doc_id: str,
    meta_only: bool = False,
    db: Session = Depends(get_db),
):
    doc = kb_service.get_document(db, doc_id)
    content = "" if meta_only else (storage.read_parsed(doc.id) or "")
    preview_mode = _reading_preview_mode(doc)
    warning = None
    if doc.file_type == "pdf" and getattr(doc, "is_scanned_pdf", False):
        warning = "扫描件已打开解析稿（MD），可划选 tip；原图阅读不支持 tip。"
    elif preview_mode == "pdf":
        warning = "正在阅读原 PDF。浏览器 PDF 内无法划选 tip，需要 tip 请切到解析稿。"
    elif preview_mode == "docx":
        warning = "正在阅读 DOCX。可划选文字 tip；若排版异常可切到解析稿。"
    return kb_schemas.DocumentContentMeta(
        doc_id=doc.id,
        file_name=doc.display_name,
        content=content,
        file_type=doc.file_type,
        preview_mode=preview_mode,
        has_raw_file=storage.original_path(doc.id) is not None,
        is_scanned_pdf=bool(getattr(doc, "is_scanned_pdf", False)),
        pdf_page_count=doc.pdf_page_count,
        warning=warning,
    )


@router.get("/documents/{doc_id}/file")
def fetch_document_file(doc_id: str, db: Session = Depends(get_db)):
    doc = kb_service.get_document(db, doc_id)
    content = storage.read_original(doc.id)
    if not content:
        raise HTTPException(404, "原始文件不存在")
    ft = (doc.file_type or "").lower()
    media = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "md": "text/markdown; charset=utf-8",
        "txt": "text/plain; charset=utf-8",
    }.get(ft, "application/octet-stream")
    return Response(content=content, media_type=media)


@router.get("/documents/{doc_id}/thumbnail")
def fetch_thumbnail(doc_id: str, db: Session = Depends(get_db)):
    doc = kb_service.get_document(db, doc_id)
    cached = storage.read_thumbnail(doc.id)
    if cached:
        return Response(content=cached, media_type="image/png")
    content = storage.read_original(doc.id)
    if content and doc.file_type == "pdf":
        png = thumb_service.ensure_thumbnail(doc.id, content)
        if png:
            return Response(content=png, media_type="image/png")
    return Response(status_code=404)


@router.get("/documents/{doc_id}/images", response_model=kb_schemas.DocumentImageList)
def list_document_images(
    doc_id: str,
    page: Optional[int] = Query(None, ge=1, description="按页筛选；不传则返回全书图片"),
    db: Session = Depends(get_db),
):
    """列出文档图床中的图片（供 tip 选图）。"""
    kb_service.get_document(db, doc_id)
    q = db.query(DocumentImage).filter(DocumentImage.document_id == doc_id)
    if page is not None:
        q = q.filter(DocumentImage.page_num == page)
    rows = q.order_by(DocumentImage.page_num, DocumentImage.image_index, DocumentImage.file_name).all()
    items = [
        kb_schemas.DocumentImageItem(
            file_name=r.file_name,
            page_num=int(r.page_num or 0),
            url_path=f"/api/v1/kb/documents/{doc_id}/images/{r.file_name}",
        )
        for r in rows
    ]
    return kb_schemas.DocumentImageList(document_id=doc_id, images=items)


@router.get("/documents/{doc_id}/images/{filename}")
def fetch_image(doc_id: str, filename: str, db: Session = Depends(get_db)):
    kb_service.get_document(db, doc_id)
    data = storage.read_image(doc_id, filename)
    if not data:
        raise HTTPException(404, "图片不存在")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    media_type = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                  "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp"}.get(ext, "application/octet-stream")
    return Response(content=data, media_type=media_type)


@router.get("/documents/{doc_id}/segments", response_model=kb_schemas.DocumentSegmentList)
def document_segments(doc_id: str, db: Session = Depends(get_db)):
    kb_service.get_document(db, doc_id)
    segs = db.query(DocumentSegment).filter(DocumentSegment.document_id == doc_id).order_by(DocumentSegment.order_index).all()
    return kb_schemas.DocumentSegmentList(
        document_id=doc_id,
        segment_status="completed" if segs else "not_started",
        total=len(segs),
        segments=[kb_schemas.DocumentSegment(**vars(s)) for s in segs],
    )


@router.get("/documents/{doc_id}/pages", response_model=kb_schemas.DocumentPageList)
def document_pages(doc_id: str, db: Session = Depends(get_db)):
    doc = kb_service.get_document(db, doc_id)
    storage.ensure_page_headings(doc.id)
    pages = storage.list_pages(doc.id)
    counts = question_service.page_question_counts(db, doc.id)
    items = []
    # 与 storage 拼 parsed.md 一致：页与页之间用 \n\n
    cursor = 0
    for i, (num, p) in enumerate(pages):
        content = p.read_text(encoding="utf-8")
        start = cursor
        end = start + len(content)
        items.append(kb_schemas.DocumentPage(
            page_number=num,
            title=f"第 {num} 页",
            preview=content[:200],
            char_start=start,
            char_end=end,
            content_length=len(content),
            question_count=counts.get(num, 0),
        ))
        cursor = end + (2 if i < len(pages) - 1 else 0)
    has_page_markers = len(items) > 0
    if not items:
        full = storage.read_parsed(doc.id) or ""
        if full.strip():
            items.append(kb_schemas.DocumentPage(
                page_number=1,
                title=doc.display_name,
                preview=full[:200],
                char_start=0,
                char_end=len(full),
                content_length=len(full),
                question_count=counts.get(1, 0),
            ))
            has_page_markers = False
    return kb_schemas.DocumentPageList(
        document_id=doc.id,
        document_name=doc.display_name,
        total_pages=len(items),
        has_page_markers=has_page_markers,
        pages=items,
        file_type=doc.file_type,
        preview_mode=_reading_preview_mode(doc),
        has_raw_file=storage.original_path(doc.id) is not None,
    )


@router.get("/documents/{doc_id}/pages/{page_number}", response_model=kb_schemas.DocumentPageDetail)
def document_page(doc_id: str, page_number: int, db: Session = Depends(get_db)):
    kb_service.get_document(db, doc_id)
    content = storage.read_page(doc_id, page_number)
    if content is None and page_number == 1 and not storage.list_pages(doc_id):
        content = storage.read_parsed(doc_id)
    if content is None:
        raise HTTPException(404, "页不存在")
    counts = question_service.page_question_counts(db, doc_id)
    return kb_schemas.DocumentPageDetail(
        page_number=page_number,
        title=f"第 {page_number} 页",
        content=content,
        content_length=len(content),
        question_count=counts.get(page_number, 0),
    )


@router.get("/documents/{doc_id}/export")
def export_doc(
    doc_id: str,
    include_original: bool = False,
    db: Session = Depends(get_db),
):
    from urllib.parse import quote
    data, filename = export_service.export_document(
        db, doc_id, include_original=include_original
    )
    from fastapi.responses import StreamingResponse
    import io as _io
    disposition = f"attachment; filename*=UTF-8''{quote(filename)}"
    return StreamingResponse(
        _io.BytesIO(data),
        media_type="application/zip",
        headers={"Content-Disposition": disposition},
    )


@router.post("/import", response_model=kb_schemas.ImportPackageResult)
async def import_doc(
    file: UploadFile = File(...),
    collection_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    content = await file.read()
    result = await export_service.import_package(db, content, file.filename or "package.zip", collection_id)
    return kb_schemas.ImportPackageResult(**result)


def _learning_path_out(doc_id: str, rec: DocumentLearningPath | None) -> kb_schemas.LearningPathResult:
    if rec is None:
        return kb_schemas.LearningPathResult(document_id=doc_id, status="missing")
    path: dict = {}
    if rec.path_json:
        try:
            parsed = json.loads(rec.path_json)
            if isinstance(parsed, dict):
                path = parsed
        except json.JSONDecodeError:
            path = {}
    raw_chapters = path.get("chapters") or []
    chapters = []
    for i, ch in enumerate(raw_chapters):
        if not isinstance(ch, dict):
            continue
        try:
            order = int(ch.get("order") or i + 1)
        except (TypeError, ValueError):
            order = i + 1
        chapters.append(kb_schemas.LearningPathChapter(
            id=str(ch.get("id") or ""),
            title=str(ch.get("title") or ""),
            order=order,
            key_points=[str(p) for p in (ch.get("key_points") or []) if p],
            learned=bool(ch.get("learned")),
        ))
    chapters.sort(key=lambda c: c.order)
    return kb_schemas.LearningPathResult(
        document_id=doc_id,
        status=rec.status or "pending",
        title=path.get("title") or None,
        chapters=chapters,
    )


@router.get("/documents/{doc_id}/learning-path", response_model=kb_schemas.LearningPathResult)
def get_learning_path(doc_id: str, db: Session = Depends(get_db)):
    kb_service.get_document(db, doc_id)
    rec = db.query(DocumentLearningPath).filter_by(document_id=doc_id).first()
    return _learning_path_out(doc_id, rec)


@router.post("/documents/{doc_id}/learning-path", response_model=kb_schemas.LearningPathResult)
async def generate_learning_path(doc_id: str, db: Session = Depends(get_db)):
    """后台重新提取书本目录（学习路径）。已有结果会被覆盖。"""
    kb_service.get_document(db, doc_id)
    rec = db.query(DocumentLearningPath).filter_by(document_id=doc_id).first()
    if rec is None:
        rec = DocumentLearningPath(document_id=doc_id, status="pending")
        db.add(rec)
    else:
        rec.status = "pending"
        rec.path_json = None
    db.commit()

    from ..agents.learning_path_agent import schedule_learning_path
    await schedule_learning_path(doc_id)
    return _learning_path_out(doc_id, rec)


@router.get("/config", response_model=kb_schemas.KbConfig)
def kb_config():
    return kb_schemas.KbConfig(
        rag_backend="chroma",
        use_oss=False,
        max_upload_size=200 * 1024 * 1024,
        max_upload_size_display="200MB",
        supported_extensions=sorted(list({".pdf", ".docx", ".md", ".txt", ".zip", ".png", ".jpg", ".jpeg"})),
        max_questions_per_document=500,
        max_pages_per_gen=config.question_gen_max_pages,
        question_gen_max_concurrency=config.question_gen_max_concurrency,
    )


# ─── 资料组 ───────────────────────────────────────────

@router.get("/groups", response_model=kb_schemas.DocumentGroupList)
def list_groups(collection_id: Optional[str] = None, db: Session = Depends(get_db)):
    from ..services.doc_group import doc_group_service

    groups = doc_group_service.list_groups(db, collection_id=collection_id)
    items = [kb_schemas.DocumentGroupItem(**doc_group_service.group_item(db, g)) for g in groups]
    return kb_schemas.DocumentGroupList(groups=items, total=len(items))


@router.post("/groups", response_model=kb_schemas.DocumentGroupItem)
def create_group(body: kb_schemas.DocumentGroupCreate, db: Session = Depends(get_db)):
    from ..services.doc_group import doc_group_service

    g = doc_group_service.create(
        db, name=body.name, collection_id=body.collection_id, description=body.description
    )
    return kb_schemas.DocumentGroupItem(**doc_group_service.group_item(db, g))


@router.get("/groups/{group_id}", response_model=kb_schemas.DocumentGroupDetail)
def get_group(group_id: str, db: Session = Depends(get_db)):
    from ..services.doc_group import doc_group_service

    return kb_schemas.DocumentGroupDetail(**doc_group_service.group_detail(db, group_id))


@router.patch("/groups/{group_id}", response_model=kb_schemas.DocumentGroupItem)
def update_group(group_id: str, body: kb_schemas.DocumentGroupUpdate, db: Session = Depends(get_db)):
    from ..services.doc_group import doc_group_service

    g = doc_group_service.update(
        db,
        group_id,
        name=body.name,
        description=body.description,
        cover_document_id=body.cover_document_id,
    )
    return kb_schemas.DocumentGroupItem(**doc_group_service.group_item(db, g))


@router.delete("/groups/{group_id}", response_model=kb_schemas.DeleteResult)
def delete_group(group_id: str, db: Session = Depends(get_db)):
    from ..services.doc_group import doc_group_service

    doc_group_service.delete(db, group_id)
    return kb_schemas.DeleteResult(message="已解散资料组（文档未删除）", doc_id=group_id)


@router.post("/groups/{group_id}/documents", response_model=kb_schemas.DocumentGroupDetail)
def add_group_documents(
    group_id: str, body: kb_schemas.DocumentGroupAddDocs, db: Session = Depends(get_db)
):
    from ..services.doc_group import doc_group_service

    detail = doc_group_service.add_documents(db, group_id, body.document_ids or [])
    return kb_schemas.DocumentGroupDetail(**{k: v for k, v in detail.items() if k != "added"})


@router.delete("/groups/{group_id}/documents/{document_id}", response_model=kb_schemas.DocumentGroupDetail)
def remove_group_document(group_id: str, document_id: str, db: Session = Depends(get_db)):
    from ..services.doc_group import doc_group_service

    return kb_schemas.DocumentGroupDetail(**doc_group_service.remove_document(db, group_id, document_id))
