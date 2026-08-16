"""知识库 API：集合 CRUD、上传、文档列表/状态/内容/文件/分段/页、图片、缩略图。"""

from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.errors import AppError
from ..core.storage import storage
from ..models import Document, DocumentImage, DocumentSegment
from ..schemas import kb as kb_schemas
from ..services import kb as kb_service
from ..services import thumbnail as thumb_service
from ..agents.learning_path_agent import schedule_learning_path

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
    db: Session = Depends(get_db),
):
    content = await file.read()
    doc = kb_service.ingest_upload(db, filename=file.filename or "unnamed", content=content, collection_id=collection_id)
    # 解析完成后异步调度学习路径 Agent（每文档独立任务，受 max_concurrency 限制）
    if doc.zone == "study" and kb_service.AUTO_LEARNING_PATH:
        try:
            await schedule_learning_path(doc.id)
        except Exception as e:
            logger.warning("调度学习路径失败 doc=%s: %s", doc.id, e)
    return kb_schemas.UploadResult(
        message="上传成功",
        batch_id=doc.id,
        document_id=doc.id,
        id=doc.id,
        file_name=doc.display_name,
        collection_id=doc.collection_id,
        status=doc.indexing_status,
        ocr_processed=doc.is_scanned_pdf,
    )


@router.get("/documents")
def list_documents(
    page: int = 1,
    limit: int = 20,
    collection_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    data = kb_service.list_documents(db, page=page, limit=limit, collection_id=collection_id)
    docs = []
    for d in data["documents"]:
        tags = json.loads(d.tags) if d.tags else []
        docs.append(kb_schemas.KnowledgeDoc(
            id=d.id,
            name=d.display_name,
            type=d.file_type or "txt",
            tags=tags,
            status=d.indexing_status,
            segment_status=d.segment_status,
            question_gen_status=d.question_gen_status,
            pdf_page_count=d.pdf_page_count,
            zone=d.zone,
        ))
    return {**data, "documents": docs}


@router.get("/documents/{doc_id}/status", response_model=kb_schemas.DocumentStatus)
def document_status(doc_id: str, db: Session = Depends(get_db)):
    doc = kb_service.get_document(db, doc_id)
    return kb_schemas.DocumentStatus(
        batch_id=doc.id,
        status=doc.indexing_status,
        error_message=None,
        completed_segments=None,
        total_segments=None,
        ocr_status="completed" if doc.is_scanned_pdf else None,
    )


@router.delete("/documents/{doc_id}", response_model=kb_schemas.DeleteResult)
def delete_document(doc_id: str, db: Session = Depends(get_db)):
    kb_service.delete_document(db, doc_id)
    return kb_schemas.DeleteResult(message="已删除", doc_id=doc_id)


@router.get("/documents/{doc_id}/content", response_model=kb_schemas.DocumentContentMeta)
def document_content(doc_id: str, db: Session = Depends(get_db)):
    doc = kb_service.get_document(db, doc_id)
    content = storage.read_parsed(doc.id) or ""
    preview_mode = "text"
    if doc.file_type == "pdf":
        preview_mode = "pdf" if doc.is_scanned_pdf or doc.pdf_page_count else "pdf"
    elif doc.file_type in ("md", "docx"):
        preview_mode = "markdown"
    return kb_schemas.DocumentContentMeta(
        doc_id=doc.id,
        file_name=doc.display_name,
        content=content,
        file_type=doc.file_type,
        preview_mode=preview_mode,
        has_raw_file=storage.original_path(doc.id) is not None,
        pdf_page_count=doc.pdf_page_count,
    )


@router.get("/documents/{doc_id}/file")
def fetch_document_file(doc_id: str, db: Session = Depends(get_db)):
    doc = kb_service.get_document(db, doc_id)
    content = storage.read_original(doc.id)
    if not content:
        raise HTTPException(404, "原始文件不存在")
    return Response(content=content, media_type="application/octet-stream")


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
    pages = storage.list_pages(doc.id)
    items = []
    for num, p in pages:
        content = p.read_text(encoding="utf-8")
        items.append(kb_schemas.DocumentPage(
            page_number=num,
            title=f"第 {num} 页",
            preview=content[:200],
            content_length=len(content),
        ))
    return kb_schemas.DocumentPageList(
        document_id=doc.id,
        document_name=doc.display_name,
        total_pages=len(items),
        pages=items,
        file_type=doc.file_type,
    )


@router.get("/documents/{doc_id}/pages/{page_number}", response_model=kb_schemas.DocumentPageDetail)
def document_page(doc_id: str, page_number: int, db: Session = Depends(get_db)):
    kb_service.get_document(db, doc_id)
    content = storage.read_page(doc_id, page_number)
    if content is None:
        raise HTTPException(404, "页不存在")
    return kb_schemas.DocumentPageDetail(
        page_number=page_number,
        title=f"第 {page_number} 页",
        content=content,
        content_length=len(content),
    )


@router.get("/config", response_model=kb_schemas.KbConfig)
def kb_config():
    return kb_schemas.KbConfig(
        rag_backend="chroma",
        use_oss=False,
        max_upload_size=200 * 1024 * 1024,
        max_upload_size_display="200MB",
        supported_extensions=sorted(list({".pdf", ".docx", ".md", ".txt", ".zip", ".png", ".jpg", ".jpeg"})),
        max_questions_per_document=500,
        max_pages_per_gen=30,
    )
