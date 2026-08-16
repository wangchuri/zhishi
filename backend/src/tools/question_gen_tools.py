"""出题 Agent 的工具：按题型提交题目（类实例收集，避免闭包/线程共享问题）。

参考旧实现（QuestionGenTools）模式：题目收集在实例属性 _submitted_questions，
通过 get_submitted() 读取。每个生成任务一个独立 Tools 实例（工具隔离）。
"""

from __future__ import annotations

import json

from tina import Tools


def _norm_tags(tags) -> list[str]:
    if isinstance(tags, list):
        return [str(t) for t in tags if t]
    if isinstance(tags, str):
        return [t.strip() for t in tags.split(",") if t.strip()]
    return []


class QuestionGenTools:
    """按题型拆分的出题提交工具包。每个工具提交一道题。"""

    def __init__(
        self,
        document_id: str,
        pages_context: list[dict] | None = None,
        image_names: list[str] | None = None,
        learning_path: dict | None = None,
        questions_per_page: int = 3,
    ):
        self.document_id = document_id
        self.pages_context = pages_context or []
        self.image_names = image_names or []
        self.learning_path = learning_path
        self.questions_per_page = questions_per_page

        self._submitted_questions: list[dict] = []
        self.tools = Tools(name="question_gen")

        self.tools.register_tool(tool=self.submit_single_choice)
        self.tools.register_tool(tool=self.submit_fill_blank)
        self.tools.register_tool(tool=self.submit_short_answer)
        self.tools.register_tool(tool=self.submit_application)
        self.tools.register_tool(tool=self.submit_custom_question)

        self._meta = {
            "images": "\n".join(f"- {n}" for n in self.image_names) or "（无）",
            "learning_path": json.dumps(learning_path, ensure_ascii=False)[:2000]
            if learning_path else "（无）",
            "questions_per_page": self.questions_per_page,
        }

    # ---- 收集 ----

    def get_submitted(self) -> list[dict]:
        return self._submitted_questions

    def count_submitted(self) -> int:
        return len(self._submitted_questions)

    def _append(self, q: dict) -> str:
        self._submitted_questions.append(q)
        return json.dumps({"status": "ok", "count": self.count_submitted()}, ensure_ascii=False)

    # ---- 提交工具 ----

    async def submit_single_choice(
        self,
        stem: str,
        option_a: str,
        option_b: str,
        option_c: str,
        option_d: str,
        answer: str,
        explanation: str,
        tags,
        reference_text: str,
        source: str,
        page_number: int,
    ) -> str:
        """提交一道单选题（含 A/B/C/D 四个选项）。"""
        return self._append({
            "stem": stem,
            "question_type": "single_choice",
            "options": [
                {"key": "A", "text": option_a},
                {"key": "B", "text": option_b},
                {"key": "C", "text": option_c},
                {"key": "D", "text": option_d},
            ],
            "answer": str(answer).strip().upper(),
            "explanation": explanation,
            "tags": _norm_tags(tags),
            "reference_text": reference_text,
            "source": source,
            "page_number": page_number,
        })

    async def submit_fill_blank(
        self,
        stem: str,
        answer: str,
        explanation: str,
        tags,
        reference_text: str,
        source: str,
        page_number: int,
    ) -> str:
        """提交一道填空题（stem 用 ___ 或 {{blank}} 表示空位）。"""
        return self._append({
            "stem": stem,
            "question_type": "fill_blank",
            "options": [],
            "answer": answer,
            "explanation": explanation,
            "tags": _norm_tags(tags),
            "reference_text": reference_text,
            "source": source,
            "page_number": page_number,
        })

    async def submit_short_answer(
        self,
        stem: str,
        answer: str,
        explanation: str,
        tags,
        reference_text: str,
        source: str,
        page_number: int,
    ) -> str:
        """提交一道简答题。"""
        return self._append({
            "stem": stem,
            "question_type": "short_answer",
            "options": [],
            "answer": answer,
            "explanation": explanation,
            "tags": _norm_tags(tags),
            "reference_text": reference_text,
            "source": source,
            "page_number": page_number,
        })

    async def submit_application(
        self,
        stem: str,
        answer: str,
        explanation: str,
        tags,
        reference_text: str,
        source: str,
        page_number: int,
    ) -> str:
        """提交一道应用题。"""
        return self._append({
            "stem": stem,
            "question_type": "application",
            "options": [],
            "answer": answer,
            "explanation": explanation,
            "tags": _norm_tags(tags),
            "reference_text": reference_text,
            "source": source,
            "page_number": page_number,
        })

    async def submit_custom_question(
        self,
        stem: str,
        html_content: str,
        answer_params: str,
        answer: str,
        explanation: str,
        tags,
        reference_text: str,
        source: str,
        page_number: int,
    ) -> str:
        """提交一道自定义 HTML 题型（复杂交互）。"""
        return self._append({
            "stem": stem,
            "question_type": "custom",
            "options": [],
            "answer": answer,
            "explanation": explanation,
            "tags": _norm_tags(tags),
            "reference_text": reference_text,
            "source": source,
            "page_number": page_number,
            "html_content": html_content,
            "answer_params": answer_params,
        })
