"""学习路径 Agent 的工具：检索当前文档 + 结构化提交学习路径。

工具隔离：每个文档实例化自己的 Tools（闭包绑定 document_id）。
"""

from __future__ import annotations

import json
import re
import uuid

from tina import Tools

_CHAPTER_PREFIX = re.compile(
    r"^第\s*[一二三四五六七八九十百零两\d]+\s*[章节单元篇部分讲点]\s*[、:：.．\-—]?\s*"
)
_KP_SPLIT = re.compile(r"[、，,；;|/／]+")
_KP_NOISE = re.compile(
    r"(p\.?\s*\d+|第\s*\d+\s*页|\d+\s*题|选择题|判断题|填空题|问答题|简答题|论述题|材料分析题|题型|本部分|本章|本节|本讲)"
)


def _expand_key_point(raw: str) -> list[str]:
    """把一个要点串按分隔符 / 括号里的并列概念拆成候选标签。"""
    s = (raw or "").strip()
    if not s:
        return []
    # 把括号替换成分隔符，让括号里的并列概念也能拆出来
    normalized = re.sub(r"[（(]([^（()）]*)[）)]", lambda m: "、" + m.group(1) + "、", s)
    return [part.strip() for part in _KP_SPLIT.split(normalized) if part.strip()]


def clean_key_points(points) -> list[str]:
    """把模型输出的要点整理成短标签：拆并列、去章号、去页码/题型等噪声。

    兼容模型偶尔返回单个字符串 / 非列表的情况。
    """
    if isinstance(points, (str, int, float)):
        points = [points]
    if not isinstance(points, list):
        points = [points] if points else []

    result: list[str] = []
    seen: set[str] = set()
    for raw in points:
        if isinstance(raw, (int, float)):
            raw = str(raw)
        if not isinstance(raw, str):
            continue
        for token in _expand_key_point(raw):
            token = token.strip(" 　·:：.。、,，;；-—_【】[]()（）")
            token = _CHAPTER_PREFIX.sub("", token).strip()
            if not token or len(token) > 24:
                continue
            if _KP_NOISE.search(token):
                continue
            if token in seen:
                continue
            seen.add(token)
            result.append(token)
    return result[:8]


def norm_title(title) -> str:
    """兼容 LLM 各种 title 输出形态。"""
    if isinstance(title, str):
        return title
    if isinstance(title, dict):
        for key in ("title", "zh", "raw", "name"):
            v = title.get(key)
            if isinstance(v, str) and v:
                return v
        for v in title.values():
            if isinstance(v, str) and v:
                return v
    return ""


def norm_chapters(chapters) -> list[dict]:
    """兼容 LLM 各种 chapters 输出形态，递归提取实际章节数组。"""
    if chapters is None:
        return []

    if isinstance(chapters, str):
        try:
            chapters = json.loads(chapters)
        except Exception:
            return []

    if isinstance(chapters, list):
        items = chapters
    elif isinstance(chapters, dict):
        for key in ("chapters", "items", "list", "data"):
            v = chapters.get(key)
            if isinstance(v, list):
                items = v
                break
        else:
            if "title" in chapters or "order" in chapters:
                items = [chapters]
            else:
                return []
    else:
        return []

    result: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = norm_title(item.get("title") or item.get("name") or "")
        order = item.get("order")
        try:
            order = int(order)
        except (TypeError, ValueError):
            order = len(result) + 1
        kp = item.get("key_points") or item.get("points") or item.get("keywords") or []
        if isinstance(kp, dict):
            kp = kp.get("items") or kp.get("list") or []
        if not isinstance(kp, list):
            kp = [kp]
        kp = clean_key_points(kp)
        cid = str(item.get("id") or "").strip()
        row = {"title": title, "order": order, "key_points": kp}
        if cid:
            row["id"] = cid
        result.append(row)
    return result


def ensure_chapter_ids(path: dict | None, previous: dict | None = None) -> bool:
    """给目录章节补上稳定 id，并尽量继承上一版的 learned。返回是否改过 path。"""
    if not isinstance(path, dict):
        return False
    chapters = path.get("chapters")
    if not isinstance(chapters, list):
        return False
    prev_by_title: dict[str, str] = {}
    prev_learned_by_id: dict[str, bool] = {}
    prev_learned_by_title: dict[str, bool] = {}
    for ch in (previous or {}).get("chapters") or []:
        if not isinstance(ch, dict):
            continue
        cid = str(ch.get("id") or "").strip()
        title = str(ch.get("title") or "").strip()
        if cid and title:
            prev_by_title[title] = cid
        learned = bool(ch.get("learned"))
        if cid:
            prev_learned_by_id[cid] = learned
        if title:
            prev_learned_by_title[title] = learned
    changed = False
    for ch in chapters:
        if not isinstance(ch, dict):
            continue
        cid = str(ch.get("id") or "").strip()
        title = str(ch.get("title") or "").strip()
        if cid:
            if ch.get("id") != cid:
                ch["id"] = cid
                changed = True
        else:
            ch["id"] = prev_by_title.get(title) or uuid.uuid4().hex[:8]
            cid = ch["id"]
            changed = True
        if "learned" not in ch:
            inherited = prev_learned_by_id.get(cid)
            if inherited is None and title:
                inherited = prev_learned_by_title.get(title)
            if inherited is not None:
                ch["learned"] = inherited
                changed = True
            else:
                ch["learned"] = False
                changed = True
    return changed


def resolve_chapter_id(learning_path: dict | None, chapter_id: str) -> str:
    """把模型填的 chapter_id（或误填的章标题）收成目录里的 id。"""
    raw = str(chapter_id or "").strip().strip('"').strip("'")
    if not raw:
        return ""
    chapters = (learning_path or {}).get("chapters") or []
    ids = []
    for ch in chapters:
        if not isinstance(ch, dict):
            continue
        cid = str(ch.get("id") or "").strip()
        if cid:
            ids.append((cid, str(ch.get("title") or "").strip()))
    for cid, _title in ids:
        if raw == cid:
            return cid
    for cid, title in ids:
        if raw and title and (raw == title or raw in title or title in raw):
            return cid
    return ""


_path_store: dict[str, dict] = {}


def store_path(document_id: str, path: dict) -> None:
    _path_store[document_id] = path


def get_generated_path(document_id: str) -> dict | None:
    return _path_store.get(document_id)


def build_learning_path_tools(document_id: str):
    """构建学习路径 Agent 的工具集（工具隔离）。

    检索工具复用 ChromaStore 的（已注册 search_knowledge_base / search_document_content），
    此处只补充领域专属的结构化提交工具。
    """
    from ..services.rag import chroma_store

    tools = Tools(name="learning_path")
    tools += chroma_store.get_tools()

    @tools.register(description="提交文档的学习路径（结构化输出，仅调用一次）")
    async def submit_learning_path(title, chapters) -> str:
        """提交文档学习路径。
        Args:
            title: 文档标题
            chapters: 章节列表。每项是一个对象，含：
                title: 章节名
                order: 序号（从 1 开始）
                key_points: 该章 3~6 个核心知识标签（短标签，每项 2~10 个字的
                    名词/名词短语；不要句子、不要页码、不要题型、不要照抄章标题）
        """
        path = {"title": norm_title(title), "chapters": norm_chapters(chapters)}
        ensure_chapter_ids(path)
        store_path(document_id, path)
        return "已保存"

    return tools
