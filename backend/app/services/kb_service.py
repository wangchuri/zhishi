"""
知识库业务编排 — 分区、上传、global_documents 去重
"""
import hashlib
import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.crud import kb as kb_crud
from app.models import Document, KbCollection
from app.schemas.kb import (
    CollectionCreate,
    CollectionListOut,
    CollectionOut,
    CollectionUpdate,
    DocumentListOut,
    DocumentOut,
    UploadResponse,
)
from app.services.dify_kb import DifyKB
from app.services.file_parser import IMAGE_EXTENSIONS, SUPPORTED_EXTENSIONS, parse_file
from app.services.ocr_service import extract_text_from_image
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

# 旧版去重记录（仅 content 预览 fallback）
_HASH_STORE = Path(__file__).resolve().parent.parent.parent / "upload_hashes.json"


def _compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _format_size(bytes_val: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if bytes_val < 1024:
            return f"{bytes_val:.1f} {unit}"
        bytes_val /= 1024
    return f"{bytes_val:.1f} TB"


def _get_kb(dataset_id: str) -> DifyKB:
    if not dataset_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="您的知识库尚未创建，请先完成注册",
        )
    return DifyKB(dataset_id)


def _resolve_dataset_id(collection: KbCollection, user_dataset_id: Optional[str]) -> str:
    return collection.dataset_id or user_dataset_id or ""


def _ensure_collections(
    db: Session, user_id: int, user_dataset_id: Optional[str]
) -> None:
    if not kb_crud.list_collections(db, user_id):
        kb_crud.seed_default_collections(db, user_id, user_dataset_id)
        db.commit()


def _resolve_collection(
    db: Session,
    user_id: int,
    collection_id: Optional[str],
    user_dataset_id: Optional[str],
) -> KbCollection:
    _ensure_collections(db, user_id, user_dataset_id)
    if collection_id:
        coll = kb_crud.get_collection(db, user_id, collection_id)
        if not coll:
            raise HTTPException(status_code=404, detail="知识库分区不存在")
        return coll
    coll = kb_crud.get_default_study_collection(db, user_id)
    if not coll:
        raise HTTPException(status_code=500, detail="默认学习区未初始化")
    return coll


def _guess_mime(suffix: str) -> Optional[str]:
    mapping = {
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }
    return mapping.get(suffix)


def _maybe_trigger_segment(db: Session, document: Document) -> None:
    """S3 分段 hook — 暂未实现"""
    if document.zone == "study":
        logger.debug("segment hook skipped (S3): document_id=%s", document.id)


def _load_hash_store_fallback() -> dict:
    if not _HASH_STORE.exists():
        return {}
    try:
        with open(_HASH_STORE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _duplicate_response(
    existing: Document, dataset_id: str, file_name: str
) -> UploadResponse:
    return UploadResponse(
        message="该文件已上传过，无需重复上传",
        batch_id=existing.dify_batch_id,
        document_id=existing.dify_document_id,
        id=existing.id,
        file_name=file_name,
        dataset_id=dataset_id,
        collection_id=existing.collection_id,
        status="duplicate",
    )


def list_collections(db: Session, user_id: int, user_dataset_id: Optional[str]) -> CollectionListOut:
    _ensure_collections(db, user_id, user_dataset_id)
    rows = kb_crud.list_collections(db, user_id)
    return CollectionListOut(
        collections=[CollectionOut.model_validate(c) for c in rows],
        total=len(rows),
    )


def create_collection(
    db: Session,
    user_id: int,
    payload: CollectionCreate,
    user_dataset_id: Optional[str],
) -> CollectionOut:
    _ensure_collections(db, user_id, user_dataset_id)
    existing_names = {c.name for c in kb_crud.list_collections(db, user_id)}
    if payload.name in existing_names:
        raise HTTPException(status_code=400, detail="分区名称已存在")
    coll = kb_crud.create_collection(
        db,
        user_id=user_id,
        name=payload.name,
        zone=payload.zone,
        description=payload.description,
    )
    db.commit()
    db.refresh(coll)
    return CollectionOut.model_validate(coll)


def update_collection(
    db: Session,
    user_id: int,
    collection_id: str,
    payload: CollectionUpdate,
) -> CollectionOut:
    coll = kb_crud.get_collection(db, user_id, collection_id)
    if not coll:
        raise HTTPException(status_code=404, detail="知识库分区不存在")
    if payload.name and payload.name != coll.name:
        existing_names = {
            c.name for c in kb_crud.list_collections(db, user_id) if c.id != collection_id
        }
        if payload.name in existing_names:
            raise HTTPException(status_code=400, detail="分区名称已存在")
    kb_crud.update_collection(db, coll, name=payload.name, description=payload.description)
    db.commit()
    db.refresh(coll)
    return CollectionOut.model_validate(coll)


def upload_document(
    db: Session,
    user_id: int,
    user_dataset_id: Optional[str],
    filename: str,
    content_bytes: bytes,
    collection_id: Optional[str] = None,
    max_upload_size: int = 0,
    use_oss: bool = False,
) -> UploadResponse:
    if not filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {suffix}，支持的格式: {', '.join(SUPPORTED_EXTENSIONS.keys())}",
        )

    if not use_oss and max_upload_size and len(content_bytes) > max_upload_size:
        raise HTTPException(
            status_code=413,
            detail=(
                f"文件过大 ({_format_size(len(content_bytes))})，"
                f"演示环境限制单个文件不超过 {_format_size(max_upload_size)}"
            ),
        )

    collection = _resolve_collection(db, user_id, collection_id, user_dataset_id)
    dataset_id = _resolve_dataset_id(collection, user_dataset_id)
    kb = _get_kb(dataset_id)

    safe_filename = Path(filename).name
    file_hash = _compute_sha256(content_bytes)
    existing = kb_crud.get_document_by_user_hash(db, user_id, file_hash)
    if existing:
        logger.info("文件重复上传: user_id=%s, hash=%s...", user_id, file_hash[:16])
        return _duplicate_response(existing, dataset_id, safe_filename)

    is_image = suffix in IMAGE_EXTENSIONS
    global_doc = kb_crud.get_global_document_by_hash(db, file_hash)
    upload_path: str
    display_name = safe_filename
    parsed_text_path: Optional[str] = None
    parsed_cache_key: Optional[str] = None
    raw_storage_path: Optional[str] = None

    if global_doc:
        upload_path = global_doc.storage_path
        parsed_text_path = global_doc.parsed_text_path
        raw_storage_path = global_doc.storage_path
        logger.info("命中全局去重: hash=%s, path=%s", file_hash[:16], upload_path)
    else:
        raw_storage_path = storage_service.save_global_file(file_hash, content_bytes)
        upload_path = raw_storage_path

        if is_image:
            ocr_text = extract_text_from_image(raw_storage_path)
            if ocr_text is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="OCR 识别失败，请确认图片包含文字且凭据配置正确",
                )
            if not ocr_text.strip():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="图片中未检测到文字",
                )
            parsed_text_path = storage_service.save_global_parsed(file_hash, ocr_text)
            display_name = f"{Path(safe_filename).stem}_ocr.txt"
            upload_path = parsed_text_path
        else:
            parsed_content = parse_file(raw_storage_path)
            if parsed_content:
                parsed_text_path = storage_service.save_global_parsed(file_hash, parsed_content)

        global_doc = kb_crud.create_global_document(
            db,
            content_hash=file_hash,
            original_filename=safe_filename,
            file_size=len(content_bytes),
            storage_path=raw_storage_path,
            mime_type=_guess_mime(suffix),
            parsed_text_path=parsed_text_path,
        )

    if parsed_text_path:
        parsed_cache_key = parsed_text_path
    elif global_doc and global_doc.parsed_text_path:
        parsed_cache_key = global_doc.parsed_text_path

    if is_image and global_doc and global_doc.parsed_text_path:
        upload_path = global_doc.parsed_text_path
        display_name = f"{Path(safe_filename).stem}_ocr.txt"

    result = kb.add_document(upload_path)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="文件上传到 Dify 知识库失败",
        )

    document = kb_crud.create_document(
        db,
        user_id=user_id,
        collection_id=collection.id,
        zone=collection.zone,
        display_name=display_name,
        content_hash=file_hash,
        global_document_id=global_doc.id if global_doc else None,
        dify_document_id=result["document_id"],
        dify_batch_id=result["batch_id"],
        parsed_cache_key=parsed_cache_key,
        indexing_status="processing",
    )
    db.commit()
    db.refresh(document)

    _maybe_trigger_segment(db, document)

    return UploadResponse(
        message="文件已上传，正在索引中" + ("（已通过 OCR 识别文字）" if is_image else ""),
        batch_id=result["batch_id"],
        document_id=result["document_id"],
        id=document.id,
        file_name=display_name,
        dataset_id=dataset_id,
        collection_id=collection.id,
        status="indexing",
        ocr_processed=is_image,
    )


def list_documents(
    db: Session,
    user_id: int,
    user_dataset_id: Optional[str],
    page: int = 1,
    limit: int = 20,
    collection_id: Optional[str] = None,
) -> DocumentListOut:
    if collection_id:
        coll = kb_crud.get_collection(db, user_id, collection_id)
        if not coll:
            raise HTTPException(status_code=404, detail="知识库分区不存在")
        dataset_id = _resolve_dataset_id(coll, user_dataset_id)
    else:
        dataset_id = user_dataset_id

    docs, total = kb_crud.list_documents(db, user_id, collection_id, page, limit)

    # 无分区过滤且 DB 无记录时，回退 Dify 列表（兼容旧上传数据）
    if total == 0 and not collection_id and dataset_id:
        kb = _get_kb(dataset_id)
        result = kb.list_documents(page=page, limit=limit)
        dify_docs = []
        for doc in result.get("data", []):
            dify_docs.append(
                DocumentOut(
                    id=doc.get("id"),
                    name=doc.get("name", ""),
                    collection_id="",
                    zone="study",
                    file_type=doc.get("file_type"),
                    file_size=doc.get("file_size"),
                    indexing_status=doc.get("indexing_status", "unknown"),
                    dify_document_id=doc.get("id"),
                    created_at=doc.get("created_at"),
                    updated_at=doc.get("updated_at"),
                )
            )
        return DocumentListOut(
            documents=dify_docs,
            total=result.get("total", len(dify_docs)),
            page=page,
            limit=limit,
            dataset_id=dataset_id,
            collection_id=collection_id,
        )

    out_docs = []
    for doc in docs:
        file_size = None
        file_type = None
        if doc.global_document:
            file_size = doc.global_document.file_size
            file_type = doc.global_document.mime_type
        out_docs.append(
            DocumentOut(
                id=doc.dify_document_id or doc.id,
                name=doc.display_name,
                collection_id=doc.collection_id,
                zone=doc.zone,
                file_type=file_type,
                file_size=file_size,
                indexing_status=doc.indexing_status,
                segment_status=doc.segment_status,
                question_gen_status=doc.question_gen_status,
                dify_document_id=doc.dify_document_id,
                created_at=doc.created_at,
                updated_at=doc.updated_at,
            )
        )

    return DocumentListOut(
        documents=out_docs,
        total=total,
        page=page,
        limit=limit,
        dataset_id=dataset_id,
        collection_id=collection_id,
    )


def get_document_content(
    db: Session, user_id: int, doc_id: str
) -> dict:
    doc = kb_crud.get_document_by_id_or_dify(db, user_id, doc_id)
    if doc:
        content = None
        if doc.parsed_cache_key:
            content = storage_service.read_text_at_path(doc.parsed_cache_key)
        if not content and doc.global_document and doc.global_document.parsed_text_path:
            content = storage_service.read_text_at_path(doc.global_document.parsed_text_path)
        if content:
            return {
                "doc_id": doc.dify_document_id or doc.id,
                "file_name": doc.display_name,
                "content": content,
                "mock": False,
            }

    # 旧 upload_hashes.json fallback
    store = _load_hash_store_fallback()
    for key, record in store.items():
        if record.get("document_id") == doc_id and key.startswith(f"{user_id}:"):
            file_name = record.get("file_name", "")
            file_hash = key.split(":", 1)[1]
            cache_filename = f"{Path(file_name).stem}_{file_hash[:16]}.txt"
            content = storage_service.get_parsed(user_id, cache_filename)
            if content:
                return {
                    "doc_id": doc_id,
                    "file_name": file_name,
                    "content": content,
                    "mock": False,
                }

    return {
        "doc_id": doc_id,
        "content": (
            f"# 文档内容不可用\n\n"
            f"文档 ID: {doc_id}\n\n"
            f"该文档可能是在内容缓存功能上线前上传的，暂无实时预览。\n"
            f"您可以在对话中通过知识库检索查看文档内容。\n\n"
            f"> 提示：在对话中直接引用该文档，Tina 会自动从知识库中检索相关内容。"
        ),
        "mock": True,
    }


def delete_document(
    db: Session,
    user_id: int,
    user_dataset_id: Optional[str],
    doc_id: str,
) -> dict:
    doc = kb_crud.get_document_by_id_or_dify(db, user_id, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    dataset_id = user_dataset_id
    if doc.collection_id:
        coll = kb_crud.get_collection(db, user_id, doc.collection_id)
        if coll:
            dataset_id = _resolve_dataset_id(coll, user_dataset_id)

    if doc.dify_document_id and dataset_id:
        kb = _get_kb(dataset_id)
        if not kb.delete_document(doc.dify_document_id):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="删除文档失败，请检查文档是否存在",
            )

    content_hash = doc.content_hash
    global_doc = doc.global_document

    global_document_id = kb_crud.delete_document_row(db, doc)

    if global_document_id and global_doc:
        remaining = kb_crud.count_documents_for_global(db, global_document_id)
        if remaining == 0:
            storage_service.delete_file_at_path(global_doc.storage_path)
            if global_doc.parsed_text_path:
                storage_service.delete_file_at_path(global_doc.parsed_text_path)
            kb_crud.delete_global_document(db, global_doc)
    elif global_document_id:
        remaining = kb_crud.count_documents_for_global(db, global_document_id)
        if remaining == 0:
            orphan = kb_crud.get_global_document_by_hash(db, content_hash)
            if orphan:
                storage_service.delete_file_at_path(orphan.storage_path)
                if orphan.parsed_text_path:
                    storage_service.delete_file_at_path(orphan.parsed_text_path)
                kb_crud.delete_global_document(db, orphan)

    db.commit()
    return {"message": "文档已删除", "doc_id": doc_id}
