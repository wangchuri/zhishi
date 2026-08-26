"""出题 Agent：每页一个独立 Agent，按配置并行数限流。

- 独立 Agent（工具隔离：每页独立 QuestionGenTools 实例）
- apredict() 异步流式，消费全部 chunk 后收集工具提交的题目
- on_turn_end 检查数量上限：超了截断；一轮结束仍为 0 则再催一次
- 题目入库（hash 去重 + 溯源 + 文档级 refs）
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import uuid
from typing import Any, Callable

from ..core.config import config
from ..core.database import SessionLocal
from ..core.llm import create_agent
from ..core.prompts import render_prompt
from ..models import Document, DocumentLearningPath
from ..services.question import question_service
from ..services.question_gen_jobs import question_gen_jobs
from ..tools.learning_path_tools import ensure_chapter_ids
from ..tools.question_gen_tools import QuestionGenTools

logger = logging.getLogger(__name__)

# 0 = 不限制每页题数；自由发挥时按页给一个宽松安全上限，避免被理解成要出 500 题
_SAFE_TOTAL_CAP = 500
_FREE_PER_PAGE_CAP = 10

_SUBMIT_TOOLS = {
    "submit_single_choice",
    "submit_fill_blank",
    "submit_short_answer",
    "submit_application",
    "submit_custom_question",
}


def _normalize_per_page(value: int | None) -> int:
    if value is None:
        return 3
    return max(0, int(value))


def _chunk_to_event(chunk) -> dict | None:
    """把 Tina on_stream_chunk 的 AgentResponse/dict 收成前端可展示的事件。"""
    if isinstance(chunk, dict):
        content = chunk.get("content") or ""
        reasoning = chunk.get("reasoning_content") or ""
        tool_name = chunk.get("tool_name")
        tool_arguments = chunk.get("tool_arguments")
        tool_calls = chunk.get("tool_calls")
    else:
        content = getattr(chunk, "content", None) or ""
        reasoning = getattr(chunk, "reasoning_content", None) or ""
        tool_name = getattr(chunk, "tool_name", None)
        tool_arguments = getattr(chunk, "tool_arguments", None)
        tool_calls = getattr(chunk, "tool_calls", None)

    if reasoning:
        return {"event": "chunk", "content": "", "reasoning": str(reasoning)}
    if tool_name:
        # 参数流每个 fragment 都带 tool_name，只在工具开始时通知前端
        if tool_arguments:
            return None
        return {"event": "tool", "tool_name": str(tool_name), "content": str(content or "")}
    if tool_calls:
        names: list[str] = []
        for call in tool_calls:
            if isinstance(call, dict):
                fn = call.get("function") if isinstance(call.get("function"), dict) else {}
                names.append(str(fn.get("name") or call.get("name") or ""))
            else:
                names.append(str(getattr(call, "name", "") or ""))
        label = "、".join(n for n in names if n)
        if label:
            return {"event": "tool", "tool_name": label, "content": ""}
    if content:
        return {"event": "chunk", "content": str(content)}
    return None


def _tool_name(call) -> str:
    if isinstance(call, dict):
        return str(call.get("name") or call.get("function", {}).get("name") or "")
    return str(getattr(call, "name", "") or "")


def _page_cap(questions_per_page: int, agent_free: bool) -> int:
    if agent_free:
        return _FREE_PER_PAGE_CAP
    return max(1, questions_per_page)


async def _run_page_agent(
    *,
    document_id: str,
    doc_name: str,
    page: dict,
    learning_path: Any,
    questions_per_page: int,
    page_cap: int,
    agent_free: bool,
    job_id: str,
    agent_id: str,
    publish: Callable[[dict], None],
    counts_lock: threading.Lock,
    page_counts: dict[str, int],
) -> list:
    """跑完单页 Agent，返回该页提交的题目。"""
    page_number = int(page["page_number"])
    tools = QuestionGenTools(
        document_id,
        pages_context=[page],
        learning_path=learning_path,
        questions_per_page=questions_per_page,
        total_cap=page_cap,
    )
    prompt = render_prompt(
        "question_gen/generate_questions.md.j2",
        learning_path=tools._meta["learning_path"],
        questions_per_page=questions_per_page,
        page_count=1,
        total_cap=page_cap,
        agent_free=agent_free,
    )
    agent = create_agent(tools=tools.tools, system_prompt=prompt, max_tool_loop=12)

    if agent_free:
        quota = (
            "本页出几道请根据内容自行决定（目录/空白页可少出或不出，"
            "知识点密集页一般 1～数道即可），不要为凑数而多出。"
        )
    else:
        quota = f"本页最多 {page_cap} 道，达到上限立即停止。"

    instruction = (
        f"你是 Agent `{agent_id}`，只负责文档「{doc_name}」第 {page_number} 页。"
        f"{quota}\n"
        f"提交时 page_number 必须填 {page_number}。"
        f"{' chapter_id 必须填本页所属章节的 id（见系统提示目录）。' if learning_path and (learning_path.get('chapters') or []) else ''}"
        f"下面就是本页正文，请直接阅读后出题，不要先检索。\n\n"
        f"## 第 {page_number} 页\n{page['content'][:3000]}"
    )

    def _on_stream_chunk(chunk) -> None:
        ev = _chunk_to_event(chunk)
        if ev:
            publish(ev)

    def _on_turn_end():
        n = tools.count_submitted()
        with counts_lock:
            page_counts[agent_id] = n
            total = sum(page_counts.values())
        question_gen_jobs.update_submitted(job_id, total)
        question_gen_jobs.upsert_agent(job_id, agent_id, page=page_number, submitted=n)
        publish({"event": "status", "submitted": n, "content": f"已提交 {n} 题"})
        calls = agent.get_tools_call() or []
        submit_n = sum(1 for c in calls if _tool_name(c) in _SUBMIT_TOOLS)
        if n > page_cap:
            dropped = tools.trim_to(page_cap)
            logger.info(
                "agent=%s 第 %s 页超限：提交 %s，上限 %s，丢弃 %s",
                agent_id, page_number, n, page_cap, dropped,
            )
        elif n == 0:
            logger.info("agent=%s 第 %s 页尚未提交（submit 工具调用 %s）", agent_id, page_number, submit_n)
        else:
            logger.info(
                "agent=%s 第 %s 页已提交 %s/%s 道（工具调用 %s）",
                agent_id, page_number, n, page_cap, submit_n,
            )

    agent.add_on_stream_chunk_handler(_on_stream_chunk)
    agent.add_on_turn_end_handler(_on_turn_end)

    try:
        follow_up = instruction
        for round_i in range(2):
            async for _chunk in agent.apredict(follow_up):
                pass
            if tools.count_submitted() > 0:
                break
            follow_up = f"你还没有用 submit_* 提交题目。请立即为本页提交。{quota}"
            logger.info("agent=%s 第 %s 页第 %s 轮未提交，追加催促", agent_id, page_number, round_i + 1)
    except Exception as e:
        logger.warning("出题失败 doc=%s agent=%s page=%s: %s", document_id, agent_id, page_number, e)
        raise

    submitted = tools.get_submitted()
    if len(submitted) > page_cap:
        submitted = submitted[:page_cap]
    for q in submitted:
        q["page_number"] = page_number
    with counts_lock:
        page_counts[agent_id] = len(submitted)
        question_gen_jobs.update_submitted(job_id, sum(page_counts.values()))
    question_gen_jobs.upsert_agent(
        job_id, agent_id, page=page_number, submitted=len(submitted),
    )
    return submitted


def _load_learning_path(db, document_id: str) -> dict | None:
    lp_rec = db.query(DocumentLearningPath).filter_by(document_id=document_id).first()
    learning_path = None
    if lp_rec and lp_rec.path_json:
        try:
            parsed = json.loads(lp_rec.path_json)
            if isinstance(parsed, dict):
                learning_path = parsed
        except json.JSONDecodeError:
            learning_path = None
    if learning_path and ensure_chapter_ids(learning_path) and lp_rec:
        lp_rec.path_json = json.dumps(learning_path, ensure_ascii=False)
        db.commit()
    return learning_path


def _store_questions(document_id: str, questions: list) -> tuple[int, int]:
    created = reused = 0
    if not questions:
        return 0, 0
    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        if not document:
            return 0, 0
        for q in questions:
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
        return created, reused
    finally:
        db.close()


async def generate_for_document(
    document_id: str,
    page_numbers: list[int] | None = None,
    questions_per_page: int = 3,
    stream_handler=None,
) -> dict:
    """为文档指定页生成题目。每页一个 Agent，并行数读配置。

    stream_handler: 可选回调，接收 {event, content?, questions?} 事件（逐 chunk/页）。
    返回: {"questions_created": n, "questions_reused": n, "total_questions": n}
    """
    questions_per_page = _normalize_per_page(questions_per_page)
    agent_free = questions_per_page <= 0
    max_parallel = config.question_gen_max_concurrency
    max_pages = config.question_gen_max_pages

    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        if not document:
            return {"questions_created": 0, "questions_reused": 0, "total_questions": 0}
        doc_name = document.display_name
    finally:
        db.close()

    from ..core.storage import storage

    storage.ensure_page_headings(document_id)
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

    truncated = False
    if len(pages_context) > max_pages:
        pages_context = pages_context[:max_pages]
        truncated = True

    page_cap = _page_cap(questions_per_page, agent_free)
    total_cap = min(_SAFE_TOTAL_CAP, page_cap * max(1, len(pages_context)))

    job_id = question_gen_jobs.start(
        document_id=document_id,
        document_name=doc_name,
        page_numbers=[int(p["page_number"]) for p in pages_context],
        questions_per_page=questions_per_page,
        total_cap=total_cap,
        max_concurrency=max_parallel,
    )

    loop = None
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    def _publish_job(ev: dict) -> None:
        question_gen_jobs.emit(job_id, ev)
        if not stream_handler:
            return
        if loop is not None and loop.is_running():
            try:
                running = asyncio.get_running_loop() is loop
            except RuntimeError:
                running = False
            if running:
                stream_handler(ev)
            else:
                loop.call_soon_threadsafe(stream_handler, ev)
        else:
            stream_handler(ev)

    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        if document:
            document.question_gen_status = "processing"
            db.commit()
    finally:
        db.close()

    created = reused = 0
    submitted_all: list = []
    gen_ok = False
    tallies = {"created": 0, "reused": 0, "ok": 0, "fail": 0}
    try:
        db = SessionLocal()
        try:
            learning_path = _load_learning_path(db, document_id)
        finally:
            db.close()

        if truncated:
            _publish_job({
                "event": "status",
                "content": f"单次最多 {max_pages} 页，已截取前 {max_pages} 页",
            })

        n_chapters = len((learning_path or {}).get("chapters") or []) if learning_path else 0
        if n_chapters:
            _publish_job({
                "event": "status",
                "content": f"已加载书本目录 {n_chapters} 章，出题将挂到对应 chapter_id",
            })
        else:
            _publish_job({
                "event": "status",
                "content": "本书还没有目录，本次出题不挂章节",
            })

        _publish_job({
            "event": "status",
            "content": f"共 {len(pages_context)} 页，并行 {max_parallel} 路，每页一个 Agent",
        })

        sem = asyncio.Semaphore(max_parallel)
        counts_lock = threading.Lock()
        page_counts: dict[str, int] = {}
        db_lock = asyncio.Lock()

        async def run_one(page: dict) -> None:
            page_number = int(page["page_number"])
            agent_id = uuid.uuid4().hex[:8]
            question_gen_jobs.upsert_agent(
                job_id, agent_id, page=page_number, status="queued", submitted=0,
            )
            _publish_job({
                "event": "agent_queued",
                "agent_id": agent_id,
                "page": page_number,
            })
            async with sem:
                question_gen_jobs.upsert_agent(
                    job_id, agent_id, page=page_number, status="running",
                )
                _publish_job({
                    "event": "agent_start",
                    "agent_id": agent_id,
                    "page": page_number,
                })

                def publish(ev: dict) -> None:
                    _publish_job({**ev, "agent_id": agent_id, "page": page_number})

                try:
                    questions = await _run_page_agent(
                        document_id=document_id,
                        doc_name=doc_name,
                        page=page,
                        learning_path=learning_path,
                        questions_per_page=questions_per_page,
                        page_cap=page_cap,
                        agent_free=agent_free,
                        job_id=job_id,
                        agent_id=agent_id,
                        publish=publish,
                        counts_lock=counts_lock,
                        page_counts=page_counts,
                    )
                    async with db_lock:
                        c, r = await asyncio.to_thread(_store_questions, document_id, questions)
                        tallies["created"] += c
                        tallies["reused"] += r
                        tallies["ok"] += 1
                        submitted_all.extend(questions)
                    question_gen_jobs.upsert_agent(
                        job_id, agent_id, page=page_number, status="done",
                        submitted=len(questions),
                    )
                    publish({
                        "event": "page_done",
                        "count": len(questions),
                    })
                except Exception as e:
                    async with db_lock:
                        tallies["fail"] += 1
                    logger.warning(
                        "页 Agent 失败 doc=%s agent=%s page=%s: %s",
                        document_id, agent_id, page_number, e,
                    )
                    question_gen_jobs.upsert_agent(
                        job_id, agent_id, page=page_number, status="error",
                    )
                    _publish_job({
                        "event": "page_error",
                        "agent_id": agent_id,
                        "page": page_number,
                        "content": str(e),
                    })

        await asyncio.gather(*[run_one(p) for p in pages_context], return_exceptions=True)
        created = tallies["created"]
        reused = tallies["reused"]
        gen_ok = tallies["ok"] > 0 or tallies["fail"] == 0
        question_gen_jobs.update_submitted(job_id, len(submitted_all))
        logger.info(
            "出题完成 doc=%s 页=%s 成功=%s 失败=%s 题=%s 并行=%s",
            document_id, len(pages_context), tallies["ok"], tallies["fail"],
            len(submitted_all), max_parallel,
        )

        db = SessionLocal()
        try:
            document = db.get(Document, document_id)
            if document:
                document.question_gen_status = "completed" if gen_ok else "failed"
                db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.warning("出题任务异常 doc=%s: %s", document_id, e)
        db = SessionLocal()
        try:
            document = db.get(Document, document_id)
            if document:
                document.question_gen_status = "failed"
                db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
    finally:
        created = tallies["created"]
        reused = tallies["reused"]
        question_gen_jobs.finish(job_id, {
            "questions_created": created,
            "questions_reused": reused,
            "total_questions": len(submitted_all),
        })

    result = {
        "questions_created": created,
        "questions_reused": reused,
        "total_questions": len(submitted_all),
    }
    if stream_handler:
        stream_handler({
            "event": "result",
            "content": "",
            "questions_created": created,
            "questions_reused": reused,
            "total_questions": len(submitted_all),
        })
    return result


def _cli_make_page_agent(document_id: str, page_number: int):
    """按线上同款方式建单页出题 Agent，供终端试跑。"""
    from ..core.storage import storage

    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        if not document:
            raise SystemExit(f"文档不存在: {document_id}")
        doc_name = document.display_name
        learning_path = _load_learning_path(db, document_id)
    finally:
        db.close()

    page = None
    for num, p in storage.list_pages(document_id):
        if int(num) == int(page_number):
            page = {
                "page_number": int(num),
                "title": f"第 {num} 页",
                "content": p.read_text(encoding="utf-8"),
            }
            break
    if page is None:
        raise SystemExit(f"文档 {document_id} 没有第 {page_number} 页")

    page_cap = _FREE_PER_PAGE_CAP
    tools = QuestionGenTools(
        document_id,
        pages_context=[page],
        learning_path=learning_path,
        questions_per_page=0,
        total_cap=page_cap,
    )
    prompt = render_prompt(
        "question_gen/generate_questions.md.j2",
        learning_path=tools._meta["learning_path"],
        questions_per_page=0,
        page_count=1,
        total_cap=page_cap,
        agent_free=True,
    )
    agent = create_agent(tools=tools.tools, system_prompt=prompt, max_tool_loop=12)
    quota = (
        "本页出几道请根据内容自行决定（目录/空白页可少出或不出，"
        "知识点密集页一般 1～数道即可），不要为凑数而多出。"
    )
    instruction = (
        f"你是 Agent `cli-test`，只负责文档「{doc_name}」第 {page_number} 页。"
        f"{quota}\n"
        f"提交时 page_number 必须填 {page_number}。"
        f"{' chapter_id 必须填本页所属章节的 id（见系统提示目录）。' if learning_path and (learning_path.get('chapters') or []) else ''}"
        f"下面就是本页正文，请直接阅读后出题，不要先检索。\n\n"
        f"## 第 {page_number} 页\n{page['content'][:3000]}"
    )
    return agent, tools, instruction, doc_name


if __name__ == "__main__":
    import argparse

    from tina.utils.run_agent_in_cli import run_agent_in_cli

    parser = argparse.ArgumentParser(description="终端试跑单页出题 Agent（含 reasoning 回传）")
    parser.add_argument("--document-id", default="", help="文档 id；省略则列出最近文档")
    parser.add_argument("--page", type=int, default=1, help="页码，默认 1")
    args = parser.parse_args()

    if not args.document_id:
        db = SessionLocal()
        try:
            docs = (
                db.query(Document)
                .order_by(Document.updated_at.desc())
                .limit(15)
                .all()
            )
        finally:
            db.close()
        print("用法: python -m src.agents.question_gen_agent --document-id <id> --page <n>")
        print("在 backend 目录下运行。#context 可看 messages 里有没有 reasoning_content。")
        if not docs:
            raise SystemExit("库里没有文档")
        print("最近文档:")
        for d in docs:
            print(f"  {d.id}  {d.display_name}")
        raise SystemExit(0)

    agent, tools, page_instruction, doc_name = _cli_make_page_agent(args.document_id, args.page)
    print(f"文档: {doc_name}")
    print(f"页码: {args.page}")
    print("第一条消息输入 出题 ，会发送与线上相同的本页指令。")
    print("工具跑完后输入 #context ，看 assistant 是否带 reasoning_content。")

    def _before_user_instruction(user_message: str) -> str:
        if str(user_message).strip() in ("出题", "go", "start"):
            return page_instruction
        return user_message

    agent.add_before_user_instruction_handler(_before_user_instruction)
    run_agent_in_cli(agent)
