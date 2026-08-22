"""对话 Agent 工具：知识库检索 + 题库浏览 / 出题卡片。

不要加 from __future__ import annotations：Tina 用 inspect 读真实类型生成 JSON Schema，
推迟求值会把 str 变成字符串，参数会被当成 object，模型容易写出没加引号的 JSON。
"""

import json
import threading
from typing import Optional

from tina import Tools

from ..core.database import SessionLocal
from ..models import Document, GlobalQuestion, QuestionProvenance, QuestionRef
from ..services.rag import chroma_store
from ..utils import parse_tags

_TYPE_LABEL = {
    "single_choice": "单选",
    "multiple_choice": "多选",
    "fill_blank": "填空",
    "short_answer": "简答",
    "application": "应用",
    "custom": "自定义",
}

_STATUS_LABEL = {
    "correct": "对",
    "wrong": "错",
    "unknown": "不会",
}


def _stem_preview(stem: str, n: int = 72) -> str:
    text = " ".join((stem or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def _public_question(gq: GlobalQuestion, doc_id: Optional[str], doc_name: Optional[str]) -> dict:
    options = json.loads(gq.options) if gq.options else []
    return {
        "question_id": gq.id,
        "stem": gq.stem,
        "question_type": gq.question_type,
        "options": options or [],
        "source_type": gq.source_type,
        "html_content": gq.html_content,
        "answer_params": gq.answer_params,
        "document_id": doc_id,
        "document_name": doc_name,
        "tags": parse_tags(gq.tags),
    }


class ChatTools:
    """对话工具包。show_question 会把可渲染题目放到 pending_ui，供 SSE 推给前端。"""

    def __init__(self, collection_id: Optional[str] = None):
        self.collection_id = collection_id
        self._pending_ui: list[dict] = []
        self._lock = threading.Lock()
        self.tools = Tools(name="chat")
        self.tools.register_tool(tool=self.search_knowledge_base)
        self.tools.register_tool(tool=self.list_quiz_books)
        self.tools.register_tool(tool=self.search_questions)
        self.tools.register_tool(tool=self.show_question)
        self.tools.register_tool(tool=self.get_active_goal)
        self.tools.register_tool(tool=self.list_today_tasks)
        self.tools.register_tool(tool=self.ensure_today_tasks)

    def drain_ui(self) -> list[dict]:
        with self._lock:
            items = list(self._pending_ui)
            self._pending_ui.clear()
        return items

    def get_tools(self):
        return self.tools

    def _scoped_doc_ids(self, db) -> Optional[list[str]]:
        if not self.collection_id:
            return None
        return [
            d.id
            for d in db.query(Document).filter(Document.collection_id == self.collection_id).all()
        ]

    def search_knowledge_base(self, query: str) -> str:
        """搜索用户知识库，返回匹配的文档片段和相似度分数。
        Args:
            query: 检索查询文本
        """
        query = "" if query is None else str(query)
        document_ids = None
        if self.collection_id:
            db = SessionLocal()
            try:
                document_ids = self._scoped_doc_ids(db)
            finally:
                db.close()

        try:
            results = chroma_store.search_documents(query, 5, document_ids)
        except Exception as e:
            return f"知识库检索暂时失败：{e}。请换一组关键词再搜一次。"
        if not results:
            return "未找到相关内容"
        lines = []
        for i, r in enumerate(results, 1):
            lines.append(f"[{i}] 文档片段（相关度 {r['distance']:.2f}）\n{r['text']}")
        return "\n\n".join(lines)

    def list_quiz_books(self) -> str:
        """列出当前分区题库里有题目的书本（书名、题量、做过多少）。"""
        db = SessionLocal()
        try:
            q = db.query(Document).filter(Document.zone == "study")
            if self.collection_id:
                q = q.filter(Document.collection_id == self.collection_id)
            docs = q.order_by(Document.updated_at.desc()).all()
            lines = []
            for d in docs:
                refs = db.query(QuestionRef).filter(QuestionRef.document_id == d.id).all()
                if not refs:
                    continue
                answered = sum(1 for r in refs if (r.attempt_count or 0) > 0)
                lines.append(
                    f'- {d.display_name} | id="{d.id}" | {len(refs)} 题 | 已做 {answered} 题'
                )
            if not lines:
                return "当前分区还没有题库。请先在出题页为学习区文档出题。"
            return "题库书本：\n" + "\n".join(lines)
        finally:
            db.close()

    def search_questions(
        self,
        keyword: str = "",
        document_id: str = "",
        tag: str = "",
        status: str = "all",
    ) -> str:
        """按书/关键词/标签/作答状态检索题目，只返回摘要和 id，不含答案。document_id 与 status 必须是字符串。
        Args:
            keyword: 题干关键词，可空
            document_id: 某一本书的 id 字符串，可空
            tag: 知识点标签，可空
            status: all / undone / wrong / unknown，字符串
        """
        keyword = "" if keyword is None else str(keyword)
        document_id = "" if document_id is None else str(document_id)
        tag = "" if tag is None else str(tag)
        status = "all" if status is None else str(status)
        db = SessionLocal()
        try:
            q = db.query(GlobalQuestion).join(
                QuestionProvenance, QuestionProvenance.question_id == GlobalQuestion.id
            )
            scoped = self._scoped_doc_ids(db)
            if document_id.strip():
                q = q.filter(QuestionProvenance.document_id == document_id.strip())
            elif scoped is not None:
                if not scoped:
                    return "当前分区没有文档。"
                q = q.filter(QuestionProvenance.document_id.in_(scoped))
            if keyword.strip():
                q = q.filter(GlobalQuestion.stem.like(f"%{keyword.strip()}%"))

            status_key = (status or "all").strip().lower()
            rows: list[tuple[GlobalQuestion, Optional[str], Optional[QuestionRef]]] = []
            seen: set[str] = set()
            for gq in q.order_by(GlobalQuestion.created_at.desc()).limit(80).all():
                if gq.id in seen:
                    continue
                seen.add(gq.id)
                prov = db.query(QuestionProvenance).filter_by(question_id=gq.id).first()
                doc_id = document_id.strip() or (prov.document_id if prov else None)
                ref = None
                if doc_id:
                    ref = db.query(QuestionRef).filter_by(question_id=gq.id, document_id=doc_id).first()
                if tag.strip():
                    tags = parse_tags(gq.tags)
                    if tag.strip() not in tags:
                        continue
                last = (ref.last_status if ref else None) or ""
                attempted = bool(ref and (ref.attempt_count or 0) > 0)
                if status_key == "undone" and attempted:
                    continue
                if status_key == "wrong" and last != "wrong":
                    continue
                if status_key == "unknown" and last != "unknown":
                    continue
                rows.append((gq, doc_id, ref))
                if len(rows) >= 8:
                    break

            if not rows:
                return "没有匹配的题目。"
            lines = []
            for gq, doc_id, ref in rows:
                label = _TYPE_LABEL.get(gq.question_type, gq.question_type)
                st = "未做"
                if ref and (ref.attempt_count or 0) > 0:
                    st = _STATUS_LABEL.get(ref.last_status or "", "已做")
                lines.append(
                    f'- [{label}][{st}] {_stem_preview(gq.stem)} | id="{gq.id}" | book="{doc_id or "-"}"'
                )
            return (
                "检索到的题目（不含答案）。要用可答题卡片展示给用户时，调用 show_question(question_id)。\n"
                + "\n".join(lines)
            )
        finally:
            db.close()

    def show_question(self, question_id: str) -> str:
        """在对话里向用户展示一道可作答的题（前端渲染答题卡）。不要把答案写进回复。
        Args:
            question_id: 题目 id，来自 search_questions 或用户指定
        """
        qid = (question_id or "").strip()
        if not qid:
            return "缺少 question_id"
        db = SessionLocal()
        try:
            gq = db.get(GlobalQuestion, qid)
            if not gq:
                return f"题目不存在：{qid}"
            prov = db.query(QuestionProvenance).filter_by(question_id=qid).first()
            doc_id = prov.document_id if prov else None
            if self.collection_id and doc_id:
                doc = db.get(Document, doc_id)
                if doc and doc.collection_id and doc.collection_id != self.collection_id:
                    return "这道题不在当前检索分区。"
            doc_name = None
            if doc_id:
                doc = db.get(Document, doc_id)
                doc_name = doc.display_name if doc else None
            payload = _public_question(gq, doc_id, doc_name)
            with self._lock:
                self._pending_ui.append(payload)
            kind = _TYPE_LABEL.get(gq.question_type, gq.question_type)
            return (
                f"已向用户展示可答题卡片。题型={kind} id={gq.id} "
                f"题干={_stem_preview(gq.stem)}。等待用户作答，不要把答案或选项对错写进文字。"
            )
        finally:
            db.close()

    def get_active_goal(self) -> str:
        """读取用户当前有效的学习目标。没有目标时告诉用户可以去首页写下目标。
        """
        from ..services.task import get_active_goal, goal_out

        db = SessionLocal()
        try:
            row = get_active_goal(db)
            if not row:
                return "当前没有有效目标。用户可以去首页写下一条长期目标。"
            data = goal_out(row)
            until = data.get("valid_until")
            extra = f" 有效期到 {until}。" if until else ""
            return f"当前目标：{data['text']}。{extra}".strip()
        finally:
            db.close()

    def list_today_tasks(self) -> str:
        """读取今天的学习任务（含未完成结转）。完成由程序判定，不要让用户勾选。
        """
        from ..services.task import evaluate, list_today_tasks, task_out

        db = SessionLocal()
        try:
            evaluate(db)
            rows = list_today_tasks(db)
            if not rows:
                return "今天还没有任务。打开首页或让我布置；完成由程序判定。"
            lines = []
            for t in rows:
                data = task_out(t)
                st = {"completed": "已完成", "expired": "已超时", "pending": "未完成"}.get(data["status"], data["status"])
                lines.append(f"- [{st}] {data['title']} | 入口={data['href']}")
            return "今日任务（用户不能勾选完成）：\n" + "\n".join(lines)
        finally:
            db.close()

    def ensure_today_tasks(self) -> str:
        """让任务 Agent 按目标、资料学情和以往完成情况布置今天的任务。条数和每条做多少由任务 Agent 决定。kind 和完成规则由程序定，不要让用户勾选。用户问今天做什么、帮我派任务时调用。
        """
        from ..services.task import evaluate, ensure_today_tasks, list_today_tasks, task_out

        db = SessionLocal()
        try:
            evaluate(db)
            ensure_today_tasks(db, force=True)
            evaluate(db)
            rows = list_today_tasks(db)
            if not rows:
                return "今天没有可派的任务（可能还没有目标，或资料缺口已被今日任务覆盖）。"
            lines = []
            for t in rows:
                data = task_out(t)
                st = {"completed": "已完成", "expired": "已超时", "pending": "未完成"}.get(data["status"], data["status"])
                lines.append(f"- [{st}] {data['title']}：{data.get('description') or ''} | 入口={data['href']}")
            return "已按目标和学情布置今日任务（用户不能勾选完成）：\n" + "\n".join(lines)
        finally:
            db.close()
