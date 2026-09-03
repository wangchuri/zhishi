"""对话 Agent 工具：知识库检索 + 题库浏览 / 出题卡片。

不要加 from __future__ import annotations：Tina 用 inspect 读真实类型生成 JSON Schema，
推迟求值会把 str 变成字符串，参数会被当成 object，模型容易写出没加引号的 JSON。
"""

import json
import re
import threading
import uuid
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


def _clip(text: str, n: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[: n - 1] + "…"


def _stem_preview(stem: str, n: int = 72) -> str:
    return _clip(stem, n)


def format_options_for_agent(options) -> str:
    if not options:
        return ""
    if isinstance(options, str):
        try:
            options = json.loads(options)
        except json.JSONDecodeError:
            return options.strip()
    if not isinstance(options, list):
        return ""
    lines = []
    for item in options:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        text = str(item.get("text") or "").strip()
        if key and text:
            lines.append(f"{key}. {text}")
        elif text:
            lines.append(text)
    return "\n".join(lines)


def format_question_for_agent(
    *,
    question_id: str = "",
    stem: str = "",
    question_type: str = "",
    options=None,
    user_answer: str | None = None,
    result: dict | None = None,
) -> str:
    """给 Tina 看的题面：完整题干和选项。未作答不带标准答案；已作答才附判定与解析。"""
    kind = _TYPE_LABEL.get(question_type, question_type or "")
    parts: list[str] = []
    head = []
    if kind:
        head.append(f"题型={kind}")
    if question_id:
        head.append(f"id={question_id}")
    if head:
        parts.append(" ".join(head))
    body = _clip(stem, 2500)
    if body:
        parts.append(f"题干：{body}")
    opt = format_options_for_agent(options)
    if opt:
        parts.append("选项：\n" + opt)
    if result and isinstance(result, dict):
        status = str(result.get("status") or "")
        st = _STATUS_LABEL.get(status, status or "已作答")
        line = f"作答结果：{st}"
        ua = (user_answer or "").strip()
        if ua:
            line += f"；用户答案={_clip(ua, 400)}"
        ca = str(result.get("correct_answer") or "").strip()
        if ca:
            line += f"；正确答案={_clip(ca, 400)}"
        exp = str(result.get("explanation") or result.get("ai_reason") or "").strip()
        if exp:
            line += f"；解析={_clip(exp, 800)}"
        parts.append(line)
    return "\n".join(parts)


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
    """对话工具包。show_question / show_tip 会把卡片放到 pending_ui，供 SSE 推给前端。"""

    def __init__(self, collection_id: Optional[str] = None):
        self.collection_id = collection_id
        self._pending_ui: list[dict] = []
        self._lock = threading.Lock()
        self.tools = Tools(name="chat")
        self.tools.register_tool(tool=self.search_knowledge_base)
        self.tools.register_tool(tool=self.list_quiz_books)
        self.tools.register_tool(tool=self.search_questions)
        self.tools.register_tool(tool=self.show_question)
        self.tools.register_tool(tool=self.search_tips)
        self.tools.register_tool(tool=self.list_tips)
        self.tools.register_tool(tool=self.show_tip)
        self.tools.register_tool(tool=self.show_plot)
        self.tools.register_tool(tool=self.show_canvas)
        self.tools.register_tool(tool=self.get_active_goal)
        self.tools.register_tool(tool=self.list_today_tasks)
        self.tools.register_tool(tool=self.ensure_today_tasks)
        self.tools.register_tool(tool=self.complete_learn_task)
        self.tools.register_tool(tool=self.set_chapter_learned)
        self.tools.register_tool(tool=self.remember_about_user)
        self.tools.register_tool(tool=self.list_user_memory)
        self.tools.register_tool(tool=self.forget_user_memory)

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
        """按书/关键词/标签/作答状态检索题目，返回完整题干、选项和 id，不含答案。document_id 与 status 必须是字符串。
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
                st = "未做"
                if ref and (ref.attempt_count or 0) > 0:
                    st = _STATUS_LABEL.get(ref.last_status or "", "已做")
                try:
                    opts = json.loads(gq.options) if gq.options else []
                except json.JSONDecodeError:
                    opts = []
                body = format_question_for_agent(
                    question_id=gq.id,
                    stem=gq.stem,
                    question_type=gq.question_type,
                    options=opts,
                )
                lines.append(f"- [{st}] book=\"{doc_id or '-'}\"\n{body}")
            return (
                "检索到的题目（含完整题干和选项，不含答案）。"
                "要用可答题卡片展示给用户时，调用 show_question(question_id)。\n\n"
                + "\n\n".join(lines)
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
            body = format_question_for_agent(
                question_id=gq.id,
                stem=gq.stem,
                question_type=gq.question_type,
                options=payload.get("options"),
            )
            return (
                "已向用户展示可答题卡片。下面是完整题面（不含答案），讲解时对照这份内容，不要凭记忆改写题目。\n"
                f"{body}\n"
                "等待用户作答，不要把答案或选项对错写进文字。"
            )
        finally:
            db.close()

    def search_tips(
        self,
        keyword: str = "",
        tag: str = "",
        document_id: str = "",
    ) -> str:
        """检索用户保存的 tip（划选摘录）。返回总数和摘要、tip_id；要展示卡片时必须再调 show_tip。
        Args:
            keyword: 在标题/正文里搜，可空
            tag: 用户自订分类 tag，可空
            document_id: 某一本书的资料 id，可空
        """
        from ..services.note import note_service

        keyword = "" if keyword is None else str(keyword)
        tag = "" if tag is None else str(tag)
        document_id = "" if document_id is None else str(document_id)
        db = SessionLocal()
        try:
            if self.collection_id and document_id.strip():
                doc = db.get(Document, document_id.strip())
                if doc and doc.collection_id and doc.collection_id != self.collection_id:
                    return "该 tip 不在当前检索分区。"
            found = note_service.search_tips(
                db,
                keyword=keyword,
                tag=tag,
                document_id=document_id,
                limit=20,
            )
            total = int(found.get("total") or 0)
            rows = found.get("tips") or []
            if total == 0:
                return "共 0 条 tip。没有找到匹配的摘录。用户可以在阅读页划选文字收入 tip。"
            lines = []
            for t in rows:
                loc = ""
                if t.get("document_name"):
                    loc = f"《{t['document_name']}》"
                if t.get("page_number") is not None:
                    loc += f" 第{t['page_number']}页"
                tags = t.get("tags") or []
                tag_s = f" tags={','.join(tags)}" if tags else ""
                lines.append(
                    f'- id="{t["tip_id"]}" | {t.get("title") or "无标题"} | {loc}{tag_s}\n'
                    f'  {t.get("preview") or ""}'
                )
            shown = len(rows)
            extra = f"，以下列出最近 {shown} 条" if total > shown else ""
            return (
                f"共 {total} 条 tip{extra}。数量以本句「共 N 条」为准，不要自己数列表。"
                "要向用户展示卡片时必须调用 show_tip(tip_id)，文字描述不会弹出卡片。\n"
                + "\n".join(lines)
            )
        finally:
            db.close()

    def list_tips(self, document_id: str = "") -> str:
        """列出用户 tip 的准确总数和摘要。问「有多少条 tip」「我的 tip」时用这个，不要自己数。
        Args:
            document_id: 某一本书的资料 id，可空（空=全部）
        """
        return self.search_tips(keyword="", tag="", document_id=document_id or "")

    def show_tip(self, tip_id: str) -> str:
        """在对话里向用户展示一条 tip 卡片（摘录原文）。
        Args:
            tip_id: tip id，来自 search_tips
        """
        tid = (tip_id or "").strip()
        if not tid:
            return "缺少 tip_id"
        db = SessionLocal()
        try:
            from ..services.note import note_service

            note = note_service.get_note(db, tid)
            if not note or note.note_type != "tip":
                return f"tip 不存在：{tid}"
            if note.document_id and self.collection_id:
                doc = db.get(Document, note.document_id)
                if doc and doc.collection_id and doc.collection_id != self.collection_id:
                    return "该 tip 不在当前检索分区。"
            item = note_service.note_to_item(db, note)
            payload = {**item, "_kind": "tip"}
            with self._lock:
                self._pending_ui.append(payload)
            title = item.get("title") or "摘录"
            loc = item.get("document_name") or ""
            page = item.get("page_number")
            where = f"{loc} 第{page}页" if page is not None and loc else (loc or "未关联资料")
            return (
                f"已向用户展示 tip 卡片。标题={title} 出处={where} id={tid}。"
                f"卡片会嵌在对话里，不要再说「已经弹出」来代替这次调用，也不要把摘录全文再抄一遍。"
            )
        finally:
            db.close()

    def show_plot(
        self,
        expression: str,
        title: str = "",
        x_min: str = "-10",
        x_max: str = "10",
    ) -> str:
        """在右侧画布画出函数图像。用户要看函数图、对照曲线时必须调用。不要用文字假装已经画了。
        Args:
            expression: 关于 x 的表达式。支持嵌套、sin^2(x)、|x|、\\frac{a}{b}、if(x<0,-x,x)。多条曲线用分号分隔，最多 3 条
            title: 图标题，可空
            x_min: 横坐标左端，默认 -10
            x_max: 横坐标右端，默认 10
        """
        raw = (expression or "").strip()
        if not raw:
            return "缺少 expression。请传入如 sin(x) 或 x^2。"
        exprs = [s.strip() for s in re.split(r"[\n；;]+", raw) if s.strip()][:3]
        if not exprs:
            return "表达式无效。"
        try:
            lo = float(str(x_min).strip() or "-10")
        except ValueError:
            lo = -10.0
        try:
            hi = float(str(x_max).strip() or "10")
        except ValueError:
            hi = 10.0
        if lo == hi:
            lo, hi = lo - 1, hi + 1
        if lo > hi:
            lo, hi = hi, lo
        if hi - lo > 1e6:
            return "横坐标范围过大，请缩小 x_min / x_max。"
        payload = {
            "_kind": "plot",
            "id": uuid.uuid4().hex,
            "title": (title or "").strip() or None,
            "expressions": exprs,
            "x_min": lo,
            "x_max": hi,
        }
        with self._lock:
            self._pending_ui.append(payload)
        shown = "；".join(f"y={e}" for e in exprs)
        return (
            f"已在右侧画布画出函数图。{shown}，x∈[{lo:g},{hi:g}]。"
            "结合图像讲解即可，不要把图再画成 ASCII，也不要声称「已经画了」来代替这次调用。"
        )

    def show_canvas(self, html: str, title: str = "") -> str:
        """在右侧画布显示一段自包含的 HTML/SVG/JS 图形（圆、参数方程、交互示意等）。
        不要外链、不要 iframe。y=f(x) 的普通函数图请用 show_plot。
        Args:
            html: 片段即可，可用 svg/canvas 和内联 script。禁止外链脚本和 iframe
            title: 画布标题，可空
        """
        from ..services.canvas import sanitize_canvas_html

        ok, cleaned = sanitize_canvas_html(html)
        if not ok:
            return f"无法显示画布：{cleaned}"
        payload = {
            "_kind": "canvas",
            "id": uuid.uuid4().hex,
            "title": (title or "").strip() or None,
            "html": cleaned,
        }
        with self._lock:
            self._pending_ui.append(payload)
        return (
            f"已在右侧打开 HTML 画布。标题={payload['title'] or '画布'}。"
            "结合图形讲解即可，不要把图再画成 ASCII，也不要声称已经画了来代替这次调用。"
        )

    def remember_about_user(self, content: str, category: str = "preference") -> str:
        """记住用户的偏好、习惯、个性或稳定事实，供以后对话参考。
        Args:
            content: 要记住的内容，简短一句
            category: preference / personality / habit / fact / other
        """
        from ..services.memory import remember

        db = SessionLocal()
        try:
            ok, msg = remember(db, content, category=category or "preference")
            return msg if ok else f"未能记住：{msg}"
        finally:
            db.close()

    def list_user_memory(self) -> str:
        """列出已记住的用户信息（偏好、习惯等）。"""
        from ..services.memory import format_for_agent

        db = SessionLocal()
        try:
            return "用户长期记忆：\n" + format_for_agent(db)
        finally:
            db.close()

    def forget_user_memory(self, memory_id: str) -> str:
        """删除一条不再适用的长期记忆。
        Args:
            memory_id: 记忆 id，来自 list_user_memory
        """
        from ..services.memory import forget

        db = SessionLocal()
        try:
            ok, msg = forget(db, memory_id)
            return msg if ok else f"未能删除：{msg}"
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
        """读取今天的学习任务（含未完成结转）。upload/generate/quiz 由程序判定；learn 须你验收后调用 complete_learn_task。
        """
        from ..services.task import evaluate, list_today_tasks, task_out

        db = SessionLocal()
        try:
            evaluate(db)
            rows = list_today_tasks(db)
            if not rows:
                return "今天还没有任务。打开首页或让我布置。"
            lines = []
            for t in rows:
                data = task_out(t)
                st = {"completed": "已完成", "expired": "已超时", "pending": "未完成"}.get(data["status"], data["status"])
                extra = ""
                if data.get("kind") == "learn" and data["status"] == "pending":
                    extra = f' | 验收请调 complete_learn_task(task_id="{data["id"]}")'
                lines.append(f"- [{st}][{data.get('kind')}] {data['title']} | id={data['id']} | 入口={data['href']}{extra}")
            return "今日任务：\n" + "\n".join(lines)
        finally:
            db.close()

    def ensure_today_tasks(self) -> str:
        """让任务 Agent 按目标、资料学情和以往完成情况布置今天的任务。条数和每条做多少由任务 Agent 决定。kind 和完成规则由程序定。用户问今天做什么、帮我派任务时调用。
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
                lines.append(f"- [{st}][{data.get('kind')}] {data['title']}：{data.get('description') or ''} | 入口={data['href']}")
            return "已按目标和学情布置今日任务：\n" + "\n".join(lines)
        finally:
            db.close()

    def complete_learn_task(self, task_id: str, summary: str = "") -> str:
        """验收通过后标记「学习」任务完成，并把任务里的章节标为 learned=true。仅用于 kind=learn。
        Args:
            task_id: 任务 id，来自 list_today_tasks 或用户消息里的 task=
            summary: 一两句验收结论，可空
        """
        from ..services.task import complete_learn_task_by_tina

        db = SessionLocal()
        try:
            ok, msg = complete_learn_task_by_tina(db, task_id, summary=summary or "")
            return msg if ok else f"未能完成：{msg}"
        finally:
            db.close()

    def set_chapter_learned(
        self,
        document_id: str,
        chapter_ids: str,
        learned: bool = True,
    ) -> str:
        """在书本目录上标记章节是否已看书了解过（不是「这一章题都做过」）。
        learned=true 已读懂，false 未读懂。任务 Agent 会优先派未读懂的章。
        Args:
            document_id: 资料文档 id
            chapter_ids: 章节 id，逗号分隔（来自 list_today_tasks / 目录）
            learned: true=已看书了解过，false=还没读懂
        """
        from ..services.task import set_chapters_learned

        ids = []
        for chunk in (chapter_ids or "").replace(";", ",").replace("，", ",").replace("、", ",").split(","):
            s = chunk.strip()
            if s:
                ids.append(s)
        db = SessionLocal()
        try:
            n, msg = set_chapters_learned(db, document_id, ids, learned=bool(learned))
            return msg if n else f"未更新：{msg}"
        finally:
            db.close()
