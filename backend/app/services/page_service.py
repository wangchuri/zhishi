"""
文档页解析 — 从 parsed.txt 按 `## 第 N 页` 切分，供出题页展示
"""
import re
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.crud import kb as kb_crud
from app.crud import segment as segment_crud
from app.models import Document
from app.schemas.page import (
    DocumentPageDetailOut,
    DocumentPageListOut,
    DocumentPageOut,
)
from app.services.segment_service import _load_document_text, _resolve_parsed_path
from app.services.storage_service import storage_service

PAGE_HEADING_PATTERN = re.compile(r"^##\s+第\s+(\d+)\s+页\s*$", re.MULTILINE)
BUILTIN_Q_PATTERNS = (
    re.compile(r"[A-D][\.、．]\s"),
    re.compile(r"[（\(][A-D][）\)]"),
    re.compile(r"(单选|多选|判断|习题|练习|思考题|测验|例题)"),
)
KEY_PAGE_PATTERN = re.compile(r"(重点|小结|本章|总结|考点|关键|核心)")


def _analyze_page_content(content: str) -> tuple[bool, bool]:
    text = content.strip()
    has_builtin = any(p.search(text) for p in BUILTIN_Q_PATTERNS)
    is_key = len(text) > 300 or bool(KEY_PAGE_PATTERN.search(text))
    return has_builtin, is_key


def _make_preview(content: str, max_len: int = 120) -> str:
    text = re.sub(r"\s+", " ", content.strip())
    if len(text) <= max_len:
        return text
    return text[:max_len] + "…"


def split_pages(text: str) -> List[dict]:
    """
    按 `## 第 N 页` 切分全文。
    无页标记时返回单页（page_number=1，内容为全文）。
    """
    if not text or not text.strip():
        return []

    matches = list(PAGE_HEADING_PATTERN.finditer(text))
    if not matches:
        has_builtin, is_key = _analyze_page_content(text)
        return [
            {
                "page_number": 1,
                "title": "全文",
                "content": text,
                "char_start": 0,
                "char_end": len(text),
                "has_builtin_questions": has_builtin,
                "is_key_page": is_key,
            }
        ]

    pages: List[dict] = []
    for i, match in enumerate(matches):
        page_num = int(match.group(1))
        content_start = match.end()
        content_end = (
            matches[i + 1].start() if i + 1 < len(matches) else len(text)
        )
        chunk = text[content_start:content_end].strip()
        has_builtin, is_key = _analyze_page_content(chunk)
        pages.append(
            {
                "page_number": page_num,
                "title": f"第 {page_num} 页",
                "content": chunk,
                "char_start": match.start(),
                "char_end": content_end,
                "has_builtin_questions": has_builtin,
                "is_key_page": is_key,
            }
        )
    return pages


def _find_segment_id_for_page(
    db: Session, document_id: str, page: dict
) -> Optional[str]:
    """OCR 文档分段标题常为「第 N 页」，尝试匹配 segment。"""
    title = page["title"]
    segments = segment_crud.list_segments_for_document(db, document_id)
    for seg in segments:
        if seg.title and seg.title.strip() == title.strip():
            return seg.id
        if (
            seg.char_start <= page["char_start"] < seg.char_end
            or seg.char_start < page["char_end"] <= seg.char_end
        ):
            return seg.id
    return None


def _strip_page_heading(content: str) -> str:
    """去掉页文件首行 `## 第 N 页`，返回正文。"""
    lines = content.splitlines()
    if lines and PAGE_HEADING_PATTERN.match(lines[0].strip()):
        return "\n".join(lines[1:]).strip()
    return content.strip()


def _pages_from_folder(
    db: Session, document: Document, parsed_path: str
) -> tuple[List[dict], bool]:
    """从按页文件夹加载，无需 split 全文。"""
    manifest = storage_service.read_parsed_manifest(parsed_path)
    header_len = 0
    if manifest:
        name = manifest.get("original_filename") or document.display_name or "document"
        total = manifest.get("total_pages") or 0
        header = f"# {name}\n\n> OCR 提取，共 {total} 页\n\n"
        header_len = len(header)

    raw_pages = storage_service.list_parsed_pages(parsed_path, include_content=True)
    pages: List[dict] = []
    char_offset = header_len
    for item in raw_pages:
        full_content = item["content"]
        body = _strip_page_heading(full_content)
        has_builtin, is_key = _analyze_page_content(body)
        content_start = char_offset
        content_end = char_offset + len(full_content)
        char_offset = content_end + 2
        page = {
            "page_number": item["page_number"],
            "title": item["title"],
            "content": body,
            "char_start": content_start,
            "char_end": content_end,
            "has_builtin_questions": has_builtin,
            "is_key_page": is_key,
        }
        page["segment_id"] = _find_segment_id_for_page(db, document.id, page)
        pages.append(page)
    return pages, True


def _load_pages_for_document(
    db: Session, document: Document
) -> tuple[List[dict], bool]:
    parsed_path = _resolve_parsed_path(document)
    if parsed_path and storage_service.is_parsed_pages_dir(parsed_path):
        return _pages_from_folder(db, document, parsed_path)

    text, error = _load_document_text(document)
    if text is None:
        raise HTTPException(status_code=400, detail=error or "无法读取文档内容")

    has_markers = PAGE_HEADING_PATTERN.search(text) is not None
    pages = split_pages(text)
    for page in pages:
        page["segment_id"] = _find_segment_id_for_page(db, document.id, page)
    return pages, has_markers


def list_document_pages(
    db: Session, user_id: int, doc_id: str
) -> DocumentPageListOut:
    doc = kb_crud.get_document_by_id_or_dify(db, user_id, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    pages_raw, has_markers = _load_pages_for_document(db, doc)
    pages = [
        DocumentPageOut(
            page_number=p["page_number"],
            title=p["title"],
            preview=_make_preview(p["content"]),
            char_start=p["char_start"],
            char_end=p["char_end"],
            content_length=len(p["content"]),
            has_builtin_questions=p["has_builtin_questions"],
            is_key_page=p["is_key_page"],
            segment_id=p.get("segment_id"),
        )
        for p in pages_raw
    ]
    return DocumentPageListOut(
        document_id=doc.id,
        document_name=doc.display_name,
        total_pages=len(pages),
        has_page_markers=has_markers,
        pages=pages,
    )


def get_document_page_detail(
    db: Session, user_id: int, doc_id: str, page_number: int
) -> DocumentPageDetailOut:
    doc = kb_crud.get_document_by_id_or_dify(db, user_id, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    parsed_path = _resolve_parsed_path(doc)
    if parsed_path and storage_service.is_parsed_pages_dir(parsed_path):
        raw = storage_service.read_page_at_path(parsed_path, page_number)
        if raw is None:
            raise HTTPException(status_code=404, detail=f"页码不存在: {page_number}")
        body = _strip_page_heading(raw)
        has_builtin, is_key = _analyze_page_content(body)
        page = {
            "page_number": page_number,
            "title": f"第 {page_number} 页",
            "content": body,
            "char_start": 0,
            "char_end": len(raw),
            "has_builtin_questions": has_builtin,
            "is_key_page": is_key,
        }
        page["segment_id"] = _find_segment_id_for_page(db, doc.id, page)
        target = page
    else:
        pages_raw, _ = _load_pages_for_document(db, doc)
        target = next((p for p in pages_raw if p["page_number"] == page_number), None)
        if not target:
            raise HTTPException(status_code=404, detail=f"页码不存在: {page_number}")

    return DocumentPageDetailOut(
        page_number=target["page_number"],
        title=target["title"],
        preview=_make_preview(target["content"]),
        char_start=target["char_start"],
        char_end=target["char_end"],
        content_length=len(target["content"]),
        has_builtin_questions=target["has_builtin_questions"],
        is_key_page=target["is_key_page"],
        segment_id=target.get("segment_id"),
        content=target["content"],
    )


def get_pages_by_numbers(
    db: Session, document: Document, page_numbers: List[int]
) -> List[dict]:
    pages_raw, _ = _load_pages_for_document(db, document)
    by_num = {p["page_number"]: p for p in pages_raw}
    result = []
    for num in page_numbers:
        if num not in by_num:
            raise HTTPException(status_code=404, detail=f"页码不存在: {num}")
        result.append(by_num[num])
    return result
