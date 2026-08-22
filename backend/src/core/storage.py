"""文件存储服务（单用户）。

布局：
  storage_dir/
    documents/{doc_id}/          # 每文档独立文件夹
      original.{ext}             # 原始上传文件
      parsed.md                  # 分页拼接的全文（带「第 N 页」标题，供预览/RAG）
      manifest.json              # {total_pages, pages_dir}
      pages/page_001.md ...      # 按页解析产物（出题/伴学的真源）
      images/                    # 该文档的图片（图床引用目录）
    thumbnails/{doc_id}.png      # 文档封面缩略图

图床说明：
- 所有 md 图片统一以相对路径 images/{file_name} 引用
- 图片实际命名 image_{文档名}-{页码}-{图序号}-{5位uuid}.png（见 images 服务）
- DB（document_images）记录 文档→页→序号→文件名→相对路径
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from .config import config

_PAGE_HEAD_RE = re.compile(r"^#{1,3}\s*第\s*(\d+)\s*页\b")


def _with_page_heading(num: int, text: str) -> str:
    body = (text or "").strip()
    m = _PAGE_HEAD_RE.match(body)
    if m:
        if int(m.group(1)) == num:
            return body
        body = _PAGE_HEAD_RE.sub("", body, count=1).lstrip()
    return f"## 第 {num} 页\n\n{body}" if body else f"## 第 {num} 页"


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
        """按页保存解析产物（page_001.md 等），并写 manifest；parsed.md 由分页拼接。"""
        pages = self.pages_dir(doc_id)
        keep = set()
        bodies: list[str] = []
        for i, text in enumerate(page_texts, 1):
            name = f"page_{i:03d}.md"
            keep.add(name)
            body = _with_page_heading(i, text)
            bodies.append(body)
            (pages / name).write_text(body, encoding="utf-8")
        for p in pages.glob("page_*.md"):
            if p.name not in keep:
                p.unlink()
        manifest = {"version": 1, "total_pages": len(bodies), "pages_dir": "pages"}
        (self.document_dir(doc_id) / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        if bodies:
            self.save_parsed(doc_id, "\n\n".join(bodies))

    def list_pages(self, doc_id: str) -> list[tuple[int, Path]]:
        pages: list[tuple[int, Path]] = []
        d = self.document_dir(doc_id) / "pages"
        if d.is_dir():
            for p in sorted(d.glob("page_*.md")):
                num = int(p.stem.split("_")[1])
                pages.append((num, p))
        return pages

    def read_page(self, doc_id: str, page_number: int) -> str | None:
        path = self.document_dir(doc_id) / "pages" / f"page_{page_number:03d}.md"
        if path.is_file():
            return path.read_text(encoding="utf-8")
        return None

    def ensure_page_headings(self, doc_id: str) -> bool:
        """给已有分页补上「第 N 页」标题，并按分页重写 parsed.md。已规范则跳过。"""
        listed = self.list_pages(doc_id)
        if not listed:
            return False
        first = listed[0][1].read_text(encoding="utf-8")
        man = self.document_dir(doc_id) / "manifest.json"
        if _PAGE_HEAD_RE.match(first.strip()) and man.is_file():
            return False
        changed = False
        bodies: list[str] = []
        for num, path in listed:
            raw = path.read_text(encoding="utf-8")
            body = _with_page_heading(num, raw)
            bodies.append(body)
            if body != raw:
                path.write_text(body, encoding="utf-8")
                changed = True
        man.write_text(
            json.dumps({"version": 1, "total_pages": len(listed), "pages_dir": "pages"}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self.save_parsed(doc_id, "\n\n".join(bodies))
        return True

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
