"""任务 Agent 工具：从程序候选人里派任务。条数和每条数量由模型自己定，不能改题号/页码本身。

不要加 from __future__ import annotations。
"""

from typing import Optional

from tina import Tools

from ..core.database import SessionLocal
from ..services.task import _add_task, apply_candidate_quantity


class TaskAssignTools:
    def __init__(self, candidates):
        self.candidates = {c["id"]: c for c in candidates}
        self.assigned = []
        self.tools = Tools(name="task")
        self.tools.register_tool(tool=self.assign_task)

    def get_tools(self):
        return self.tools

    def assign_task(
        self,
        candidate_id: str,
        title: str,
        reason: str,
        quantity: Optional[int] = None,
    ) -> str:
        """布置一条今日任务。candidate_id 必须来自候选人列表。quantity 是你决定的题量或页数。
        Args:
            candidate_id: 候选人 id，例如 upload、gen-xxx、quiz-xxx
            title: 任务名称，简短，不要写成鸡汤
            reason: 为什么今天派这一条、为何这个量
            quantity: 刷题道数或出题页数。不填则按该候选人可派的全部数量。
        """
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
        used = payload.get("need") or len(payload.get("page_numbers") or []) or 1
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
        finally:
            db.close()
        if not row:
            return "这条今天已经存在，换一个候选人。"
        self.assigned.append(cid)
        unit = cand.get("unit") or "项"
        return f"已布置 [{len(self.assigned)}] {title_text}（{used}{unit}）。还可以继续派，也可以停。"
