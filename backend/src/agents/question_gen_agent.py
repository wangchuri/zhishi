"""出题 Agent：基于选中页面生成题目。

- 独立 Agent（工具隔离：每任务独立 QuestionGenTools 实例）
- apredict() 异步流式，消费全部 chunk 后收集工具提交的题目
- 题目入库（hash 去重 + 溯源 + 文档级 refs）
- 语义化引用图片（图片名列表提供给 Agent）
- 参考学习路径判断题目归属
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from ..core.database import SessionLocal
from ..core.llm import create_agent
from ..models import Document
from ..services import question as question_service
from ..tools.question_gen_tools import QuestionGenTools

logger = logging.getLogger(__name__)


def _build_prompt(images: str, learning_path: str) -> str:
    return f"""你是知拾（Zhishi）的智能出题助手，根据给定的教材页面内容生成练习题。

## 出题要求（最重要）
1. **直接基于下面给出的页面内容出题**，页面内容已经完整提供
2. 对页面中的每个核心知识点调用对应的提交工具，一次调用提交一道题
3. 提交工具调用的优先级最高，请尽快调用 submit_* 工具
4. 所有题目提交完毕后回复「出题完成」

## 提交工具
- submit_single_choice：提交一道单选题（含 A/B/C/D 四个选项）
- submit_fill_blank：提交一道填空题（stem 用 ___ 或 {{blank}} 表示空位）
- submit_short_answer：提交一道简答题
- submit_application：提交一道应用题
- submit_custom_question：提交一道自定义 HTML 题型

## 题目规范
- 单选题需提供 A/B/C/D 四个选项，answer 必须是 A/B/C/D 之一
- 填空题 answer 为 JSON 数组字符串
- 简答题/应用题 answer 为标准答案要点
- tags 复用已有标签，不要创建"自动生成"这类无意义标签
- source：textbook（书中例题/习题）或 ai_generated（AI 自行设计）
- page_number：题目对应的页码

## 图片引用
本文档有以下图片资源（图片名可被渲染识别）：
{images}

如果题目（题干或答案）需要配图（如函数图像、几何图形），请在题干/答案 markdown 中使用：
![图注](images/图片文件名)

## 学习路径（题目归属参考）
{learning_path}
根据以上章节结构，判断每道题所属的章节主题，并用于 tags。
"""


async def generate_for_document(
    document_id: str,
    page_numbers: list[int] | None = None,
    questions_per_page: int = 3,
    stream_handler=None,
) -> dict:
    """为文档指定页生成题目。

    stream_handler: 可选回调，接收 {event, content?, questions?} 事件（逐 chunk/页）。
    返回: {"questions_created": n, "questions_reused": n, "total_questions": n}
    """
    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        if not document:
            return {"questions_created": 0, "questions_reused": 0, "total_questions": 0}
        doc_name = document.display_name
    finally:
        db.close()

    from ..core.storage import storage
    from ..models import DocumentImage, DocumentLearningPath

    # 页面上下文：优先按页文件；无页文件（md/docx 等）则用全文作为单页
    pages_context: list[dict] = []
    for num, p in storage.list_pages(document_id):
        pages_context.append({
            "page_number": num,
            "title": f"第 {num} 页",
            "content": p.read_text(encoding="utf-8"),
        })
    if not pages_context:
        full_text = storage.read_parsed(document_id)
        if full_text and full_text.strip():
            pages_context = [{
                "page_number": 1,
                "title": doc_name,
                "content": full_text,
            }]

    if page_numbers:
        selected = {int(n) for n in page_numbers}
        pages_context = [p for p in pages_context if p["page_number"] in selected]

    if not pages_context:
        return {"questions_created": 0, "questions_reused": 0, "total_questions": 0}

    # 图片列表（语义化引用）与学习路径
    db = SessionLocal()
    try:
        imgs = db.query(DocumentImage).filter_by(document_id=document_id).all()
        image_names = [i.file_name for i in imgs]
        lp_rec = db.query(DocumentLearningPath).filter_by(document_id=document_id).first()
        learning_path = json.loads(lp_rec.path_json) if lp_rec and lp_rec.path_json else None
    finally:
        db.close()

    tools = QuestionGenTools(
        document_id,
        pages_context=pages_context,
        image_names=image_names,
        learning_path=learning_path,
        questions_per_page=questions_per_page,
    )
    prompt = _build_prompt(tools._meta["images"], tools._meta["learning_path"])
    agent = create_agent(tools=tools.tools, system_prompt=prompt)

    instruction = (
        f"请为文档「{doc_name}」以下页面出题（每页约 {questions_per_page} 题）：\n\n"
        + "\n\n".join(
            f"## 第 {p['page_number']} 页\n{p['content'][:3000]}"
            for p in pages_context
        )
    )

    try:
        # 异步流式消费全部 chunk，让 Agent 完整跑完（含多轮工具调用）
        async for chunk in agent.apredict(instruction):
            c = chunk.get("content", "")
            if stream_handler and c:
                stream_handler({"event": "chunk", "content": c})
    except Exception as e:
        logger.warning("出题失败 doc=%s: %s", document_id, e)

    submitted = tools.get_submitted()
    logger.info("出题 Agent 收集到 %s 道题", len(submitted))

    # 入库
    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        created = reused = 0
        for q in submitted:
            try:
                _gq, is_new = question_service.store_question(db, document, q)
                db.commit()
                if is_new:
                    created += 1
                else:
                    reused += 1
            except Exception as e:
                db.rollback()
                logger.warning("题目入库失败: %s", e)
        if document:
            document.question_gen_status = "completed"
            db.commit()
    finally:
        db.close()

    result = {
        "questions_created": created,
        "questions_reused": reused,
        "total_questions": len(submitted),
    }
    if stream_handler:
        stream_handler({
            "event": "result",
            "content": "",
            "questions_created": created,
            "questions_reused": reused,
            "total_questions": len(submitted),
        })
    return result
