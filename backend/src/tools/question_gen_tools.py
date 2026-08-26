"""出题 Agent 的工具：按题型提交题目（类实例收集，避免闭包/线程共享问题）。

参考旧实现（QuestionGenTools）模式：题目收集在实例属性 _submitted_questions，
通过 get_submitted() 读取。每个生成任务一个独立 Tools 实例（工具隔离）。

不要加 from __future__ import annotations：Tina 用 inspect 读真实类型生成 JSON Schema，
推迟求值会把 list[str] 变成字符串，tags 会被当成 object/string。
"""

import json
import threading

from tina import Tools

from ..utils import parse_tags
from .learning_path_tools import resolve_chapter_id

NEAR_PAGE_MAX_CHARS = 12000


def _norm_tags(tags: list[str] | str | None) -> list[str]:
    return parse_tags(tags)


def format_learning_path_for_prompt(learning_path: dict | None) -> str:
    """把书本目录格式化进出题提示词，供 Agent 用 chapter_id 挂到某一章。"""
    if not learning_path:
        return "（本书还没有目录。不必填 chapter_id，tags 用本页知识点即可。）"
    title = str(learning_path.get("title") or "").strip()
    chapters = learning_path.get("chapters") or []
    lines = []
    if title:
        lines.append(f"书名：{title}")
    if not chapters:
        lines.append("（目录为空。不必填 chapter_id。）")
        return "\n".join(lines)
    lines.append("章节目录（本页必须归属其中一章；提交时 chapter_id 填对应 id，不要填标题）：")
    for i, ch in enumerate(chapters):
        if not isinstance(ch, dict):
            continue
        cid = str(ch.get("id") or "").strip()
        order = ch.get("order") or i + 1
        ct = str(ch.get("title") or "").strip() or f"第 {order} 章"
        kps = ch.get("key_points") or []
        if isinstance(kps, str):
            kps = [kps]
        kp_text = "；".join(str(p).strip() for p in kps if str(p).strip())
        head = f"- id={cid} | {order}. {ct}" if cid else f"- {order}. {ct}"
        if kp_text:
            lines.append(f"{head} ｜ 要点：{kp_text}")
        else:
            lines.append(head)
    return "\n".join(lines)


class QuestionGenTools:
    """按题型拆分的出题提交工具包。每个工具提交一道题。"""

    def __init__(
        self,
        document_id: str,
        pages_context: list[dict] | None = None,
        learning_path: dict | None = None,
        questions_per_page: int = 3,
        total_cap: int | None = None,
    ):
        self.document_id = document_id
        self.pages_context = pages_context or []
        self.learning_path = learning_path
        self.questions_per_page = max(0, int(questions_per_page if questions_per_page is not None else 3))
        n_pages = max(1, len(self.pages_context))
        if total_cap is not None:
            self.total_cap = max(1, int(total_cap))
        elif self.questions_per_page <= 0:
            self.total_cap = 500
        else:
            self.total_cap = self.questions_per_page * n_pages

        self._submitted_questions: list[dict] = []
        self._lock = threading.Lock()
        self._lookup_calls = 0
        self._max_lookups = 6
        self.tools = Tools(name="question_gen")

        self.tools.register_tool(tool=self.submit_single_choice)
        self.tools.register_tool(tool=self.submit_fill_blank)
        self.tools.register_tool(tool=self.submit_short_answer)
        self.tools.register_tool(tool=self.submit_application)
        self.tools.register_tool(tool=self.submit_custom_question)
        self.tools.register_tool(tool=self.get_near_page)
        self.tools.register_tool(tool=self.search_document_content)

        self._meta = {
            "learning_path": format_learning_path_for_prompt(learning_path),
            "questions_per_page": self.questions_per_page,
            "total_cap": self.total_cap,
        }

    # ---- 收集 ----

    def get_submitted(self) -> list[dict]:
        return self._submitted_questions

    def count_submitted(self) -> int:
        return len(self._submitted_questions)

    def trim_to(self, limit: int) -> int:
        """截断到 limit 道，返回丢掉的数量。"""
        limit = max(0, int(limit))
        with self._lock:
            extra = max(0, len(self._submitted_questions) - limit)
            if extra:
                self._submitted_questions = self._submitted_questions[:limit]
            return extra

    def _chapter_id(self, chapter_id: str) -> str:
        return resolve_chapter_id(self.learning_path, chapter_id)

    def _append(self, q: dict) -> str:
        page_cap = self.questions_per_page
        total_cap = self.total_cap
        with self._lock:
            if len(self._submitted_questions) >= total_cap:
                return json.dumps({
                    "status": "rejected",
                    "reason": f"已达到本次上限 {total_cap} 题，不要再提交",
                    "count": len(self._submitted_questions),
                }, ensure_ascii=False)
            pn = q.get("page_number")
            try:
                pn_int = int(pn) if pn is not None else None
            except (TypeError, ValueError):
                pn_int = None
            if pn_int is not None:
                q["page_number"] = pn_int
                if page_cap > 0:
                    on_page = sum(1 for x in self._submitted_questions if x.get("page_number") == pn_int)
                    if on_page >= page_cap:
                        return json.dumps({
                            "status": "rejected",
                            "reason": f"第 {pn_int} 页已有 {page_cap} 题，不要再为该页提交",
                            "count": len(self._submitted_questions),
                        }, ensure_ascii=False)
                self._focus_page = pn_int
            self._submitted_questions.append(q)
            return json.dumps({"status": "ok", "count": len(self._submitted_questions)}, ensure_ascii=False)

    def _current_page(self) -> int:
        if getattr(self, "_focus_page", None):
            return int(self._focus_page)
        for q in reversed(self._submitted_questions):
            pn = q.get("page_number")
            if pn is not None:
                return int(pn)
        if self.pages_context:
            return int(self.pages_context[0].get("page_number") or 1)
        return 1

    def _lookup_guard(self) -> str | None:
        with self._lock:
            self._lookup_calls += 1
            if self._lookup_calls > self._max_lookups:
                return (
                    f"检索/翻页已超过 {self._max_lookups} 次。"
                    "请根据用户消息中的页正文立即 submit_* 出题，不要再检索或翻页。"
                )
        return None

    def get_near_page(self, offset: int) -> str:
        """本页信息不全时，按相对当前页的偏移取一页正文（目标页 = 当前页 + offset）。

        用于用户消息被截断、例题/答案在别页、正文写到「见下页」等情况。
        offset 为非 0 整数：-1 上一页，+1 下一页，+8 往后第 8 页。
        不是只取相邻页；需要跳远时直接用较大的 offset，不要一页一页翻完全书。

        Args:
            offset: 相对当前页的页差，不能为 0（当前页正文已在用户消息中）
        """
        blocked = self._lookup_guard()
        if blocked:
            return blocked
        try:
            offset = int(offset)
        except (TypeError, ValueError):
            return "offset 必须是整数，例如 -1、1、8"
        if offset == 0:
            return "当前页正文已在用户消息中；若本页信息不全，用非 0 的 offset 取偏移页，例如 +1 看下一页"
        target = self._current_page() + offset
        if target < 1:
            return f"没有第 {target} 页。"
        for p in self.pages_context:
            if int(p.get("page_number") or 0) == target:
                title = p.get("title") or f"第 {target} 页"
                content = (p.get("content") or "")[:NEAR_PAGE_MAX_CHARS]
                return f"## {title}\n\n{content}"
        from ..core.storage import storage
        disk = storage.read_page(self.document_id, target)
        if disk:
            return disk[:NEAR_PAGE_MAX_CHARS]
        return f"页码 {target} 不在当前文档范围内"

    def search_document_content(self, query: str) -> str:
        """在本次选中页内用关键词定位原文。页正文已在用户消息中，出题前不必调用。"""
        blocked = self._lookup_guard()
        if blocked:
            return blocked
        q = (query or "").strip()
        generic = not q or q.lower() in {
            "当前页", "本页", "页内容", "内容", "看看", "page", "content",
            "selected", "当前页内容", "页面内容",
        }
        if generic:
            return "页正文已在用户消息中，不必检索。请直接 submit_* 出题。"
        tokens = [t for t in q.replace("，", " ").replace(",", " ").split() if len(t) > 1]
        hits: list[str] = []
        for p in self.pages_context:
            content = p.get("content") or ""
            hay = content.lower()
            matched = q.lower() in hay or (tokens and any(tok.lower() in hay for tok in tokens))
            if not matched:
                continue
            pn = p.get("page_number")
            snippet = content[:2000]
            hits.append(f"## 第 {pn} 页\n{snippet}")
            if len(hits) >= 5:
                break
        if not hits:
            return (
                "选中页中未找到该关键词。"
                "页正文已经在用户消息里，请直接阅读后出题，不要反复检索。"
            )
        return "\n\n".join(hits)

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
        tags: list[str],
        reference_text: str,
        source: str,
        page_number: int,
        chapter_id: str = "",
    ) -> str:
        """提交一道单选题（含 A/B/C/D 四个选项）。

        Args:
            tags: 知识点标签列表，优先用所属章节的要点名
            chapter_id: 本页所属章节 id，必须从目录里原样复制，不要填标题
        """
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
            "chapter_id": self._chapter_id(chapter_id),
        })

    async def submit_fill_blank(
        self,
        stem: str,
        answer: str,
        explanation: str,
        tags: list[str],
        reference_text: str,
        source: str,
        page_number: int,
        chapter_id: str = "",
    ) -> str:
        """提交一道填空题（stem 用 ___ 或 {{blank}} 表示空位）。

        Args:
            tags: 知识点标签列表，优先用所属章节的要点名
            chapter_id: 本页所属章节 id，必须从目录里原样复制，不要填标题
        """
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
            "chapter_id": self._chapter_id(chapter_id),
        })

    async def submit_short_answer(
        self,
        stem: str,
        answer: str,
        explanation: str,
        tags: list[str],
        reference_text: str,
        source: str,
        page_number: int,
        chapter_id: str = "",
    ) -> str:
        """提交一道简答题。

        Args:
            tags: 知识点标签列表，优先用所属章节的要点名
            chapter_id: 本页所属章节 id，必须从目录里原样复制，不要填标题
        """
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
            "chapter_id": self._chapter_id(chapter_id),
        })

    async def submit_application(
        self,
        stem: str,
        answer: str,
        explanation: str,
        tags: list[str],
        reference_text: str,
        source: str,
        page_number: int,
        chapter_id: str = "",
    ) -> str:
        """提交一道应用题。

        Args:
            tags: 知识点标签列表，优先用所属章节的要点名
            chapter_id: 本页所属章节 id，必须从目录里原样复制，不要填标题
        """
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
            "chapter_id": self._chapter_id(chapter_id),
        })

    async def submit_custom_question(
        self,
        stem: str,
        html_content: str,
        answer_params: str,
        answer: str,
        explanation: str,
        tags: list[str],
        reference_text: str,
        source: str,
        page_number: int,
        chapter_id: str = "",
    ) -> str:
        """提交一道自定义 HTML 题型（填图、拖拽、表格等复杂交互）。

        html_content 可含可拖拽标签与放置区；放置后调用 window.zhishiSetAnswer(key, value)
        或给 hidden input[data-answer-key] 赋值。answer / 用户答案均为 JSON 对象。

        Args:
            tags: 知识点标签列表，优先用所属章节的要点名
            chapter_id: 本页所属章节 id，必须从目录里原样复制，不要填标题
        """
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
            "chapter_id": self._chapter_id(chapter_id),
            "html_content": html_content,
            "answer_params": answer_params,
        })
