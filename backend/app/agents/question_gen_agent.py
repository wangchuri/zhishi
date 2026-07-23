"""
出题 Worker — 后台常驻式出题 Agent

设计：
- QuestionGenWorker 是长驻 Agent，替换原有短生命周期 QuestionGenAgent
- 通过 Queue 接收出题请求，每个 turn 结束后自动检测是否调用了 submit_questions
- 页面内容通过 set_system_prompt 注入系统提示词，Tina 会自动锚定
- 全局管理器维护 per-user 的 Worker 实例

Agent 流程：
  1. 收到出题请求后更新 system_prompt（含页面内容 + tag 提示）
  2. 调用 apredict_no_stream 让 Agent 分析并调用 submit_questions
  3. on_turn_end 检测是否调了 submit_questions，没调则追加一次重试
  4. 返回标准化后的题目列表
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

GENERATE_SYSTEM_PROMPT = """你是知拾（Zhishi）的智能出题助手，根据给定的教材页面内容生成练习题。

## 工作流程
1. 阅读选中页面的内容
2. 如果需要对某个知识点补充更多上下文，调用 search_document_content 检索本文档的段落
3. 按页面组织题目，题目数量由你根据页面内容丰富度自行判断（建议每页 1~4 题）
4. 完成后调用 submit_questions 批量提交全部题目
5. 全部提交完毕后回复「出题完成」

## 出题要求
- 覆盖该页面的核心知识点，难度适中
- 题型包括：single_choice（单选）、fill_blank（填空）、short_answer（简答）、application（应用题）
- 单选题需提供 4 个选项 A/B/C/D，answer 必须是 A/B/C/D 之一
- 填空题 stem 用 ___ 或 {{blank}} 表示空位，answer 为 JSON 数组如 ["答案1","答案2"]
- 简答题/应用题 options 可为空数组 []，answer 为标准答案要点
- 每道题附带 reference_text（题目所依据的原文关键片段，50-200字）
- tags 字段是知识点标签，用于归类，从已有的 tag 列表中选择或复用相同含义的名称，避免创建同义不同名的标签
  tags 示例：["微积分", "定积分", "牛顿-莱布尼茨公式"]、["Python", "列表推导式", "性能优化"]
  不要创建 "自动生成"、"第1页" 这类无意义的标签

## 题目来源
- 如果页面中有现成的例题、习题（如"例1"、"练习"、"思考题"等），可以直接复用或改编，这时 source 字段设为 "textbook"
- 如果页面中没有现成题目，请结合书本知识点和你的知识自行设计题目，这时 source 字段设为 "ai_generated"
- 每道题必须填写 source 字段"""


class QuestionGenWorker:
    """
    后台常驻出题 Worker。
    每个用户一个实例，Agent 长驻，出题请求通过 submit() 提交，结果通过 Future 回传。
    """

    def __init__(self, user_id: int, dataset_id: str = ""):
        self.user_id = user_id
        self.dataset_id = dataset_id or ""
        self.qgen = QuestionGenTools()
        self.rag = RAGTools(user_id=user_id, dataset_id=dataset_id)
        self.agent = None
        self._needs_retry = False

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

            # 注册 on_turn_end 兜底：检测是否调了 submit_questions
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
        """on_turn_end 回调：检测 Agent 是否调了 submit_questions"""
        try:
            lt = self.agent.get_last_tool_call()
        except Exception:
            lt = None
        if lt is None or "submit_questions" not in str(lt.name):
            logger.info("QuestionGenWorker turn 结束未调 submit_questions, 标记重试")
            self._needs_retry = True

    async def submit(
        self,
        pages: List[dict],
        questions_per_page: int = 1,
        tag_hint: str = "",
        collection_id: Optional[str] = None,
        stream_handler: Optional[Callable] = None,
    ) -> List[dict]:
        """
        提交出题请求，同步等待结果。

        Args:
            pages: 选中页列表
            questions_per_page: 每页出题数
            tag_hint: 已有 TAG 提示
            collection_id: 文档 collection_id，用于 RAG 检索过滤
            stream_handler: 可选的流式 chunk 回调（用于 SSE 推送）

        Returns:
            标准化后的题目列表（可直接持久化）
        """
        if not self.agent:
            logger.error("QuestionGenWorker Agent 不可用: user_id=%s", self.user_id)
            return []

        if not pages:
            return []

        # 1. 设置 RAG 检索过滤
        self.rag.set_filter(collection_id=collection_id)

        # 2. 构造页面上下文
        context_parts = []
        for p in pages:
            title = p.get("title") or f"第 {p.get('page_number', '?')} 页"
            content = (p.get("content") or "")[:3000]
            context_parts.append(f"## {title}\n\n{content}")
        all_content = "\n\n---\n\n".join(context_parts)

        # 3. 更新 system_prompt：基础 prompt + TAG 提示 + 当前页面内容
        system = GENERATE_SYSTEM_PROMPT
        if tag_hint:
            system += f"\n\n### 用户已有 TAG 列表（优先复用）\n{tag_hint}"
        system += f"\n\n### 当前选中页面内容\n\n{all_content}"
        self.agent.set_system_prompt(system)

        # 4. 构造 instruction
        page_numbers_str = ", ".join(str(p.get("page_number", "?")) for p in pages)
        total_pages = len(pages)
        total_expected = total_pages * questions_per_page
        instruction = (
            f"你正在为以下 {total_pages} 页内容出题（共需要约 {total_expected} 道题，每页 {questions_per_page} 道）。\n"
            f"选中页码：{page_numbers_str}\n\n"
            f"请按页面逐页出题，每页 {questions_per_page} 道。对每页内容梳理知识点后，批量调用 submit_questions 提交该页的全部题目。"
        )

        # 5. 注册流式处理器（如果有）
        if stream_handler:
            self.agent.add_on_stream_chunk_handler(stream_handler)

        # 6. 执行推理
        self.qgen.clear_submitted()
        self._needs_retry = False

        try:
            await self.agent.apredict_no_stream(instruction=instruction)
        except Exception as e:
            logger.warning("QuestionGenWorker.submit 推理失败: %s", e, exc_info=True)

        # 7. on_turn_end 可能标记了重试
        submitted = self.qgen.get_submitted_questions()
        if not submitted and self._needs_retry:
            logger.info("QuestionGenWorker 追加强制指令重试")
            self.agent.add_message(
                "user",
                "你还没有调用 submit_questions 提交题目，请现在必须调用它提交本批次全部题目。"
            )
            try:
                self._needs_retry = False
                if stream_handler:
                    self.agent.add_on_stream_chunk_handler(stream_handler)
                await self.agent.apredict_no_stream(instruction="请立即调用 submit_questions 提交全部题目")
            except Exception as e:
                logger.warning("QuestionGenWorker 重试失败: %s", e)
            submitted = self.qgen.get_submitted_questions()

        if not submitted:
            logger.warning("QuestionGenWorker 出题结果为空: user_id=%s", self.user_id)

        return submitted

    async def submit_stream(
        self,
        pages: List[dict],
        questions_per_page: int = 1,
        tag_hint: str = "",
        collection_id: Optional[str] = None,
    ) -> AsyncGenerator[dict, None]:
        """
        流式出题。用 apredict 替代 apredict_no_stream 实时 yield chunk。
        最后 yield 一个包含题目列表的完成事件。
        """
        if not self.agent:
            yield {"event": "error", "content": "Agent 不可用"}
            return
        if not pages:
            yield {"event": "error", "content": "无选中页面"}
            return

        # 1. 设置 RAG 检索过滤
        self.rag.set_filter(collection_id=collection_id)

        # 2. 构造页面上下文放入 system_prompt
        context_parts = []
        for p in pages:
            title = p.get("title") or f"第 {p.get('page_number', '?')} 页"
            content = (p.get("content") or "")[:3000]
            context_parts.append(f"## {title}\n\n{content}")
        all_content = "\n\n---\n\n".join(context_parts)

        system = GENERATE_SYSTEM_PROMPT
        if tag_hint:
            system += f"\n\n### 用户已有 TAG 列表（优先复用）\n{tag_hint}"
        system += f"\n\n### 当前选中页面内容\n\n{all_content}"
        self.agent.set_system_prompt(system)

        # 3. 构造 instruction
        page_numbers_str = ", ".join(str(p.get("page_number", "?")) for p in pages)
        total_pages = len(pages)
        total_expected = total_pages * questions_per_page
        instruction = (
            f"你正在为以下 {total_pages} 页内容出题（共需要约 {total_expected} 道题，每页 {questions_per_page} 道）。\n"
            f"选中页码：{page_numbers_str}\n\n"
            f"请按页面逐页出题，每页 {questions_per_page} 道。对每页内容梳理知识点后，批量调用 submit_questions 提交该页的全部题目。"
        )

        # 4. 流式推理（使用 apredict 替代 apredict_no_stream）
        self.qgen.clear_submitted()
        self._needs_retry = False

        try:
            async for chunk in self.agent.apredict(instruction=instruction):
                content = chunk.get("content", "") if isinstance(chunk, dict) else str(chunk)
                if content:
                    yield {"event": "chunk", "content": content}
        except Exception as e:
            logger.warning("submit_stream 推理失败: %s", e)
            yield {"event": "error", "content": str(e)}
            return

        # 5. on_turn_end 可能标记了重试
        submitted = self.qgen.get_submitted_questions()
        if not submitted and self._needs_retry:
            logger.info("submit_stream 追加强制指令重试")
            self.agent.add_message(
                "user",
                "你还没有调用 submit_questions 提交题目，请现在必须调用它提交本批次全部题目。"
            )
            try:
                self._needs_retry = False
                async for chunk in self.agent.apredict(instruction="请立即调用 submit_questions 提交全部题目"):
                    content = chunk.get("content", "") if isinstance(chunk, dict) else str(chunk)
                    if content:
                        yield {"event": "chunk", "content": content}
            except Exception as e:
                logger.warning("submit_stream 重试失败: %s", e)
            submitted = self.qgen.get_submitted_questions()

        # 6. 输出结果
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
        """获取或创建用户的出题 Worker。"""
        with self._lock:
            worker = self._workers.get(user_id)
            if worker is None:
                worker = QuestionGenWorker(user_id=user_id, dataset_id=dataset_id)
                self._workers[user_id] = worker
            self._last_access[user_id] = time.time()
            return worker

    def cleanup(self, max_idle_seconds: int = 600) -> None:
        """清理长时间未使用的 Worker。"""
        now = time.time()
        with self._lock:
            stale = [
                uid for uid, last in self._last_access.items()
                if now - last > max_idle_seconds
            ]
            for uid in stale:
                self._workers.pop(uid, None)
                self._last_access.pop(uid, None)
                logger.info("QuestionGenManager 清理闲置 Worker: user_id=%s", uid)


# 全局管理器实例
question_gen_manager = QuestionGenManager()


# ───── 公开 API（保持与旧代码兼容） ─────

async def agent_generate_from_pages(
    db,
    user_id: int,
    document_id: str,
    pages: List[dict],
    *,
    questions_per_page: int = 1,
    tag_hint: str = "",
) -> List[Tuple[dict, dict]]:
    """
    Agent 路径：按选中页批量出题。
    返回 [(page_dict, normalized_question_dict), ...]

    使用全局 Worker 管理器，Worker 长驻后台，支持 on_turn_end 兜底重试。
    """
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

    # 将题目与页面关联（保持与旧 API 一致的返回格式）
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