"""图片上传（对话 / 刷题传图）。

单用户场景：图片直接落到 storage/uploads/，用随机文件名；返回 id 与访问 URL。
对话里引用的是 id（文件名），后端再转成本地路径上传给 LLM。
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from ..core.storage import storage

router = APIRouter(prefix="/api/v1/uploads", tags=["uploads"])

# 官方多模态仅支持这几种
_ALLOWED = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
}
MAX_UPLOAD_BYTES = 16 * 1024 * 1024

_SAFE_NAME = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$")


@router.post("/image")
async def upload_image(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower().lstrip(".")
    if ext not in _ALLOWED:
        raise HTTPException(status_code=400, detail=f"不支持的图片格式：{ext or '(无扩展名)'}")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="空文件")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="图片过大（上限 16MB）")

    name = f"{uuid.uuid4().hex}.{ext}"
    storage.save_upload(name, content)
    return {
        "id": name,
        "url": f"/api/v1/uploads/{name}",
        "filename": file.filename,
    }


@router.get("/{name}")
def get_upload(name: str):
    if not _SAFE_NAME.match(name):
        raise HTTPException(status_code=400, detail="非法文件名")
    media_type = _ALLOWED.get(name.rsplit(".", 1)[-1].lower())
    if not media_type:
        raise HTTPException(status_code=404, detail="文件不存在")
    data = storage.read_upload(name)
    if data is None:
        raise HTTPException(status_code=404, detail="文件不存在")
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=86400"},
    )
