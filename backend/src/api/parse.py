"""扫描件解析工坊 API：preview / import-md / import-zip（MinerU）。"""

from __future__ import annotations

import base64
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.errors import AppError
from ..core.storage import storage
from ..models import DocumentImage
from ..schemas import parse as parse_schemas
from ..services.kb import kb_service
from ..services.mineru import mineru_service
from ..utils import escape_ordered_list_numbers, image_file_name, rewrite_image_refs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/parse", tags=["parse"])


@router.post("/preview", response_model=parse_schemas.DocParsePreview)
async def preview(file: UploadFile = File(...)):
    """PDF → MinerU 解析 → 逐页 md + 图片（不落库，图片转 base64 返回）。"""
    content = await file.read()
    filename = file.filename or "document.pdf"
    result = mineru_service.parse_pdf(content)

    pages = []
    for p in result["page_mds"]:
        pages.append(parse_schemas.DocParsePage(page=p["page"], text=p["markdown"]))

    images: dict[str, str] = {}
    for name, data in result["images"].items():
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else "png"
        images[name] = f"data:image/{ext};base64,{base64.b64encode(data).decode()}"

    return parse_schemas.DocParsePreview(
        filename=filename,
        total_pages=len(pages),
        pages=pages,
        images=images,
    )


@router.post("/import-md", response_model=parse_schemas.DocParseImportResult)
async def import_markdown(
    markdown: str = Form(...),
    filename: str = Form(...),
    collection_id: Optional[str] = Form(None),
    images: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """导入已解析的 markdown（图片 base64 落图床 + 改写引用 + 入库）。"""
    img_map: dict[str, bytes] = {}
    if images:
        try:
            data = json.loads(images)
            for name, b64 in data.items():
                if isinstance(b64, str) and "," in b64:
                    b64 = b64.split(",", 1)[1]
                try:
                    img_map[name] = base64.b64decode(b64)
                except Exception:
                    pass
        except Exception as e:
            raise AppError(f"images 参数解析失败: {e}")

    md_text = markdown
    # 图片落图床 + 改写引用 + 注册
    for idx, (name, data) in enumerate(img_map.items(), 1):
        ext = name.rsplit(".", 1)[-1] if "." in name else "png"
        new_name = image_file_name(filename.rsplit(".", 1)[0], 0, idx, ext)
        # 先建文档（用临时 id 落图），再正式入库
        # 简化：用 hash 作为 doc_id 的占位，见 ingest
        md_text = md_text.replace(name, f"images/{new_name}")
        md_text = md_text.replace(f"images/images/{new_name}", f"images/{new_name}")

    # 转义有序列表编号（避免渲染成列表）
    md_text = escape_ordered_list_numbers(md_text)

    # 借道 ingest 入库（md 文本 + 图片）
    doc = kb_service.ingest_md_text(
        db,
        filename=filename,
        md_text=md_text,
        images_map=img_map,
        collection_id=collection_id,
    )
    return parse_schemas.DocParseImportResult(
        message="导入成功",
        status="ok",
        document_id=doc.id,
        id=doc.id,
        file_name=doc.display_name,
        collection_id=doc.collection_id,
        segment_status=doc.segment_status,
        indexing_status=doc.indexing_status,
    )


@router.post("/import-zip", response_model=parse_schemas.DocParseImportResult)
async def import_zip(
    file: UploadFile = File(...),
    collection_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """导入 md.zip 压缩包。"""
    content = await file.read()
    from ..services import parser

    md_text, zip_images = parser.parse_zip_markdown(content)
    doc = kb_service.ingest_md_text(
        db,
        filename=file.filename or "document.zip",
        md_text=md_text,
        images_map=zip_images,
        collection_id=collection_id,
    )
    return parse_schemas.DocParseImportResult(
        message="导入成功",
        status="ok",
        document_id=doc.id,
        id=doc.id,
        file_name=doc.display_name,
        collection_id=doc.collection_id,
        segment_status=doc.segment_status,
        indexing_status=doc.indexing_status,
    )
