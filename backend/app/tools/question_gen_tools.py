"""
出题提交工具 — 按题型拆分为独立工具，每道题单独提交
"""
import json
import logging
from typing import List, Optional

from tina.agent.core.tools import Tools

logger = logging.getLogger(__name__)


class QuestionGenTools:
    """按题型拆分的出题提交工具包。每个工具提交一道题。"""

    _submitted_questions: List[dict]
    tools: Tools
    _pages_context: List[dict]  # 所有页面上下文，供 get_near_page 查找

    def __init__(self):
        self._submitted_questions = []
        self._pages_context = []
        self.tools = Tools(name="question_gen")
        self.tools.register_tool(tool=self.submit_single_choice)
        self.tools.register_tool(tool=self.submit_fill_blank)
        self.tools.register_tool(tool=self.submit_short_answer)
        self.tools.register_tool(tool=self.submit_application)
        self.tools.register_tool(tool=self.submit_custom_question)
        self.tools.register_tool(tool=self.get_near_page)
        logger.info("QuestionGenTools 初始化：6 个工具已注册（含 custom + get_near_page）")

    def set_pages_context(self, pages: List[dict]) -> None:
        """设置所有页面上下文，供 get_near_page 查找相邻页面。"""
        self._pages_context = pages

    def get_tools(self) -> Tools:
        return self.tools

    def get_submitted_questions(self) -> List[dict]:
        return self._submitted_questions

    def count_submitted(self) -> int:
        return len(self._submitted_questions)

    def clear_submitted(self) -> None:
        self._submitted_questions = []

    def _append(self, q: dict) -> None:
        from app.services.question_gen_service import _normalize_question
        normalized = _normalize_question(q)
        if normalized:
            self._submitted_questions.append(normalized)

    # ─── 相邻页检索工具 ─────────────────────────────

    def get_near_page(self, offset: int) -> str:
        """
        获取相邻页面的标题和内容片段，用于补充出题上下文。

        当当前页面内容不足以出题（如段落被截断、概念不完整），或需要了解
        前后文关系时调用此工具。

        Args:
            offset: 偏移量。-1 = 上一页，1 = 下一页，2 = 下下页。

        Returns:
            该页面的标题和内容片段（最多 2000 字），或说明信息。
        """
        # 需要知道当前页码：从已提交题目的 page_number 取最新一条
        current_page = 1
        for q in reversed(self._submitted_questions):
            pn = q.get("page_number")
            if pn is not None:
                current_page = int(pn)
                break

        target = current_page + offset
        if not self._pages_context:
            return "未设置页面上下文，无法获取相邻页面内容"

        for p in self._pages_context:
            if p.get("page_number") == target:
                title = p.get("title") or f"第 {target} 页"
                content = (p.get("content") or "")[:2000]
                return f"## {title}\n\n{content}"

        return f"页码 {target} 不在当前选中页范围内"

    # ─── 五个按题型工具 ─────────────────────────────

    def submit_single_choice(
        self,
        stem: str,
        option_a: str,
        option_b: str,
        option_c: str,
        option_d: str,
        answer: str,
        explanation: str,
        tags: list,
        reference_text: str,
        source: str,
        page_number: int,
    ) -> str:
        """提交一道单选题。**每次调用只提交一道。**"""
        self._append({
            "stem": stem,
            "question_type": "single_choice",
            "options": [
                {"key": "A", "text": option_a},
                {"key": "B", "text": option_b},
                {"key": "C", "text": option_c},
                {"key": "D", "text": option_d},
            ],
            "answer": answer.strip().upper(),
            "explanation": explanation,
            "tags": tags if isinstance(tags, list) else [],
            "reference_text": reference_text,
            "source": source,
        })
        return json.dumps({"status": "ok", "count": len(self._submitted_questions)}, ensure_ascii=False)

    def submit_fill_blank(
        self,
        stem: str,
        answer: str,
        explanation: str,
        tags: list,
        reference_text: str,
        source: str,
        page_number: int,
    ) -> str:
        """提交一道填空题。**每次调用只提交一道。**"""
        self._append({
            "stem": stem,
            "question_type": "fill_blank",
            "options": [],
            "answer": answer,
            "explanation": explanation,
            "tags": tags if isinstance(tags, list) else [],
            "reference_text": reference_text,
            "source": source,
        })
        return json.dumps({"status": "ok", "count": len(self._submitted_questions)}, ensure_ascii=False)

    def submit_short_answer(
        self,
        stem: str,
        answer: str,
        explanation: str,
        tags: list,
        reference_text: str,
        source: str,
        page_number: int,
    ) -> str:
        """提交一道简答题。**每次调用只提交一道。**"""
        self._append({
            "stem": stem,
            "question_type": "short_answer",
            "options": [],
            "answer": answer,
            "explanation": explanation,
            "tags": tags if isinstance(tags, list) else [],
            "reference_text": reference_text,
            "source": source,
        })
        return json.dumps({"status": "ok", "count": len(self._submitted_questions)}, ensure_ascii=False)

    def submit_application(
        self,
        stem: str,
        answer: str,
        explanation: str,
        tags: list,
        reference_text: str,
        source: str,
        page_number: int,
    ) -> str:
        """提交一道应用题。**每次调用只提交一道。**"""
        self._append({
            "stem": stem,
            "question_type": "application",
            "options": [],
            "answer": answer,
            "explanation": explanation,
            "tags": tags if isinstance(tags, list) else [],
            "reference_text": reference_text,
            "source": source,
        })
        return json.dumps({"status": "ok", "count": len(self._submitted_questions)}, ensure_ascii=False)

    def submit_custom_question(
        self,
        stem: str,
        html_content: str,
        answer_params: list,
        correct_answer: str,
        explanation: str,
        tags: list,
        reference_text: str,
        source: str,
        page_number: int,
    ) -> str:
        """
        提交一道自定义题型（用 HTML 呈现）。**每次调用只提交一道。**

        用于需要复杂交互的题目，例如地图填图、函数图像拖拽、表格填空等。
        HTML 内容通过 srcdoc 在 iframe 中渲染，不要包含 <form> 标签。
        需要用户输入的位置用 data-answer-key="参数名" 标注。

        Args:
            stem: 题干（简短的题目说明）
            html_content: 完整的 HTML 页面内容（含 <style>），不含 form 标签
            answer_params: [{"key": "参数名", "label": "显示标签", "type": "text|number|textarea"}]
            correct_answer: JSON 字符串，如 '{"city": "北京", "population": 2189}'
            explanation: 解析
            tags: 知识点标签列表
            reference_text: 原文片段（50-200字）
            source: "textbook" 或 "ai_generated"
            page_number: 页码
        """
        if not html_content or not html_content.strip():
            return json.dumps({"status": "error", "reason": "html_content 为空"}, ensure_ascii=False)
        self._append({
            "stem": stem,
            "question_type": "custom",
            "options": [],
            "answer": correct_answer,
            "explanation": explanation,
            "tags": tags if isinstance(tags, list) else [],
            "reference_text": reference_text,
            "source": source,
            "html_content": html_content,
            "answer_params": answer_params,
        })
        return json.dumps({"status": "ok", "count": len(self._submitted_questions)}, ensure_ascii=False)