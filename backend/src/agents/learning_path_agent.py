"""学习路径 Agent：每文档一个独立 Agent，异步流式生成学习路径。

流程：
1. 文档向量化完成后触发
2. 独立 Agent（工具隔离：每个文档自己的 Tools 实例，见 tools/learning_path_tools）
3. 使用 apredict() 异步流式消费全部 chunk
4. on_turn_end 兜底：无结构化输出则标记 failed
5. 并发受 max_concurrency 限制（超出排队）
"""

from __future__ import annotations

import asyncio
import json
import logging
import weakref
from typing import Optional

from ..core.config import config
from ..core.database import SessionLocal
from ..core.llm import create_agent
from ..models import DocumentLearningPath
from ..tools.learning_path_tools import (
    build_learning_path_tools,
    ensure_chapter_ids,
    get_generated_path,
)

logger = logging.getLogger(__name__)

PROMPT = """你是知识整理专家。给定一本书/文档的前几页内容和检索工具，找出这本书的目录结构和学习顺序。

请分析文档的开头部分（通常是目录/前言），梳理出：
1. 文档标题
2. 章节结构（chapters）：每章的标题、顺序，以及本章的核心知识标签 key_points

key_points 的硬性要求（它会被当作知识点 tag 使用，必须是短标签，不是句子）：
- 每项 2~10 个字，名词或名词短语，例如「唯物论」「剩余价值理论」「社会基本矛盾」
- 每章 3~6 个，覆盖该章最核心的概念
- 禁止照抄章标题；禁止页码（如 p.1）、题型（如选择题）、「本部分 / 含…」这类描述
- 章标题括号里的并列概念要拆成多个独立标签
- 示例：章标题「世界的物质性及发展规律（唯物论、辩证法、物质与意识、时空观）」
  → key_points: ["世界的物质性", "发展规律", "唯物论", "辩证法", "物质与意识", "时空观"]

最终调用 submit_learning_path 工具提交结构化结果。
如果你找不到目录，就根据开头内容合理推断章节划分。

只调用 submit_learning_path 一次并提交完整结果。"""


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

    from ..core.storage import storage

    front_pages = ""
    for _num, p in storage.list_pages(document_id)[:8]:
        front_pages += p.read_text(encoding="utf-8") + "\n\n"

    tools = build_learning_path_tools(document_id)
    agent = create_agent(tools=tools, system_prompt=PROMPT)

    instruction = (
        f"文档ID: {document_id}\n以下是文档开头内容（前几页）：\n\n"
        f"{front_pages or '（无可提供的前几页，请用检索工具了解内容）'}"
    )

    produced = {"ok": False}

    def _check_output():
        if get_generated_path(document_id) is not None:
            produced["ok"] = True

    agent.add_on_turn_end_handler(_check_output)

    def _mark(status: str) -> None:
        db = SessionLocal()
        try:
            rec = db.query(DocumentLearningPath).filter(
                DocumentLearningPath.document_id == document_id
            ).first()
            if rec:
                rec.status = status
                db.commit()
        finally:
            db.close()

    try:
        # 异步流式消费全部 chunk（托管流式）：apredict 返回 async generator，直接 async for 迭代
        async for _chunk in agent.apredict(instruction):
            pass

        path = get_generated_path(document_id)
        if path is not None:
            _mark("generated")
            db = SessionLocal()
            try:
                rec = db.query(DocumentLearningPath).filter(
                    DocumentLearningPath.document_id == document_id
                ).first()
                if rec:
                    previous = None
                    if rec.path_json:
                        try:
                            parsed = json.loads(rec.path_json)
                            if isinstance(parsed, dict):
                                previous = parsed
                        except json.JSONDecodeError:
                            previous = None
                    ensure_chapter_ids(path, previous)
                    rec.path_json = json.dumps(path, ensure_ascii=False)
                    rec.model = "deepseek-v4-flash"
                    db.commit()
            finally:
                db.close()
            return {"status": "generated", "path": path}

        _mark("failed")
        return {"status": "failed", "path": None}
    except Exception as e:
        logger.warning("学习路径生成失败 doc=%s: %s", document_id, e)
        _mark("failed")
        return {"status": "failed", "path": None}


# ---- 并发调度 ----

# 每个事件循环一个信号量：后台线程用 asyncio.run 新建循环，复用同一个
# asyncio.Semaphore 会跨循环，报 “attached to a different loop”。
_semaphores: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary()
)
_pending: set[str] = set()
_tasks: set[asyncio.Task] = set()


def _get_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    sem = _semaphores.get(loop)
    if sem is None:
        sem = asyncio.Semaphore(max(1, config.max_concurrency))
        _semaphores[loop] = sem
    return sem


async def run_learning_path(document_id: str) -> dict:
    """受并发限制地生成一次学习路径（真正干活的协程）。"""
    _pending.add(document_id)
    try:
        async with _get_semaphore():
            return await generate_learning_path(document_id)
    finally:
        _pending.discard(document_id)


def schedule_learning_path(document_id: str) -> Optional[asyncio.Task]:
    """触发后台生成学习路径。

    - 在事件循环内调用（FastAPI 接口）：挂成后台 task 立即返回；
    - 在普通线程里调用（解析完成回调）：用 asyncio.run 在本次调用内跑完。

    旧实现在线程里 `asyncio.run(schedule_learning_path(...))`：schedule 返回的是
    create_task 出来的 task，asyncio.run 见主协程结束就取消所有未完成 task 并关循环，
    导致生成刚开始就被取消。现在线程分支直接 run 整个生成协程。
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(run_learning_path(document_id))
        return None

    task = loop.create_task(run_learning_path(document_id))
    # 保存强引用，否则 task 可能在跑完前被 GC
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task
