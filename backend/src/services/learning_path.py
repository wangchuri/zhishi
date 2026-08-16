"""学习路径 Agent：每文档一个独立 Agent，异步流式生成学习路径。

流程：
1. 文档向量化完成后触发
2. 独立 Agent（工具隔离：每个文档自己的 Tools 实例）
3. 工具：检索当前文档 + 结构化输出学习路径
4. 使用 apredict() 异步流式消费全部 chunk
5. on_turn_end 兜底：无结构化输出则标记 failed
6. 并发受 max_concurrency 限制（超出排队）
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from sqlalchemy.orm import Session

from ..core.config import config
from ..core.database import SessionLocal
from ..core.llm import create_agent
from ..models import DocumentLearningPath
from . import rag

logger = logging.getLogger(__name__)

PROMPT = """你是知识整理专家。给定一本书/文档的前几页内容和检索工具，找出这本书的目录结构和学习顺序。

请分析文档的开头部分（通常是目录/前言），梳理出：
1. 文档标题
2. 章节结构（chapters）：每章的标题、顺序、以及本章的核心要点 key_points

最终调用 submit_learning_path 工具提交结构化结果。
如果你找不到目录，就根据开头内容合理推断章节划分。

只调用 submit_learning_path 一次并提交完整结果。"""


def _norm_title(title) -> str:
    """兼容 LLM 各种 title 输出形态。"""
    if isinstance(title, str):
        return title
    if isinstance(title, dict):
        for key in ("title", "zh", "raw", "name"):
            v = title.get(key)
            if isinstance(v, str) and v:
                return v
        # 取第一个字符串值
        for v in title.values():
            if isinstance(v, str) and v:
                return v
    return ""


def _norm_chapters(chapters) -> list[dict]:
    """兼容 LLM 各种 chapters 输出形态，递归提取实际章节数组。"""
    if chapters is None:
        return []

    # LLM 可能把 chapters 序列化成 JSON 字符串
    if isinstance(chapters, str):
        try:
            chapters = json.loads(chapters)
        except Exception:
            return []

    if isinstance(chapters, list):
        items = chapters
    elif isinstance(chapters, dict):
        # 常见包裹键：chapters / items / list
        for key in ("chapters", "items", "list", "data"):
            v = chapters.get(key)
            if isinstance(v, list):
                items = v
                break
        else:
            # 可能是单章节对象
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
        title = _norm_title(item.get("title") or item.get("name") or "")
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


def _build_tools(document_id: str, max_pages: int = 8):
    """构建学习路径 Agent 的工具（工具隔离：闭包绑定具体文档）。"""
    from tina import Tools

    tools = Tools()

    @tools.register(description="检索当前文档内容（返回相关片段）")
    def search_document(query: str) -> str:
        """检索当前文档，返回与 query 相关的段落。
        Args:
            query: 检索关键词/问题
        """
        results = rag.search_document(document_id, query, top_k=3)
        if not results:
            return "（未检索到相关内容）"
        return "\n---\n".join(r["text"] for r in results)

    @tools.register(description="提交文档的学习路径（结构化输出，仅调用一次）")
    def submit_learning_path(title, chapters) -> str:
        """提交文档学习路径。
        Args:
            title: 文档标题
            chapters: 章节列表，每项含 title/order/key_points
        """
        path = {"title": _norm_title(title), "chapters": _norm_chapters(chapters)}
        _store_path(document_id, path)
        return "已保存"

    return tools


_path_store: dict[str, dict] = {}


def _store_path(document_id: str, path: dict) -> None:
    _path_store[document_id] = path


def get_generated_path(document_id: str) -> Optional[dict]:
    return _path_store.get(document_id)


async def generate_learning_path(document_id: str) -> dict:
    """为单个文档生成学习路径（独立 Agent + 异步流式）。

    返回: {"status": "generated"|"failed", "path": {...} | None}
    """
    db = SessionLocal()
    try:
        record = db.query(DocumentLearningPath).filter(
            DocumentLearningPath.document_id == document_id
        ).first()
        if record is None:
            record = DocumentLearningPath(document_id=document_id, status="pending")
            db.add(record)
            db.commit()
    finally:
        db.close()

    # 文档前几页内容（作为目录线索）
    from ..core.storage import storage

    front_pages = ""
    for num, p in storage.list_pages(document_id)[:8]:
        front_pages += p.read_text(encoding="utf-8") + "\n\n"

    tools = _build_tools(document_id)
    agent = create_agent(tools=tools, system_prompt=PROMPT)

    instruction = f"文档ID: {document_id}\n以下是文档开头内容（前几页）：\n\n{front_pages or '（无可提供的前几页，请用检索工具了解内容）'}"

    # on_turn_end 兜底：记录是否有结构化输出
    produced = {"ok": False}

    def _check_output():
        path = get_generated_path(document_id)
        if path is not None:
            produced["ok"] = True

    agent.add_on_turn_end_handler(_check_output)

    try:
        # 异步流式消费全部 chunk（托管流式）：apredict 返回 async generator，直接 async for 迭代
        async for _chunk in agent.apredict(instruction):
            pass

        path = get_generated_path(document_id)
        if path is not None:
            db = SessionLocal()
            try:
                rec = db.query(DocumentLearningPath).filter(
                    DocumentLearningPath.document_id == document_id
                ).first()
                if rec:
                    rec.path_json = json.dumps(path, ensure_ascii=False)
                    rec.status = "generated"
                    rec.model = "deepseek-v4-flash"
                    db.commit()
            finally:
                db.close()
            return {"status": "generated", "path": path}

        # on_turn_end 兜底：无输出 → failed
        db = SessionLocal()
        try:
            rec = db.query(DocumentLearningPath).filter(
                DocumentLearningPath.document_id == document_id
            ).first()
            if rec:
                rec.status = "failed"
                db.commit()
        finally:
            db.close()
        return {"status": "failed", "path": None}
    except Exception as e:
        logger.warning("学习路径生成失败 doc=%s: %s", document_id, e)
        db = SessionLocal()
        try:
            rec = db.query(DocumentLearningPath).filter(
                DocumentLearningPath.document_id == document_id
            ).first()
            if rec:
                rec.status = "failed"
                db.commit()
        finally:
            db.close()
        return {"status": "failed", "path": None}


# ---- 并发调度 ----

_semaphore: Optional[asyncio.Semaphore] = None
_pending: set[str] = set()


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, config.max_concurrency))
    return _semaphore


async def schedule_learning_path(document_id: str) -> asyncio.Task:
    """并发调度：每文档一个任务，受 max_concurrency 限制排队。"""
    sem = _get_semaphore()

    async def _run():
        async with sem:
            try:
                await generate_learning_path(document_id)
            finally:
                _pending.discard(document_id)

    _pending.add(document_id)
    return asyncio.create_task(_run())
