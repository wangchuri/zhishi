"""文档解析：文本类文档提取为 markdown，扫描件交由 MinerU。

支持的输入类型：
  - 文本：txt / md / csv / json / html / htm
  - 富文本：docx
  - PDF：文本型（PyMuPDF 提取）；扫描型（无文本层）→ MinerU
  - 图片：png/jpg/jpeg/webp/bmp → 扫描件走 MinerU
  - zip：md 压缩包（可能带图片）→ 解压后作为 markdown 文档
"""

from __future__ import annotations

import csv
import json
import zipfile
import io
from pathlib import Path
from typing import Optional

from ..core.errors import AppError

TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".html", ".htm"}
RICH_EXTENSIONS = {".docx"}
PDF_EXTENSIONS = {".pdf"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
ZIP_EXTENSIONS = {".zip"}

SUPPORTED_EXTENSIONS = (
    TEXT_EXTENSIONS | RICH_EXTENSIONS | PDF_EXTENSIONS | IMAGE_EXTENSIONS | ZIP_EXTENSIONS
)


def file_extension(filename: str) -> str:
    return Path(filename).suffix.lower()


def detect_file_type(filename: str) -> str:
    """返回前端 KnowledgeDoc.type 所需类型。"""
    ext = file_extension(filename)
    if ext in TEXT_EXTENSIONS:
        return "md" if ext == ".md" else "txt"
    if ext in RICH_EXTENSIONS:
        return "docx"
    if ext in PDF_EXTENSIONS:
        return "pdf"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in ZIP_EXTENSIONS:
        return "md"
    return "txt"


class ParseResult:
    """解析产物。"""

    __slots__ = ("text", "pages", "images", "is_scanned_pdf")

    def __init__(
        self,
        text: str,
        pages: list[str] | None = None,
        images: dict[str, bytes] | None = None,
        is_scanned_pdf: bool = False,
    ) -> None:
        self.text = text
        self.pages = pages or []
        self.images = images or {}
        self.is_scanned_pdf = is_scanned_pdf


def parse_text_bytes(content: bytes, ext: str) -> str:
    """解析文本类文件 → markdown 字符串。"""
    text = content.decode("utf-8", errors="replace")
    if ext == ".md":
        return text
    if ext == ".csv":
        try:
            rows = list(csv.reader(io.StringIO(text)))
        except Exception:
            return text
        return "\n".join(" | ".join(r) for r in rows) if rows else text
    if ext == ".json":
        try:
            data = json.loads(text)
            return json.dumps(data, ensure_ascii=False, indent=2)
        except Exception:
            return text
    if ext in (".html", ".htm"):
        return text
    return text


def parse_docx_bytes(content: bytes) -> str:
    """解析 docx → markdown（段落 + 表格）。"""
    from docx import Document

    doc = Document(io.BytesIO(content))
    lines: list[str] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            style = (para.style.name or "").lower()
            if "heading 1" in style or style == "title":
                lines.append(f"# {text}")
            elif "heading 2" in style:
                lines.append(f"## {text}")
            elif "heading 3" in style:
                lines.append(f"### {text}")
            else:
                lines.append(text)
    return "\n\n".join(lines)


def parse_pdf_text(content: bytes) -> tuple[str, list[str]]:
    """提取 PDF 文本（PyMuPDF）。返回 (全文, 逐页文本)。

    若无可提取文本（扫描件），返回空 text 与空 pages。
    """
    import fitz  # PyMuPDF

    doc = fitz.open(stream=content, filetype="pdf")
    pages: list[str] = []
    for page in doc:
        pages.append(page.get_text("text"))
    doc.close()

    combined = "\n".join(pages).strip()
    return combined, pages


def is_pdf_scanned(content: bytes) -> bool:
    """判定 PDF 是否扫描件（无可提取文本层）。"""
    import fitz

    doc = fitz.open(stream=content, filetype="pdf")
    total = 0
    for page in doc:
        total += len(page.get_text("text").strip())
    doc.close()
    return total < 20  # 全文档几乎无文本 → 扫描件


# 「文本型 PDF」也常丢掉公式：公式要么是 Type3/数学字体（无 Unicode 映射被丢弃），
# 要么是矢量图形，get_text 都拿不到。命中这些信号就改走 MinerU（渲染+OCR+公式识别）。
_MATH_FONT_MARKERS = (
    "cmmi", "cmsy", "cmex", "cmr", "cmbx", "cmti", "cmss",
    "msam", "msbm", "math", "euclid", "mtmi", "mtsy", "mt extra",
    "symbol", "stix", "xits", "asana", "mathematica",
    "latin modern math", "cambria math",
)
_DETECT_MAX_PAGES = 8  # 只抽样前几页，够判断且不慢
_DRAWING_MIN = 50  # 矢量图绝对下限，避免把表格线/背景误判为公式


class PdfInspection:
    """一次开文档得到的 PDF 检查结果。"""

    __slots__ = ("text", "pages", "is_scanned", "needs_mineru", "reason")

    def __init__(
        self,
        text: str,
        pages: list[str],
        is_scanned: bool,
        needs_mineru: bool,
        reason: str,
    ) -> None:
        self.text = text
        self.pages = pages
        self.is_scanned = is_scanned
        self.needs_mineru = needs_mineru
        self.reason = reason


def _font_is_math(basefont: str) -> bool:
    name = (basefont or "").lower()
    return any(marker in name for marker in _MATH_FONT_MARKERS)


def _detect_needs_mineru(doc) -> tuple[bool, str]:
    """启发式判断 native PDF 是否「文本层拿不到公式/结构」。"""
    reasons: list[str] = []
    for idx in range(min(doc.page_count, _DETECT_MAX_PAGES)):
        page = doc[idx]
        for font in page.get_fonts(full=True) or []:
            ftype = font[2] if len(font) > 2 else ""
            base = font[3] if len(font) > 3 else ""
            if ftype == "Type3":
                reasons.append(f"p{idx + 1}:Type3字体")
            elif _font_is_math(base):
                reasons.append(f"p{idx + 1}:数学字体 {base}")
        try:
            drawings = len(page.get_drawings())
        except Exception:
            drawings = 0
        text_len = len(page.get_text("text").strip())
        if drawings > max(_DRAWING_MIN, text_len // 10):
            reasons.append(f"p{idx + 1}:大量矢量图形 {drawings}")
        if len(reasons) >= 4:
            break
    if reasons:
        return True, "；".join(reasons[:4])
    return False, ""


def inspect_pdf(content: bytes) -> PdfInspection:
    """一次开文档：文本、是否扫描、是否需要走 MinerU（含原因）。"""
    import fitz

    doc = fitz.open(stream=content, filetype="pdf")
    try:
        pages = [page.get_text("text") for page in doc]
        combined = "\n".join(pages).strip()
        is_scanned = len(combined) < 20
        needs, reason = (False, "") if is_scanned else _detect_needs_mineru(doc)
    finally:
        doc.close()
    return PdfInspection(combined, pages, is_scanned, needs, reason)


def parse_zip_markdown(content: bytes) -> tuple[str, dict[str, bytes]]:
    """解压 md.zip：返回 (合并 markdown, 附带图片 {文件名: bytes})。

    - 内部所有 .md 按文件名排序合并为单一文档
    - 其余图片文件收集（后续入图床 + 改写引用）
    """
    zf = zipfile.ZipFile(io.BytesIO(content))
    md_files: list[tuple[str, str]] = []
    images: dict[str, bytes] = {}
    for name in zf.namelist():
        if name.endswith("/"):
            continue
        ext = Path(name).suffix.lower()
        if ext == ".md":
            md_files.append((name, zf.read(name).decode("utf-8", errors="replace")))
        elif ext in IMAGE_EXTENSIONS:
            images[Path(name).name] = zf.read(name)
    zf.close()

    if not md_files:
        raise AppError("zip 中未找到 .md 文件")

    md_files.sort(key=lambda x: x[0])
    combined = "\n\n".join(content for _, content in md_files)
    return combined, images
