"""缩略图：PDF 首页渲染为封面 PNG。"""

from __future__ import annotations

from typing import Optional

from ..core.storage import storage


class ThumbnailService:
    """缩略图领域服务。"""

    def generate_pdf_thumbnail(self, content: bytes) -> Optional[bytes]:
        """渲染 PDF 首页为 PNG 字节。"""
        try:
            import fitz  # PyMuPDF
        except ImportError:
            return None

        doc = fitz.open(stream=content, filetype="pdf")
        if doc.page_count == 0:
            doc.close()
            return None
        page = doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(0.5, 0.5))
        doc.close()
        return pix.tobytes("png")

    def ensure_thumbnail(self, doc_id: str, content: bytes) -> Optional[bytes]:
        """生成并缓存缩略图。"""
        if storage.read_thumbnail(doc_id):
            return storage.read_thumbnail(doc_id)
        png = self.generate_pdf_thumbnail(content)
        if png:
            storage.save_thumbnail(doc_id, png)
        return png


# 模块级单例
thumb_service = ThumbnailService()
