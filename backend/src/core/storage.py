"""文件存储服务（单用户）。

布局：
  storage_dir/
    documents/{doc_id}/          # 每文档独立文件夹
      original.{ext}             # 原始上传文件
      parsed.md                  # 解析后的 markdown 全文
      pages/page_001.md ...      # 按页解析产物（扫描件/MinerU）
      images/                    # 该文档的图片（图床引用目录）
    thumbnails/{doc_id}.png      # 文档封面缩略图

图床说明：
- 所有 md 图片统一以相对路径 images/{file_name} 引用
- 图片实际命名 image_{文档名}-{页码}-{图序号}-{5位uuid}.png（见 images 服务）
- DB（document_images）记录 文档→页→序号→文件名→相对路径
"""

from __future__ import annotations

import shutil
from pathlib import Path

from .config import config


class StorageService:
    """文件存储门面，操作均基于 config.storage_dir。"""

    def __init__(self, base_dir: str | None = None) -> None:
        self.base = Path(base_dir or config.storage_dir).resolve()
        self.base.mkdir(parents=True, exist_ok=True)

    # ---- 文档文件夹 ----

    def document_dir(self, doc_id: str) -> Path:
        d = self.base / "documents" / doc_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def images_dir(self, doc_id: str) -> Path:
        d = self.document_dir(doc_id) / "images"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def pages_dir(self, doc_id: str) -> Path:
        d = self.document_dir(doc_id) / "pages"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def save_original(self, doc_id: str, filename: str, content: bytes) -> Path:
        """保存原始上传文件到文档文件夹。"""
        ext = Path(filename).suffix.lower()
        path = self.document_dir(doc_id) / f"original{ext}"
        path.write_bytes(content)
        return path

    def read_original(self, doc_id: str) -> bytes | None:
        for p in self.document_dir(doc_id).glob("original.*"):
            return p.read_bytes()
        return None

    def original_path(self, doc_id: str) -> Path | None:
        for p in self.document_dir(doc_id).glob("original.*"):
            return p
        return None

    def save_parsed(self, doc_id: str, content: str) -> Path:
        """保存解析后的 markdown 全文。"""
        path = self.document_dir(doc_id) / "parsed.md"
        path.write_text(content, encoding="utf-8")
        return path

    def read_parsed(self, doc_id: str) -> str | None:
        path = self.document_dir(doc_id) / "parsed.md"
        if path.is_file():
            return path.read_text(encoding="utf-8")
        return None

    def save_pages(self, doc_id: str, page_texts: list[str]) -> None:
        """按页保存解析产物（page_001.md 等）。"""
        pages = self.pages_dir(doc_id)
        for i, text in enumerate(page_texts, 1):
            (pages / f"page_{i:03d}.md").write_text(text, encoding="utf-8")

    def list_pages(self, doc_id: str) -> list[tuple[int, Path]]:
        pages: list[tuple[int, Path]] = []
        d = self.document_dir(doc_id) / "pages"
        if d.is_dir():
            for p in sorted(d.glob("page_*.md")):
                num = int(p.stem.split("_")[1])
                pages.append((num, p))
        return pages

    def read_page(self, doc_id: str, page_number: int) -> str | None:
        for num, p in self.list_pages(doc_id):
            if num == page_number:
                return p.read_text(encoding="utf-8")
        return None

    def save_image(self, doc_id: str, file_name: str, content: bytes) -> Path:
        """保存图片到文档 images 目录。"""
        path = self.images_dir(doc_id) / file_name
        path.write_bytes(content)
        return path

    def read_image(self, doc_id: str, file_name: str) -> bytes | None:
        path = self.images_dir(doc_id) / file_name
        if path.is_file():
            return path.read_bytes()
        return None

    # ---- 缩略图 ----

    def thumbnail_dir(self) -> Path:
        d = self.base / "thumbnails"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def save_thumbnail(self, doc_id: str, content: bytes) -> Path:
        path = self.thumbnail_dir() / f"{doc_id}.png"
        path.write_bytes(content)
        return path

    def read_thumbnail(self, doc_id: str) -> bytes | None:
        path = self.thumbnail_dir() / f"{doc_id}.png"
        if path.is_file():
            return path.read_bytes()
        return None

    # ---- 清理 ----

    def delete_document(self, doc_id: str) -> bool:
        d = self.document_dir(doc_id)
        if d.exists():
            shutil.rmtree(d)
            return True
        return False

    def delete_thumbnail(self, doc_id: str) -> bool:
        path = self.thumbnail_dir() / f"{doc_id}.png"
        if path.exists():
            path.unlink()
            return True
        return False


# 模块级单例
storage = StorageService()
