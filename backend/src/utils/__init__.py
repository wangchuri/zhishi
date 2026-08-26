"""通用工具：ID、hash、图片命名、markdown 处理。"""

from __future__ import annotations

import hashlib
import json
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


_TAG_SEP = re.compile(r"[,，、]+")


def parse_tags(tags) -> list[str]:
    """把模型/库里的 tags 收成干净的知识点名。

    出题工具常把 JSON 数组当字符串传入，旧逻辑按逗号切开后会留下
    `["高等数学"`、`"零基础"`、`"归纳法"]` 这类碎片。
    同时模型也常直接传「零基础, 数列, 等比数列」整串，这种要拆开。
    """
    out: list[str] = []
    _collect_tags(tags, out)
    seen: set[str] = set()
    result: list[str] = []
    for name in out:
        if name and name not in seen:
            seen.add(name)
            result.append(name)
    return result


def _clean_tag(raw) -> str:
    t = str(raw).strip()
    if t.startswith("[") and not t.endswith("]"):
        t = t[1:].strip()
    if t.endswith("]") and not t.startswith("["):
        t = t[:-1].strip()
    if len(t) >= 2 and t[0] == t[-1] and t[0] in "\"'":
        t = t[1:-1].strip()
    return t.strip(" ,")


def _collect_tags(tags, out: list[str]) -> None:
    if tags is None or isinstance(tags, bool):
        return
    if isinstance(tags, (list, tuple)):
        for item in tags:
            _collect_tags(item, out)
        return
    if isinstance(tags, dict):
        return
    s = str(tags).strip()
    if not s:
        return
    if s[0] in "[{":
        try:
            _collect_tags(json.loads(s), out)
            return
        except json.JSONDecodeError:
            pass
    if s[0] in "\"'":
        try:
            parsed = json.loads(s)
            if parsed != s:
                _collect_tags(parsed, out)
                return
        except json.JSONDecodeError:
            pass
    name = _clean_tag(s)
    if not name:
        return
    # 已是完整 JSON 的上面会解析。普通逗号串拆开；带 [ ] 的碎片不拆，避免旧 bug。
    if "[" not in name and "]" not in name and _TAG_SEP.search(name):
        parts = [p.strip() for p in _TAG_SEP.split(name) if p.strip()]
        if len(parts) > 1:
            for part in parts:
                _collect_tags(part, out)
            return
    out.append(name)


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
