"""引导 Agent 工具：把名字、身份、目标写入数据库，并弹出确认/上传卡片。

不要加 from __future__ import annotations：Tina 用 inspect 读真实类型生成 JSON Schema。
"""

import threading

from tina import Tools

from ..core.database import SessionLocal
from ..services.chat import onboarding_cards_shown, user_confirmed_goal
from ..services.profile import get_or_create_profile, update_profile
from ..services.task import get_active_goal, upsert_active_goal


class OnboardingTools:
    def __init__(self):
        self._pending_ui = []
        self._lock = threading.Lock()
        self._goal_card_this_turn = False
        self.tools = Tools(name="onboarding")
        self.tools.register_tool(tool=self.save_name)
        self.tools.register_tool(tool=self.save_role)
        self.tools.register_tool(tool=self.confirm_learning_goal)
        self.tools.register_tool(tool=self.offer_add_document)
        self.tools.register_tool(tool=self.complete_onboarding)

    def drain_ui(self):
        with self._lock:
            items = list(self._pending_ui)
            self._pending_ui.clear()
        return items

    def get_tools(self):
        return self.tools

    def _emit(self, item):
        with self._lock:
            self._pending_ui.append(item)

    def save_name(self, name: str) -> str:
        """用户第一次开口时，把怎么称呼写入档案。听到再调，不要为了填表去要名字。
        Args:
            name: 用户怎么称呼自己，例如「啊噗」
        """
        text = (name or "").strip()
        if not text:
            return "名字是空的，再问一遍。"
        db = SessionLocal()
        try:
            update_profile(db, nickname=text, onboarding_status="in_progress")
        finally:
            db.close()
        self._emit({"type": "rail", "id": "meet", "status": "done"})
        self._emit({"type": "profile", "nickname": text})
        return f"已记住名字：{text}。"

    def save_role(self, role: str) -> str:
        """如果用户提到了身份、职业或在读什么，记下来。没提就不要为了填表去问。
        Args:
            role: 例如「大二学生」或「前端实习生」，有性别更好，没有也行
        """
        text = (role or "").strip()
        if not text:
            return "身份是空的，再问一遍。"
        db = SessionLocal()
        try:
            update_profile(db, role=text, onboarding_status="in_progress")
        finally:
            db.close()
        self._emit({"type": "rail", "id": "meet", "status": "done"})
        self._emit({"type": "profile", "role": text})
        return f"已记住身份：{text}。"

    def confirm_learning_goal(self, goal: str) -> str:
        """把用户自己说的学习目标写入数据库，并弹出确认卡片。必须来自对话，不要编造。
        同一句目标已经弹过卡就不要再调。用户改口了才再调。
        Args:
            goal: 收成的一句目标
        """
        text = (goal or "").strip()
        if not text:
            return "目标是空的，让用户再说一遍。"
        db = SessionLocal()
        try:
            existing = get_active_goal(db)
            profile = get_or_create_profile(db)
            shown = onboarding_cards_shown(db, profile.onboarding_session_id)
            same = bool(existing and (existing.text or "").strip() == text)
            if same and "goal_card" in shown:
                return (
                    f"目标已经是「{text}」，确认卡之前已经弹过了。不要再调用本工具，也不要再弹一张。"
                    "等用户点确认或改口；确认后再 offer_add_document。"
                )
            upsert_active_goal(db, text)
            update_profile(db, onboarding_status="in_progress")
        finally:
            db.close()
        self._emit({"type": "rail", "id": "goal", "status": "on"})
        self._emit({"type": "goal_card", "goal": text})
        self._goal_card_this_turn = True
        return (
            f"目标已写入数据库：{text}。前端会弹出确认卡片。"
            "这一轮不要再调用 offer_add_document。等用户点确认或改口后再弹资料卡。"
        )

    def offer_add_document(self) -> str:
        """用户确认目标卡片之后再调用。同一轮刚弹出目标卡时不要调。已经弹过资料卡就不要再调。
        """
        if self._goal_card_this_turn:
            return "目标确认卡这一轮刚弹出来。等用户点「确认，就是这个」之后，下一轮再调用本工具。"
        db = SessionLocal()
        try:
            profile = get_or_create_profile(db)
            shown = onboarding_cards_shown(db, profile.onboarding_session_id)
            if "docs_card" in shown:
                return "添加资料卡之前已经弹过了。不要再调用本工具，也不要再弹一张。等用户上传或点跳过。"
            if "goal_card" in shown and not user_confirmed_goal(db, profile.onboarding_session_id):
                return "确认学习目标卡之前已经弹过了。用户还没点确认，不要再弹任何卡片，也不要再调 confirm_learning_goal。"
            if "goal_card" not in shown and not get_active_goal(db):
                return "还没有学习目标。先 confirm_learning_goal，等用户确认后再调用本工具。"
        finally:
            db.close()
        self._emit({"type": "rail", "id": "docs", "status": "on"})
        self._emit({"type": "docs_card"})
        return "已弹出添加资料卡片。等用户上传或点跳过，不要假装已经传好了。"

    def complete_onboarding(self) -> str:
        """资料上传或跳过之后调用，标记引导完成。已经完成也可以再调，前端会显示回首页按钮。
        """
        db = SessionLocal()
        try:
            update_profile(db, onboarding_status="completed")
        finally:
            db.close()
        self._emit({"type": "rail", "id": "docs", "status": "done"})
        self._emit({"type": "rail", "id": "done", "status": "on"})
        self._emit({"type": "done"})
        return "引导已完成。前端会显示「去首页」。告诉用户可以回首页；这次对话会留在 Tina 栏。"
