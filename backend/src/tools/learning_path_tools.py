"""学习路径 Agent 的工具：检索当前文档 + 结构化提交学习路径。

工具隔离：每个文档实例化自己的 Tools（闭包绑定 document_id）。
"""

from __future__ import annotations

import json

from tina import Tools


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
        kp = [str(k) for k in kp if k]
        result.append({"title": title, "order": order, "key_points": kp})
    return result


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
            chapters: 章节列表，每项含 title/order/key_points
        """
        path = {"title": norm_title(title), "chapters": norm_chapters(chapters)}
        store_path(document_id, path)
        return "已保存"

    return tools
