"""
多格式文件解析器
支持 TXT / MD / CSV / JSON / HTML / PDF / DOCX
"""
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# 支持的文件类型映射
SUPPORTED_EXTENSIONS = {
    ".txt": "text",
    ".md": "text",
    ".csv": "text",
    ".json": "text",
    ".html": "text",
    ".htm": "text",
    ".pdf": "pdf",
    ".docx": "docx",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".webp": "image",
    ".bmp": "image",
}

# 图片扩展名集合（需要 OCR 处理）
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

# 文件大小上限：10MB
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024


def parse_file(file_path: str) -> Optional[str]:
    """
    根据文件类型解析内容，返回纯文本

    Args:
        file_path: 本地文件路径

    Returns:
        str or None: 解析出的文本内容，失败返回 None
    """
    path_obj = Path(file_path)
    if not path_obj.exists():
        logger.error(f"file_parser - 文件不存在: {file_path}")
        return None

    suffix = path_obj.suffix.lower()
    file_type = SUPPORTED_EXTENSIONS.get(suffix)

    if file_type is None:
        logger.warning(f"file_parser - 不支持的文件类型: {suffix}")
        return None

    # 检查文件大小
    try:
        size = path_obj.stat().st_size
        if size > MAX_FILE_SIZE_BYTES:
            logger.warning(f"file_parser - 文件过大 ({size} bytes): {file_path}")
            return None
    except OSError:
        pass

    if file_type == "text":
        return _parse_text(file_path)
    elif file_type == "pdf":
        return _parse_pdf(file_path)
    elif file_type == "docx":
        return _parse_docx(file_path)

    return None


def _parse_text(file_path: str) -> Optional[str]:
    """解析纯文本文件（TXT/MD/CSV/JSON/HTML），尝试多种编码"""
    encodings = ["utf-8", "gbk", "gb2312", "latin-1"]
    for enc in encodings:
        try:
            with open(file_path, "r", encoding=enc, errors="replace") as f:
                return f.read()
        except UnicodeDecodeError:
            continue
        except Exception as e:
            logger.error(f"file_parser._parse_text 失败 ({enc}): {e}")
            continue
    return None


def _parse_pdf(file_path: str) -> Optional[str]:
    """解析 PDF 文件"""
    try:
        import pdfplumber
    except ImportError:
        logger.warning("file_parser - pdfplumber 未安装，回退到 PyPDF2")
        return _parse_pdf_pypdf2(file_path)

    try:
        with pdfplumber.open(file_path) as pdf:
            pages_text = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages_text.append(text)
            return "\n\n".join(pages_text) if pages_text else None
    except Exception as e:
        logger.warning(f"file_parser._parse_pdf (pdfplumber) 失败: {e}，回退到 PyPDF2")
        return _parse_pdf_pypdf2(file_path)


def _parse_pdf_pypdf2(file_path: str) -> Optional[str]:
    """PyPDF2 回退解析"""
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(file_path)
        pages_text = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                pages_text.append(text)
        return "\n\n".join(pages_text) if pages_text else None
    except ImportError:
        logger.error("file_parser - PyPDF2 未安装，无法解析 PDF")
        return None
    except Exception as e:
        logger.error(f"file_parser._parse_pdf_pypdf2 失败: {e}")
        return None


def _parse_docx(file_path: str) -> Optional[str]:
    """解析 DOCX 文件"""
    try:
        from docx import Document
        doc = Document(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(paragraphs) if paragraphs else None
    except ImportError:
        logger.error("file_parser - python-docx 未安装，无法解析 DOCX")
        return None
    except Exception as e:
        logger.error(f"file_parser._parse_docx 失败: {e}")
        return None


def get_supported_extensions() -> list:
    """返回支持的文件扩展名列表"""
    return list(SUPPORTED_EXTENSIONS.keys())