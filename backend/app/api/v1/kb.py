"""
知识库管理路由 — 文件上传 / 文档列表 / 索引进度 / 删除 / 内容预览
所有接口需要登录鉴权，用户隔离
"""
import hashlib
import json
import time
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File

from app.api.deps import get_current_active_user
from app.services.dify_kb import DifyKB
from app.services.file_parser import parse_file, SUPPORTED_EXTENSIONS, IMAGE_EXTENSIONS
from app.services.storage_service import storage_service
from app.services.ocr_service import extract_text_from_image
from app.core.config import DIFY_DATASET_API_KEY, USE_OSS, DEBUG_MAX_UPLOAD_SIZE

logger = logging.getLogger(__name__)

router = APIRouter(tags=["知识库管理"])

# 去重记录文件
HASH_STORE = Path(__file__).resolve().parent.parent.parent.parent / "upload_hashes.json"


def _get_kb(user_id: int, dataset_id: str) -> DifyKB:
    """获取用户的知识库客户端"""
    if not dataset_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="您的知识库尚未创建，请先完成注册",
        )
    return DifyKB(dataset_id)


# ─── Hash 去重工具 ─────────────────────────────────────────

def _compute_sha256_from_bytes(content: bytes) -> str:
    """计算字节内容的 SHA256 哈希值"""
    return hashlib.sha256(content).hexdigest()


def _load_hash_store() -> dict:
    """加载去重记录"""
    if not HASH_STORE.exists():
        return {}
    try:
        with open(HASH_STORE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_hash_store(data: dict) -> None:
    """保存去重记录"""
    with open(HASH_STORE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _check_duplicate(user_id: int, file_hash: str) -> Optional[dict]:
    """检查文件是否重复上传过，返回已有的记录或 None"""
    store = _load_hash_store()
    key = f"{user_id}:{file_hash}"
    return store.get(key)


def _record_upload(user_id: int, file_hash: str, file_name: str, document_id: str, batch_id: str) -> None:
    """记录上传成功的信息"""
    store = _load_hash_store()
    key = f"{user_id}:{file_hash}"
    store[key] = {
        "file_name": file_name,
        "document_id": document_id,
        "batch_id": batch_id,
        "uploaded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    _save_hash_store(store)


def _format_size(bytes_val: int) -> str:
    """格式化文件大小（人类可读）"""
    for unit in ("B", "KB", "MB", "GB"):
        if bytes_val < 1024:
            return f"{bytes_val:.1f} {unit}"
        bytes_val /= 1024
    return f"{bytes_val:.1f} TB"


# ─── 上传文档 ────────────────────────────────────────────

@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user),
):
    """
    上传文档到用户的知识库

    流程：
        1. 文件大小校验（演示环境 10MB 上限）
        2. 通过 storage_service 保存至本地存储
        3. SHA256 哈希去重检查
        4. 解析并缓存文本内容
        5. 通过 DifyKB 上传到 Dify
        6. 记录去重信息，返回 batch_id 和 document_id

    支持格式：txt, md, csv, json, html, pdf, docx
    """
    user_id = current_user["user_id"]
    dataset_id = current_user.get("dataset_id")

    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    # 检查文件扩展名
    suffix = Path(file.filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {suffix}，支持的格式: {', '.join(SUPPORTED_EXTENSIONS.keys())}",
        )

    # 1. 读取文件内容（全部读入内存，后续统一用 bytes）
    content_bytes = await file.read()

    # 1.5 文件大小校验（演示环境限制）
    if not USE_OSS and len(content_bytes) > DEBUG_MAX_UPLOAD_SIZE:
        max_size_str = _format_size(DEBUG_MAX_UPLOAD_SIZE)
        file_size_str = _format_size(len(content_bytes))
        raise HTTPException(
            status_code=413,
            detail=f"文件过大 ({file_size_str})，演示环境限制单个文件不超过 {max_size_str}",
        )

    safe_filename = Path(file.filename).name  # 防路径穿越
    kb = _get_kb(user_id, dataset_id)

    # 2. 保存到本地存储
    storage_path = storage_service.save_file(user_id, safe_filename, content_bytes)
    logger.info(f"文件已保存到本地存储: user_id={user_id}, path={storage_path}, size={len(content_bytes)}")

    try:
        # 3. SHA256 去重检查（直接计算字节，不再读文件）
        file_hash = _compute_sha256_from_bytes(content_bytes)
        existing = _check_duplicate(user_id, file_hash)
        if existing:
            logger.info(f"文件重复上传: user_id={user_id}, hash={file_hash[:16]}...")
            return {
                "message": "该文件已上传过，无需重复上传",
                "batch_id": existing["batch_id"],
                "document_id": existing["document_id"],
                "file_name": safe_filename,
                "dataset_id": dataset_id,
                "status": "duplicate",
            }

        # 4. 处理文件内容（图片走 OCR，文档走解析器）
        is_image = suffix in IMAGE_EXTENSIONS
        if is_image:
            # 4a. OCR 提取文本
            ocr_text = extract_text_from_image(storage_path)
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

            # 4b. 写入 OCR 结果到 txt 文件
            txt_filename = f"{Path(safe_filename).stem}_ocr.txt"
            txt_bytes = ocr_text.encode("utf-8")
            txt_path = storage_service.save_file(user_id, txt_filename, txt_bytes)
            logger.info(f"OCR 文本已保存: {txt_path}, 长度={len(ocr_text)}")

            # 4c. 缓存解析文本
            cache_filename = f"{Path(txt_filename).stem}_{file_hash[:16]}.txt"
            storage_service.save_parsed(user_id, cache_filename, ocr_text)

            # 5. 上传 txt 到 Dify（而不是原图）
            result = kb.add_document(txt_path)
            if not result:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="OCR 文本上传到 Dify 知识库失败",
                )

            batch_id = result["batch_id"]
            document_id = result["document_id"]
            uploaded_filename = txt_filename
        else:
            # 4. 解析并缓存文本内容
            parsed_content = parse_file(storage_path)
            if parsed_content:
                cache_filename = f"{Path(safe_filename).stem}_{file_hash[:16]}.txt"
                storage_service.save_parsed(user_id, cache_filename, parsed_content)
                logger.info(f"文件内容已缓存: {cache_filename}, 长度={len(parsed_content)}")

            # 5. 上传到 Dify
            result = kb.add_document(storage_path)
            if not result:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="文件上传到 Dify 知识库失败",
                )

            batch_id = result["batch_id"]
            document_id = result["document_id"]
            uploaded_filename = safe_filename

        # 6. 记录去重信息
        _record_upload(user_id, file_hash, uploaded_filename, document_id, batch_id)

        return {
            "message": "文件已上传，正在索引中" + ("（已通过 OCR 识别文字）" if is_image else ""),
            "batch_id": batch_id,
            "document_id": document_id,
            "file_name": uploaded_filename,
            "dataset_id": dataset_id,
            "status": "indexing",
            "ocr_processed": is_image,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"上传文档异常: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"上传失败: {str(e)}",
        )


# ─── 文档列表 ────────────────────────────────────────────

@router.get("/documents")
def list_documents(
    page: int = 1,
    limit: int = 20,
    current_user: dict = Depends(get_current_active_user),
):
    """
    列出当前用户知识库中的所有文档

    Query Params:
        page: 页码（默认 1）
        limit: 每页数量（默认 20）
    """
    user_id = current_user["user_id"]
    dataset_id = current_user.get("dataset_id")
    kb = _get_kb(user_id, dataset_id)

    result = kb.list_documents(page=page, limit=limit)

    # 简化返回字段
    docs = []
    for doc in result.get("data", []):
        docs.append({
            "id": doc.get("id"),
            "name": doc.get("name"),
            "file_type": doc.get("file_type"),
            "file_size": doc.get("file_size"),
            "indexing_status": doc.get("indexing_status", "unknown"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
        })

    return {
        "documents": docs,
        "total": result.get("total", len(docs)),
        "page": page,
        "limit": limit,
        "dataset_id": dataset_id,
    }


# ─── 索引进度查询 ─────────────────────────────────────────

@router.get("/documents/{batch_id}/status")
def get_document_status(
    batch_id: str,
    current_user: dict = Depends(get_current_active_user),
):
    """
    查询文档的索引进度

    Path Params:
        batch_id: 上传时返回的批次 ID（batch_id）
    """
    user_id = current_user["user_id"]
    dataset_id = current_user.get("dataset_id")
    kb = _get_kb(user_id, dataset_id)

    result = kb.get_indexing_status(batch_id)

    # Dify 返回格式可能是 {"data": [...]} 包裹
    if "data" in result and isinstance(result["data"], list) and len(result["data"]) > 0:
        item = result["data"][0]
        return {
            "batch_id": batch_id,
            "status": item.get("indexing_status", "unknown"),
            "error_message": item.get("error_message"),
            "completed_segments": item.get("completed_segments", 0),
            "total_segments": item.get("total_segments", 0),
        }

    return {
        "batch_id": batch_id,
        "status": result.get("status", "unknown"),
        "error": result.get("error"),
    }


# ─── 删除文档 ────────────────────────────────────────────

@router.delete("/documents/{doc_id}")
def delete_document(
    doc_id: str,
    current_user: dict = Depends(get_current_active_user),
):
    """
    从知识库中删除文档

    Path Params:
        doc_id: 文档 ID
    """
    user_id = current_user["user_id"]
    dataset_id = current_user.get("dataset_id")
    kb = _get_kb(user_id, dataset_id)

    success = kb.delete_document(doc_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="删除文档失败，请检查文档是否存在",
        )

    return {"message": "文档已删除", "doc_id": doc_id}


# ─── 文档内容预览 ─────────────────────────────────────────

@router.get("/documents/{doc_id}/content")
def get_document_content(
    doc_id: str,
    current_user: dict = Depends(get_current_active_user),
):
    """
    获取文档的真实解析内容

    从上传时通过 storage_service 缓存的解析文本中读取。
    如果缓存不存在（如旧文档），返回提示信息。

    Path Params:
        doc_id: 文档 ID
    """
    user_id = current_user["user_id"]

    # 从去重记录中查找该 doc_id 对应的文件信息
    store = _load_hash_store()
    matched = None
    matched_key = None
    for key, record in store.items():
        if record.get("document_id") == doc_id and key.startswith(f"{user_id}:"):
            matched = record
            matched_key = key
            break

    if matched and matched_key:
        file_name = matched.get("file_name", "")
        file_hash = matched_key.split(":", 1)[1]
        cache_filename = f"{Path(file_name).stem}_{file_hash[:16]}.txt"

        # 从 storage_service 的 parsed 缓存中读取
        content = storage_service.get_parsed(user_id, cache_filename)
        if content:
            return {
                "doc_id": doc_id,
                "file_name": file_name,
                "content": content,
                "mock": False,
            }

    # 缓存未命中，返回提示
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


# ─── 配置查询（供前端使用） ───────────────────────────────

@router.get("/config")
def get_kb_config(
    current_user: dict = Depends(get_current_active_user),
):
    """
    查询知识库配置（供前端展示提示等）
    """
    return {
        "use_oss": USE_OSS,
        "max_upload_size": DEBUG_MAX_UPLOAD_SIZE,
        "max_upload_size_display": _format_size(DEBUG_MAX_UPLOAD_SIZE),
        "supported_extensions": list(SUPPORTED_EXTENSIONS.keys()),
    }