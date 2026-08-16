"""扫描件解析（MinerU）schemas。"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class DocParsePage(BaseModel):
    page: int
    text: str


class DocParsePreview(BaseModel):
    filename: str
    total_pages: int
    pages: list[DocParsePage]
    images: dict[str, str] = {}  # file_name -> dataURI/base64


class DocParseImportResult(BaseModel):
    message: str
    status: str = "ok"
    document_id: Optional[str] = None
    id: Optional[str] = None
    file_name: Optional[str] = None
    collection_id: Optional[str] = None
    segment_status: Optional[str] = None
    indexing_status: Optional[str] = None
