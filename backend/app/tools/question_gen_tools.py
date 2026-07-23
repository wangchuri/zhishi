"""
出题提交工具 — 批量结构化题目的提交与标准化
"""
import json
import logging
from typing import List

from tina.agent.core.tools import Tools

logger = logging.getLogger(__name__)


class QuestionGenTools:
    """出题提交工具包，负责接收 Agent 生成的题目并持久化。"""

    tools: Tools

    def __init__(self):
        self._submitted_questions: List[dict] = []
        self.tools = Tools(name="question_gen")
        self.tools.register_tool(tool=self.submit_questions)

    def get_tools(self) -> Tools:
        """公开 Tools 实例供 Agent 使用。"""
        return self.tools

    def get_submitted_questions(self) -> List[dict]:
        """获取本轮提交的题目列表。"""
        return self._submitted_questions

    def clear_submitted(self) -> None:
        """清空已提交题目。"""
        self._submitted_questions = []

    def submit_questions(self, questions: list) -> str:
        """
        批量提交结构化题目。**你必须按当前阅读的页面组织题目，一次性提交本页的全部题目，不要逐题调用。**

        每道题必须包含以下字段：
        - stem (str): 题干
        - question_type (str): 题型，可选 single_choice / fill_blank / short_answer / application
        - options (list[dict]): 选项列表，每项格式 {"key": "A", "text": "选项文本"}。填空题/简答题可传 []
        - answer (str): 正确答案。单选题为 A/B/C/D；填空题为 JSON 数组字符串如 '["答案1","答案2"]' 或分号分隔
        - explanation (str): 解题思路与知识点解析
        - tags (list[str]): 知识点标签列表。**必须复用已有 tag 名称，不要创建同义不同名的标签。**
          示例：["微积分", "定积分", "牛顿-莱布尼茨公式"]、["Python", "列表推导式"]
          避免使用："自动生成"、"第X页"、"Page X"、"general" 等无意义标签
        - reference_text (str): 题目所依据的原文关键片段（50-200 字）
        - source (str): 题目来源，"textbook"（书中例题/习题）或 "ai_generated"（AI自行设计）

        Args:
            questions (list): 题目列表，每项为符合上述格式的 dict
        Returns:
            JSON: {"status": "ok", "count": N} 或 {"status": "error", "reason": "..."}
        """
        if not isinstance(questions, list) or len(questions) == 0:
            return json.dumps({"status": "error", "reason": "题目列表为空"}, ensure_ascii=False)

        from app.services.question_gen_service import _normalize_question

        valid_count = 0
        self._submitted_questions = []

        for raw in questions:
            if not isinstance(raw, dict):
                continue
            # normalize options format if needed
            opts = raw.get("options") or []
            norm_opts = []
            for opt in opts:
                if isinstance(opt, dict) and "key" in opt and "text" in opt:
                    norm_opts.append({"key": str(opt["key"]).upper(), "text": str(opt["text"])})
                elif isinstance(opt, str):
                    import re as _re
                    m = _re.match(r"^([A-D])[.．、\s]\s*(.*)", opt)
                    if m:
                        norm_opts.append({"key": m.group(1), "text": m.group(2)})
            raw["options"] = norm_opts
            if "tags" not in raw or not isinstance(raw["tags"], list):
                raw["tags"] = ["自动生成"]

            normalized = _normalize_question(raw)
            if normalized:
                self._submitted_questions.append(normalized)
                valid_count += 1

        return json.dumps({"status": "ok", "count": valid_count}, ensure_ascii=False)