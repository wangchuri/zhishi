"""
出题 Worker — 后台常驻式出题 Agent（带数量约束与多轮重试）

设计：
- QuestionGenWorker 是长驻 Agent
- 工具已按题型拆分为 4 个独立 submit 工具，每道题单独提交
- on_turn_end 检测是否调用了 submit_* 工具 和 数量是否达标
- submit/submit_stream 支持最多 3 轮重试补足缺口
- 通过 SSE 推送进度事件
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import AsyncGenerator, Callable, List, Optional, Tuple

from app.utils.tina_loader import tina_env_path
from tina import Agent
from tina.llm import BaseAPI

from app.tools.rag_tools import RAGTools
from app.tools.question_gen_tools import QuestionGenTools

logger = logging.getLogger(__name__)

_MAX_RETRY_ROUNDS = 3

GENERATE_SYSTEM_PROMPT = """你是知拾（Zhishi）的智能出题助手，根据给定的教材页面内容生成练习题。

## 工作流程
1. 阅读选中页面的内容
2. 如果需要对某个知识点补充更多上下文，调用 search_document_content 检索本文档的段落
3. **按页面逐页逐题提交**：对每页中的每个核心知识点，分别调用对应的提交工具，一次调用提交一道题
4. 所有题目提交完毕后回复「出题完成」

## 提交工具（**你可以同时调用多个工具提交多道题**）
Tina 支持并行工具调用，你可以一次性调用多个 submit_* 工具来同时提交多道题。

- submit_single_choice：提交一道单选题（含 A/B/C/D 四个选项）
- submit_fill_blank：提交一道填空题（stem 用 ___ 或 {{blank}} 表示空位）
- submit_short_answer：提交一道简答题
- submit_application：提交一道应用题
- submit_custom_question：提交一道自定义 HTML 题型（用于复杂交互，含 html_content 和 answer_params）
- get_near_page(offset)：获取相邻页面内容（-1=上一页，1=下一页，2=下下页），当前页面内容不完整时使用

### 所有工具公共参数
- stem：题干
- explanation：解题思路与知识点解析
- tags：知识点标签列表，**必须复用已有的 tag 名称**，不要创建同义不同名的标签
- reference_text：题目所依据的原文关键片段（50-200字）
- source：题目来源，"textbook"（书中例题/习题）或 "ai_generated"（AI自行设计）
- page_number：题目对应的页码

## 出题要求
- 覆盖该页面的核心知识点，难度适中
- 单选题需提供 A/B/C/D 四个选项，answer 必须是 A/B/C/D 之一
- 填空题 answer 为 JSON 数组字符串如 '["答案1","答案2"]' 或分号分隔
- 简答题/应用题 answer 为标准答案要点
- tags 示例：["微积分", "定积分", "牛顿-莱布尼茨公式"]、["Python", "列表推导式", "性能优化"]
  不要创建 "自动生成"、"第1页" 这类无意义的标签

## 题目来源
- source 为 "textbook"：页面中的现成例题、习题（如"例1"、"练习"、"思考题"等）
- source 为 "ai_generated"：结合书本知识点和你的知识自行设计"""


class QuestionGenWorker:
    """
    后台常驻出题 Worker。带数量约束：期望数量通过 _expected_count 记录，
    on_turn_end 检测缺口，submit/submit_stream 最多重试 3 轮补足。
    """

    def __init__(self, user_id: int, dataset_id: str = ""):
        self.user_id = user_id
        self.dataset_id = dataset_id or ""
        self.qgen = QuestionGenTools()
        self.rag = RAGTools(user_id=user_id, dataset_id=dataset_id)
        self.agent = None
        self._needs_retry = False
        self._retry_reason = ""
        self._expected_count = 0
        self._retry_round = 0

        try:
            self.llm = BaseAPI(env_path=tina_env_path())

            self.agent = Agent(
                llm=self.llm,
                tools=[self.rag.get_tools(), self.qgen.get_tools()],
                system_prompt=GENERATE_SYSTEM_PROMPT,
                max_context_length=60000,
                max_tool_result_length=4000,
                name=f"question_gen_worker_{user_id}",
            )

            # 注册 on_turn_end 兜底：检测是否调了 submit_* 及数量
            self.agent.add_on_turn_end_handler(self._on_turn_end_check)
            logger.info("QuestionGenWorker 初始化成功: user_id=%s", user_id)
        except Exception as e:
            logger.error("QuestionGenWorker 初始化失败: user_id=%s, error=%s", user_id, e)
            self.agent = None
            self.llm = None

    @property
    def is_ready(self) -> bool:
        return self.agent is not None

    def _on_turn_end_check(self) -> None:
        """on_turn_end 回调：检测是否调了 submit_* 工具，以及数量是否达标。"""
        try:
            lt = self.agent.get_last_tool_call()
        except Exception:
            lt = None

        submitted_count = self.qgen.count_submitted()

        if lt is None or not str(lt.name).startswith("submit_"):
            self._needs_retry = True
            self._retry_reason = (
                f"你还没有提交任何题目。期望共 {self._expected_count} 道题，"
                f"已提交 {submitted_count} 道。请立即按题型逐道提交。"
            )
            logger.info("_on_turn_end: 未调用 submit_*，已提交 %d / %d", submitted_count, self._expected_count)
            return

        if submitted_count < self._expected_count:
            gap = self._expected_count - submitted_count
            # 动态容忍度：总量 ≤3 道时必须 0 缺口，总量大时允许至多差 1 道
            allowed_gap = 0 if self._expected_count <= 3 else 1
            if gap <= allowed_gap:
                logger.info("_on_turn_end: 缺口 %d 题（可接受，容忍度 %d），不重试", gap, allowed_gap)
                self._needs_retry = False
                return
            self._needs_retry = True
            self._retry_reason = (
                f"期望共 {self._expected_count} 道题，你只提交了 {submitted_count} 道，"
                f"还差 {gap} 道。请继续针对未覆盖的知识点补出题目，逐道调用对应的提交工具。"
            )
            logger.info("_on_turn_end: 缺口 %d 题，触发重试 (round %d)", gap, self._retry_round)
        else:
            self._needs_retry = False
            logger.info("_on_turn_end: 数量达标 %d / %d", submitted_count, self._expected_count)

    async def _run_with_retry(
        self,
        instruction: str,
        stream_handler: Optional[Callable] = None,
        use_stream: bool = False,
    ) -> List[dict]:
        """
        执行 Agent 推理，最多重试 _MAX_RETRY_ROUNDS 轮。
        返回最终提交的题目列表。
        """
        self._retry_round = 0
        while self._retry_round <= _MAX_RETRY_ROUNDS:
            self._needs_retry = False
            self._retry_reason = ""

            try:
                if use_stream:
                    async for chunk in self.agent.apredict(instruction=instruction):
                        content = chunk.get("content", "") if isinstance(chunk, dict) else str(chunk)
                        if content and stream_handler:
                            stream_handler({"event": "chunk", "content": content})
                else:
                    if stream_handler:
                        stream_handler({"event": "status", "content": f"Agent 推理中（第 {self._retry_round + 1} 轮）..."})
                    await self.agent.apredict_no_stream(instruction=instruction)
            except Exception as e:
                logger.warning("推理失败 (round %d): %s", self._retry_round + 1, e)
                if stream_handler:
                    stream_handler({"event": "error", "content": str(e)})

            submitted = self.qgen.get_submitted_questions()
            submitted_count = len(submitted)

            if stream_handler:
                stream_handler({
                    "event": "progress",
                    "current": submitted_count,
                    "total": self._expected_count,
                    "round": self._retry_round + 1,
                })

            if not self._needs_retry:
                logger.info("推理完成，数量达标 %d / %d", submitted_count, self._expected_count)
                return submitted

            self._retry_round += 1
            if self._retry_round > _MAX_RETRY_ROUNDS:
                logger.warning("已达最大重试次数 %d，终止", _MAX_RETRY_ROUNDS)
                break

            gap = self._expected_count - submitted_count
            instruction = (
                f"你还没有完成全部出题任务。当前已提交 {submitted_count} 道，"
                f"还需要 {gap} 道。请补充提交，每次调用一个工具、提交一道题。"
            )
            logger.info("重试 round %d/%d: 缺口 %d", self._retry_round, _MAX_RETRY_ROUNDS, gap)

        return self.qgen.get_submitted_questions()

    async def submit(
        self,
        pages: List[dict],
        questions_per_page: int = 1,
        tag_hint: str = "",
        collection_id: Optional[str] = None,
        stream_handler: Optional[Callable] = None,
    ) -> List[dict]:
        """
        提交出题请求，同步等待结果。支持多轮重试补足数量。

        Args:
            pages: 选中页列表
            questions_per_page: 每页出题数
            tag_hint: 已有 TAG 提示
            collection_id: 文档 collection_id，用于 RAG 检索过滤
            stream_handler: 可选的流式 chunk 回调（用于 SSE 推送）

        Returns:
            标准化后的题目列表
        """
        if not self.agent:
            logger.error("QuestionGenWorker Agent 不可用: user_id=%s", self.user_id)
            return []
        if not pages:
            return []

        self.rag.set_filter(collection_id=collection_id)
        self.qgen.set_pages_context(pages)

        context_parts = []
        for p in pages:
            title = p.get("title") or f"第 {p.get('page_number', '?')} 页"
            content = (p.get("content") or "")[:3000]
            context_parts.append(f"## {title}\n\n{content}")
        all_content = "\n\n---\n\n".join(context_parts)

        total_pages = len(pages)
        self._expected_count = total_pages * questions_per_page

        system = GENERATE_SYSTEM_PROMPT
        system += f"\n\n### 页面数量与出题数量约束\n"
        system += f"共 {total_pages} 页，每页需出 {questions_per_page} 道题，总计至少 {self._expected_count} 道。\n"
        system += f"请逐页逐题提交，每调用一次工具提交一道题，确保总题数达标。\n"
        system += f"如果页面内容不完整、概念跨页，可调用 get_near_page(offset) 获取相邻页内容。"
        if tag_hint:
            system += f"\n\n### 用户已有 TAG 列表（优先复用）\n{tag_hint}"
        system += f"\n\n### 当前选中页面内容\n\n{all_content}"
        self.agent.set_system_prompt(system)

        page_numbers_str = ", ".join(str(p.get("page_number", "?")) for p in pages)
        instruction = (
            f"你正在为以下 {total_pages} 页内容出题。\n"
            f"选中页码：{page_numbers_str}\n\n"
            f"请逐页分析，每页出 {questions_per_page} 道题（共至少 {self._expected_count} 道），"
            f"每次调用一个 submit_* 工具提交一道题。"
        )

        self.qgen.clear_submitted()
        return await self._run_with_retry(instruction, stream_handler, use_stream=False)

    async def submit_stream(
        self,
        pages: List[dict],
        questions_per_page: int = 1,
        tag_hint: str = "",
        collection_id: Optional[str] = None,
    ) -> AsyncGenerator[dict, None]:
        """
        流式出题（旧版，单 Agent）。
        用 apredict 实时 yield chunk。支持多轮重试。
        已废弃，请使用 submit_concurrent_stream 替代。
        """
        if not self.agent:
            yield {"event": "error", "content": "Agent 不可用"}
            return
        if not pages:
            yield {"event": "error", "content": "无选中页面"}
            return

        self.rag.set_filter(collection_id=collection_id)

        context_parts = []
        for p in pages:
            title = p.get("title") or f"第 {p.get('page_number', '?')} 页"
            content = (p.get("content") or "")[:3000]
            context_parts.append(f"## {title}\n\n{content}")
        all_content = "\n\n---\n\n".join(context_parts)

        total_pages = len(pages)
        self._expected_count = total_pages * questions_per_page

        system = GENERATE_SYSTEM_PROMPT
        system += f"\n\n### 页面数量与出题数量约束\n"
        system += f"共 {total_pages} 页，每页需出 {questions_per_page} 道题，总计至少 {self._expected_count} 道。\n"
        system += f"请逐页逐题提交，每调用一次工具提交一道题，确保总题数达标。"
        if tag_hint:
            system += f"\n\n### 用户已有 TAG 列表（优先复用）\n{tag_hint}"
        system += f"\n\n### 当前选中页面内容\n\n{all_content}"
        self.agent.set_system_prompt(system)

        page_numbers_str = ", ".join(str(p.get("page_number", "?")) for p in pages)
        instruction = (
            f"你正在为以下 {total_pages} 页内容出题。\n"
            f"选中页码：{page_numbers_str}\n\n"
            f"请逐页分析，每页出 {questions_per_page} 道题（共至少 {self._expected_count} 道），"
            f"每次调用一个 submit_* 工具提交一道题。"
        )

        self.qgen.clear_submitted()
        self._retry_round = 0
        chunk_collector = []

        def _on_chunk(data: dict):
            chunk_collector.append(data)

        while self._retry_round <= _MAX_RETRY_ROUNDS:
            self._needs_retry = False
            self._retry_reason = ""
            chunk_collector.clear()

            try:
                async for chunk in self.agent.apredict(instruction=instruction):
                    content = chunk.get("content", "") if isinstance(chunk, dict) else str(chunk)
                    if content:
                        yield {"event": "chunk", "content": content}
            except Exception as e:
                logger.warning("submit_stream 推理失败 (round %d): %s", self._retry_round + 1, e)
                yield {"event": "error", "content": str(e)}
                return

            submitted = self.qgen.get_submitted_questions()
            submitted_count = len(submitted)
            yield {"event": "progress", "current": submitted_count, "total": self._expected_count, "round": self._retry_round + 1}

            if not self._needs_retry:
                break

            self._retry_round += 1
            if self._retry_round > _MAX_RETRY_ROUNDS:
                logger.warning("submit_stream 已达最大重试次数 %d", _MAX_RETRY_ROUNDS)
                break

            gap = self._expected_count - submitted_count
            instruction = f"你还没有完成全部出题任务。当前已提交 {submitted_count} 道，还需要 {gap} 道。请补充提交，每次调用一个工具、提交一道题。"
            yield {"event": "retry", "reason": f"已提交 {submitted_count}/{self._expected_count}，继续补充 {gap} 道"}

        submitted = self.qgen.get_submitted_questions()
        if submitted:
            yield {"event": "result", "questions": submitted}
        else:
            yield {"event": "error", "content": "出题失败，请稍后重试"}


class QuestionGenManager:
    """
    全局出题 Worker 管理器。
    按 user_id 维护 Worker 实例，支持跨请求复用。
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._workers: dict[int, QuestionGenWorker] = {}
        self._last_access: dict[int, float] = {}

    def get_worker(self, user_id: int, dataset_id: str = "") -> QuestionGenWorker:
        with self._lock:
            worker = self._workers.get(user_id)
            if worker is None:
                worker = QuestionGenWorker(user_id=user_id, dataset_id=dataset_id)
                self._workers[user_id] = worker
            self._last_access[user_id] = time.time()
            return worker

    def cleanup(self, max_idle_seconds: int = 600) -> None:
        now = time.time()
        with self._lock:
            stale = [uid for uid, last in self._last_access.items() if now - last > max_idle_seconds]
            for uid in stale:
                self._workers.pop(uid, None)
                self._last_access.pop(uid, None)
                logger.info("QuestionGenManager 清理闲置 Worker: user_id=%s", uid)


# 全局管理器实例
question_gen_manager = QuestionGenManager()


# ───── 并发流式出题（按页并发，支持进度） ─────

async def submit_concurrent_stream(
    user_id: int,
    document_id: str,
    pages: List[dict],
    questions_per_page: int = 1,
    tag_hint: str = "",
    max_concurrent: int = 5,
) -> AsyncGenerator[dict, None]:
    """
    每页独立 Agent 并发出题，实时推送进度事件。

    SSE 事件：
    - {"event": "page_done", "page": N, "count": M}  — 某页完成（出 M 道题）
    - {"event": "progress", "current": X, "total": Y} — 总进度
    - {"event": "page_error", "page": N, "content": ...} — 某页失败
    - {"event": "result", "questions": [...]}  — 全部完成
    """
    
    sem = asyncio.Semaphore(max_concurrent)
    total_pages = len(pages)
    all_results: List[Tuple[int, List[Tuple[dict, dict]]]] = []

    async def gen_one(index: int, page: dict) -> Tuple[int, List[Tuple[dict, dict]]]:
        async with sem:
            try:
                result = await agent_generate_single_page(
                    db=None,
                    user_id=user_id,
                    document_id=document_id,
                    pages=pages,
                    current_page=page,
                    questions_per_page=questions_per_page,
                    tag_hint=tag_hint,
                )
                return index, result
            except Exception as e:
                logger.warning("单页出题失败 page=%s: %s", page.get("page_number"), e)
                return index, []

    # 启动所有页
    tasks = [gen_one(i, p) for i, p in enumerate(pages)]
    total_expected = total_pages * questions_per_page

    # 用 asyncio.as_completed 每完成一页推送进度
    all_questions: List[tuple] = []

    for coro in asyncio.as_completed(tasks):
        index, pairs = await coro
        page = pages[index]
        pn = page.get("page_number", "?")
        count = len(pairs)

        if pairs:
            all_questions.extend(pairs)
            yield {"event": "page_done", "page": pn, "count": count}
        else:
            yield {"event": "page_error", "page": pn, "content": "该页出题失败"}

        yield {
            "event": "progress",
            "current": len(all_questions),
            "total": total_expected,
        }

    if all_questions:
        yield {"event": "result", "questions": all_questions}
    else:
        yield {"event": "error", "content": "所有页面出题失败，请稍后重试"}


# ───── 公开 API（按页并发） ─────

async def agent_generate_single_page(
    db,
    user_id: int,
    document_id: str,
    pages: List[dict],
    current_page: dict,
    *,
    questions_per_page: int = 1,
    tag_hint: str = "",
) -> List[Tuple[dict, dict]]:
    """
    单页出题。每页独立 Worker，支持 get_near_page 跨页检索。
    由 generate_from_pages 并发调用。
    """
    worker = QuestionGenWorker(user_id=user_id)
    if not worker.is_ready:
        return []

    # 注入所有页上下文（供 get_near_page 检索）
    worker.qgen.set_pages_context(pages)

    submitted = await worker.submit(
        pages=[current_page],
        questions_per_page=questions_per_page,
        tag_hint=tag_hint,
        collection_id=document_id,
    )

    if not submitted:
        return []

    return [(current_page, q) for q in submitted]


async def agent_generate_from_pages(
    db,
    user_id: int,
    document_id: str,
    pages: List[dict],
    *,
    questions_per_page: int = 1,
    tag_hint: str = "",
) -> List[Tuple[dict, dict]]:
    worker = question_gen_manager.get_worker(user_id)
    if not worker.is_ready:
        return []

    submitted = await worker.submit(
        pages=pages,
        questions_per_page=questions_per_page,
        tag_hint=tag_hint,
        collection_id=document_id,
    )

    if not submitted:
        return []

    result: List[Tuple[dict, dict]] = []
    q_per_page = max(1, len(submitted) // len(pages))
    q_idx = 0
    for p in pages:
        for _ in range(q_per_page):
            if q_idx >= len(submitted):
                break
            result.append((p, submitted[q_idx]))
            q_idx += 1
    while q_idx < len(submitted):
        result.append((pages[-1], submitted[q_idx]))
        q_idx += 1

    return result