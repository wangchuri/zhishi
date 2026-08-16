"""通用工具：ID、hash、图片命名、markdown 处理。"""

from __future__ import annotations

import hashlib
import random
import re
import string
import uuid

_SLUG_UNSAFE = re.compile(r"[^\w\u4e00-\u9fff-]")


def new_id() -> str:
    """生成短随机 id。"""
    return uuid.uuid4().hex


def sha256_hex(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def random_suffix(length: int = 5) -> str:
    """随机字母数字串（默认 5 位）。"""
    chars = string.ascii_lowercase + string.digits
    return "".join(random.choice(chars) for _ in range(length))


def slugify(name: str) -> str:
    """文件名清洗：保留中文/字母/数字/下划线/连字符，其余转 -。"""
    s = _SLUG_UNSAFE.sub("-", name.strip())
    s = re.sub(r"-+", "-", s)
    return s.strip("-") or "doc"


def image_file_name(
    doc_name: str,
    page_num: int,
    image_index: int,
    ext: str = "png",
) -> str:
    """语义化图片命名：image_{文档名}-{页码}-{图序号}-{5位uuid}.{ext}。

    前端可从文件名解析出 文档/页码/序号；uuid 尾防止同名冲突。
    """
    base = slugify(doc_name)
    suffix = random_suffix(5)
    ext = ext.lower().lstrip(".")
    if ext not in ("png", "jpg", "jpeg", "gif", "webp", "bmp"):
        ext = "png"
    return f"image_{base}-{page_num:03d}-{image_index}-{suffix}.{ext}"


def escape_ordered_list_numbers(md: str) -> str:
    """转义行首有序列表编号：`1. ` → `1\\. `，避免 remark-gfm 渲染成有序列表。

    仅当后跟空白时才转义（避免误伤版本号等）。
    """
    pattern = re.compile(r"(?m)^(\d{1,3})\.(?=\s)")
    return pattern.sub(r"\1\\.", md)


def rewrite_image_refs(md: str, old_prefix: str, new_prefix: str) -> str:
    """改写 markdown 图片引用路径前缀。"""
    return md.replace(old_prefix, new_prefix)
