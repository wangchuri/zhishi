"""任务 Agent 工具：从候选人派发，或按章节/标签检索后布置刷题/学习任务。

不要加 from __future__ import annotations。
"""

from typing import Optional

from tina import Tools

from ..core.config import config
from ..core.database import SessionLocal
from ..models import Document, GlobalQuestion, QuestionProvenance
from ..services.task import (
    _add_task,
    _doc_chapters,
    _page_numbers,
    _pages_with_questions,
    apply_candidate_quantity,
    preview_pages_for_doc,
    search_questions_for_doc,
    task_assign_blocked_reason,
)


def _parse_page_numbers(raw: str) -> list[int]:
    """解析页码：支持逗号与区间，如 "3,5,8-12" / "3，5；8-12"。去重保序。"""
    text = "" if raw is None else str(raw)
    out: list[int] = []
    seen: set[int] = set()

    def _push(n: int) -> None:
        if n > 0 and n not in seen:
            seen.add(n)
            out.append(n)

    for chunk in text.replace("；", ",").replace(";", ",").replace("，", ",").split(","):
        piece = chunk.strip()
        if not piece:
            continue
        if "-" in piece:
            a, _, b = piece.partition("-")
            try:
                lo, hi = int(a.strip()), int(b.strip())
            except ValueError:
                continue
            if lo > hi:
                lo, hi = hi, lo
            for n in range(lo, hi + 1):
                _push(n)
        else:
            try:
                _push(int(piece))
            except ValueError:
                continue
    return out


def _parse_id_list(raw: str) -> list[str]:
    text = "" if raw is None else str(raw)
    parts = []
    for chunk in text.replace(";", ",").replace("，", ",").replace("、", ",").split(","):
        s = chunk.strip()
        if s:
            parts.append(s)
    # 去重保序
    seen = set()
    out = []
    for p in parts:
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


class TaskAssignTools:
    def __init__(self, candidates):
        self.candidates = {c["id"]: c for c in candidates}
        self.assigned: list[str] = []
        self.tools = Tools(name="task")
        self.tools.register_tool(tool=self.assign_task)
        self.tools.register_tool(tool=self.list_book_chapters)
        self.tools.register_tool(tool=self.preview_book_pages)
        self.tools.register_tool(tool=self.search_book_questions)
        self.tools.register_tool(tool=self.assign_quiz_task)
        self.tools.register_tool(tool=self.assign_generate_task)
        self.tools.register_tool(tool=self.assign_learn_task)

    def get_tools(self):
        return self.tools

    def _blocked(self) -> str:
        db = SessionLocal()
        try:
            return task_assign_blocked_reason(db) or ""
        finally:
            db.close()

    def assign_task(
        self,
        candidate_id: str,
        title: str,
        reason: str,
        quantity: Optional[int] = None,
    ) -> str:
        """从候选人列表布置一条今日任务。candidate_id 必须来自候选人。quantity 是题量/页数/章数。
        Args:
            candidate_id: 候选人 id，例如 upload、gen-xxx、quiz-xxx、learn-xxx
            title: 任务名称，简短，不要写成鸡汤
            reason: 为什么今天派这一条、为何这个量
            quantity: 刷题道数、出题页数或学习章数。不填则按该候选人默认数量。
        """
        blocked = self._blocked()
        if blocked:
            return blocked
        cid = (candidate_id or "").strip()
        cand = self.candidates.get(cid)
        if not cand:
            ids = "、".join(self.candidates.keys()) or "无"
            return f"没有这个候选人：{cid}。只能用：{ids}"
        if cid in self.assigned:
            return "这条已经派过了。"
        qty = None
        if quantity is not None:
            try:
                qty = int(quantity)
            except (TypeError, ValueError):
                qty = None
        payload = apply_candidate_quantity(cand, qty)
        used = (
            payload.get("need")
            or len(payload.get("page_numbers") or [])
            or len(payload.get("question_ids") or [])
            or len(payload.get("chapter_ids") or [])
            or 1
        )
        title_text = (title or "").strip() or cand["fallback_title"]
        reason_text = (reason or "").strip() or cand["fallback_reason"]
        db = SessionLocal()
        try:
            row = _add_task(
                db,
                goal_id=cand.get("goal_id"),
                kind=cand["kind"],
                checker=cand["checker"],
                title=title_text[:200],
                description=reason_text,
                payload=payload,
            )
            if not row:
                again = task_assign_blocked_reason(db)
                if again:
                    return again
        finally:
            db.close()
        if not row:
            return "这条今天已经存在，换一个候选人。"
        self.assigned.append(cid)
        unit = cand.get("unit") or "项"
        return f"已布置 [{len(self.assigned)}] {title_text}（{used}{unit}）。还可以继续派，也可以停。"

    def list_book_chapters(self, document_id: str) -> str:
        """列出某本资料的章节目录（id + 标题），用于学习验收或按章选题。
        Args:
            document_id: 资料文档 id
        """
        doc_id = (document_id or "").strip()
        if not doc_id:
            return "缺少 document_id"
        db = SessionLocal()
        try:
            doc = db.get(Document, doc_id)
            if not doc:
                return f"找不到文档：{doc_id}"
            chapters = _doc_chapters(db, doc_id)
            if not chapters:
                return f"《{doc.display_name}》还没有目录。可先对该书生成学习路径，或改用标签检索题目。"
            lines = [
                f"《{doc.display_name}》章节："
                f"learned=true 表示已看书了解过（Tina 验收），"
                f"**不是**这一章题目都做过；false/未标=还没读懂。"
            ]
            for i, ch in enumerate(chapters, 1):
                flag = "true" if ch.get("learned") else "false"
                lines.append(f'{i}. id="{ch["id"]}" | learned={flag} | {ch["title"]}')
            return "\n".join(lines)
        finally:
            db.close()

    def preview_book_pages(self, document_id: str, page_numbers: str = "") -> str:
        """查看某本资料若干页的摘要与价值线索，判断哪些页值得出题。
        页码支持逗号与区间（如 "3,5,8-12"）；不填则列出该书还没出过题的页。
        Args:
            document_id: 资料文档 id
            page_numbers: 要预览的页码，逗号/区间分隔，可空
        """
        doc_id = (document_id or "").strip()
        if not doc_id:
            return "缺少 document_id"
        wanted = _parse_page_numbers(page_numbers) if page_numbers else None
        if page_numbers and not wanted:
            return "页码解析不出，请用逗号或区间，如 \"3,5,8-12\"。"
        db = SessionLocal()
        try:
            data = preview_pages_for_doc(db, doc_id, wanted)
            if data is None:
                return f"找不到文档：{doc_id}"
            if not data["pages"]:
                return f"《{data['name']}》没有可预览的页（可能这些页都已出题，或页码不在范围）。"
            lines = [
                f"《{data['name']}》共 {data['total_pages']} 页，已有题 {data['pages_with_questions']} 页，"
                f"未出题 {data['missing_pages']} 页。以下 {data['returned']} 页供判断："
            ]
            for p in data["pages"]:
                flag = "已有题" if p["has_questions"] else "无题"
                lines.append(
                    f'- 第 {p["page_number"]} 页 | {p["chars"]}字 | {flag} | {p["kind"]} | {p["suggest"]}'
                    f'\n  预览：{p["preview"] or "（空白）"}'
                )
            lines.append(
                "挑好值得出题的页后，用 assign_generate_task(document_id, page_numbers, title, reason) 布置；"
                "只会派还没有题的页。"
            )
            return "\n".join(lines)
        finally:
            db.close()

    def search_book_questions(
        self,
        document_id: str,
        chapter_id: str = "",
        tag: str = "",
        status: str = "all",
        limit: int = 20,
    ) -> str:
        """按书本检索题目，可按章节 id、知识点标签、作答状态过滤。返回题目 id 列表，供 assign_quiz_task 使用。
        Args:
            document_id: 资料文档 id
            chapter_id: 章节 id（来自 list_book_chapters），可空
            tag: 知识点标签，可空
            status: all / undone / wrong / unknown
            limit: 最多返回多少道，默认 20，上限 50
        """
        doc_id = (document_id or "").strip()
        if not doc_id:
            return "缺少 document_id"
        try:
            lim = int(limit)
        except (TypeError, ValueError):
            lim = 20
        db = SessionLocal()
        try:
            doc = db.get(Document, doc_id)
            if not doc:
                return f"找不到文档：{doc_id}"
            rows = search_questions_for_doc(
                db,
                doc_id,
                chapter_id=chapter_id or "",
                tag=tag or "",
                status=status or "all",
                limit=lim,
            )
            if not rows:
                return "没有匹配的题目。可换章节、标签或 status 再试。"
            ids = [r["question_id"] for r in rows]
            lines = [
                f"《{doc.display_name}》检索到 {len(rows)} 题。"
                f"布置刷题请调用 assign_quiz_task(document_id, question_ids, title, reason)，"
                f"question_ids 用逗号拼接下面的 id。"
            ]
            for r in rows:
                tags = "、".join(r.get("tags") or []) or "-"
                lines.append(
                    f'- [{r.get("status")}] {r.get("stem_preview")} | id="{r["question_id"]}"'
                    f' | chapter={r.get("chapter_id") or "-"} | tags={tags}'
                )
            lines.append("question_ids 候选：" + ",".join(ids))
            return "\n".join(lines)
        finally:
            db.close()

    def assign_quiz_task(
        self,
        document_id: str,
        question_ids: str,
        title: str,
        reason: str,
    ) -> str:
        """布置刷题任务：必须传入本题 id 列表（逗号分隔），完成后前端按这些 id 开刷题会话。
        Args:
            document_id: 资料文档 id
            question_ids: 题目 id，逗号分隔，来自 search_book_questions
            title: 任务名称
            reason: 为什么派、为何这些题
        """
        blocked = self._blocked()
        if blocked:
            return blocked
        doc_id = (document_id or "").strip()
        ids = _parse_id_list(question_ids)
        if not doc_id:
            return "缺少 document_id"
        if not ids:
            return "缺少 question_ids。请先 search_book_questions，再把返回的 id 用逗号拼起来。"
        if len(ids) > 50:
            ids = ids[:50]
        title_text = (title or "").strip() or "刷题"
        reason_text = (reason or "").strip() or "按章节/标签选题练习。"
        db = SessionLocal()
        try:
            doc = db.get(Document, doc_id)
            if not doc:
                return f"找不到文档：{doc_id}"
            valid = []
            for qid in ids:
                gq = db.get(GlobalQuestion, qid)
                if not gq:
                    continue
                prov = (
                    db.query(QuestionProvenance)
                    .filter_by(question_id=qid, document_id=doc_id)
                    .first()
                )
                if prov:
                    valid.append(qid)
            if not valid:
                return "这些 question_id 都不属于该文档，或 id 无效。"
            from ..services.task import get_active_goal

            goal = get_active_goal(db)
            payload = {
                "document_id": doc_id,
                "question_ids": valid,
                "need": len(valid),
                "filter": "自选",
            }
            key = "quiz-ids-" + ",".join(valid[:5]) + f"-{len(valid)}"
            if key in self.assigned:
                return "同样的题目列表今天已经派过了。"
            row = _add_task(
                db,
                goal_id=goal.id if goal else None,
                kind="quiz",
                checker="quiz_n",
                title=title_text[:200],
                description=reason_text,
                payload=payload,
            )
            if not row:
                again = task_assign_blocked_reason(db)
                if again:
                    return again
        finally:
            db.close()
        if not row:
            return "同样的刷题任务今天已经存在。"
        self.assigned.append(key)
        return (
            f"已布置 [{len(self.assigned)}] {title_text}（{len(valid)}题）。"
            f"入口会带上 question_ids。还可以继续派，也可以停。"
        )

    def assign_generate_task(
        self,
        document_id: str,
        page_numbers: str,
        title: str,
        reason: str,
    ) -> str:
        """布置出题任务：为指定页生成题目。只会派还没有题的页，超出单次上限的页会截断。
        Args:
            document_id: 资料文档 id
            page_numbers: 页码，逗号/区间分隔（如 "3-7,10"）；建议先用 preview_book_pages 确认
            title: 任务名称
            reason: 为什么派这些页、为何这个量
        """
        blocked = self._blocked()
        if blocked:
            return blocked
        doc_id = (document_id or "").strip()
        if not doc_id:
            return "缺少 document_id"
        want = _parse_page_numbers(page_numbers)
        if not want:
            return "缺少 page_numbers，例如 \"3-7,10\"。可先用 preview_book_pages 查看。"
        db = SessionLocal()
        try:
            doc = db.get(Document, doc_id)
            if not doc:
                return f"找不到文档：{doc_id}"
            valid = set(_page_numbers(doc))
            have_q = _pages_with_questions(db, doc_id)
            picked = [p for p in want if p in valid]
            already = [p for p in picked if p in have_q]
            fresh = [p for p in picked if p not in have_q]
            if not fresh:
                if already:
                    return "选中的页都已有题，换几页吧（可用 preview_book_pages 看哪些页没题）。"
                return "这些页码都不在该文档范围内。"
            cap = max(1, config.question_gen_max_pages)
            dropped: list[int] = []
            if len(fresh) > cap:
                dropped = fresh[cap:]
                fresh = fresh[:cap]
            key = "gen-ids-" + doc_id + "-" + ",".join(str(p) for p in fresh)
            if key in self.assigned:
                return "同样的出题页今天已经派过了。"
            from ..services.task import get_active_goal

            goal = get_active_goal(db)
            payload = {
                "document_id": doc_id,
                "page_numbers": fresh,
                "need": len(fresh),
                "baseline_have_count": len(have_q),
            }
            title_text = (title or "").strip() or f"给《{doc.display_name}》出题"
            reason_text = (reason or "").strip() or "为选定页生成题目。"
            row = _add_task(
                db,
                goal_id=goal.id if goal else None,
                kind="generate",
                checker="generate_pages",
                title=title_text[:200],
                description=reason_text,
                payload=payload,
            )
            if not row:
                again = task_assign_blocked_reason(db)
                if again:
                    return again
        finally:
            db.close()
        if not row:
            return "同样的出题任务今天已经存在。"
        self.assigned.append(key)
        extra = f"，跳过已有题 {len(already)} 页" if already else ""
        more = f"，超出单次上限 {len(dropped)} 页未派" if dropped else ""
        return f"已布置 [{len(self.assigned)}] {title_text}（{len(fresh)}页）{extra}{more}。"

    def assign_learn_task(
        self,
        document_id: str,
        chapter_ids: str,
        title: str,
        reason: str,
    ) -> str:
        """布置学习验收任务：学完指定章节后，用户去 Tina 对话验收；Tina 调用 complete_learn_task 才算完成。
        Args:
            document_id: 资料文档 id
            chapter_ids: 章节 id，逗号分隔，来自 list_book_chapters
            title: 任务名称
            reason: 为什么派这些章
        """
        blocked = self._blocked()
        if blocked:
            return blocked
        doc_id = (document_id or "").strip()
        want = _parse_id_list(chapter_ids)
        if not doc_id:
            return "缺少 document_id"
        if not want:
            return "缺少 chapter_ids。请先 list_book_chapters。"
        title_text = (title or "").strip() or "学习并验收"
        reason_text = (reason or "").strip() or "学完后找 Tina 口头验收。"
        db = SessionLocal()
        try:
            doc = db.get(Document, doc_id)
            if not doc:
                return f"找不到文档：{doc_id}"
            chapters = _doc_chapters(db, doc_id)
            by_id = {c["id"]: c for c in chapters}
            by_title = {c["title"]: c for c in chapters}
            picked = []
            for w in want:
                ch = by_id.get(w) or by_title.get(w)
                if ch and ch not in picked:
                    picked.append(ch)
            if not picked:
                return "章节 id 无效。请用 list_book_chapters 返回的 id。"
            from ..services.task import get_active_goal

            goal = get_active_goal(db)
            payload = {
                "document_id": doc_id,
                "document_name": doc.display_name,
                "chapter_ids": [c["id"] for c in picked],
                "chapter_titles": [c["title"] for c in picked],
                "need": len(picked),
            }
            key = "learn-" + doc_id + "-" + ",".join(payload["chapter_ids"])
            if key in self.assigned:
                return "同样的学习验收今天已经派过了。"
            row = _add_task(
                db,
                goal_id=goal.id if goal else None,
                kind="learn",
                checker="tina_verify",
                title=title_text[:200],
                description=reason_text,
                payload=payload,
            )
            if not row:
                again = task_assign_blocked_reason(db)
                if again:
                    return again
        finally:
            db.close()
        if not row:
            return "同样的学习任务今天已经存在。"
        self.assigned.append(key)
        return (
            f"已布置 [{len(self.assigned)}] {title_text}（{len(picked)}章）。"
            f"用户点「去验收」会打开 Tina。还可以继续派，也可以停。"
        )
