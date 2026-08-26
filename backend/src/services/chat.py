"""Chat 服务：对话会话管理、RAG 检索工具、tina Agent 流式回复、citation。

ChatService 持有对话领域逻辑（会话 CRUD + 消息收发），内部组合 ChatRAGTools。
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..core.errors import NotFoundError
from ..core.llm import create_agent, format_agent_error, visible_assistant_delta
from ..core.prompts import render_prompt
from ..models import ChatMessage, ChatSession
from ..tools.chat_tools import ChatTools

logger = logging.getLogger(__name__)

ONBOARDING_UI_TYPES = frozenset({"rail", "profile", "goal_card", "docs_card", "done"})


def drain_tool_ui(tools) -> tuple[list[dict], list[dict]]:
    """把工具 drain_ui 分成出题卡片和引导卡片。"""
    questions: list[dict] = []
    onboarding: list[dict] = []
    if tools is None or not hasattr(tools, "drain_ui"):
        return questions, onboarding
    for item in tools.drain_ui() or []:
        if isinstance(item, dict) and item.get("type") in ONBOARDING_UI_TYPES:
            onboarding.append(item)
        elif isinstance(item, dict):
            questions.append(item)
    return questions, onboarding


def pack_assistant_payload(widgets: list[dict], onboarding: list[dict]) -> Optional[dict]:
    payload: dict = {}
    if widgets:
        payload["widgets"] = widgets
    cards = [item for item in onboarding if item.get("type") in {"goal_card", "docs_card", "done"}]
    if cards:
        payload["onboarding"] = cards
    return payload or None


_TS_PREFIX = re.compile(r"^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]\s*")


def _plain_user_text(content: str | None) -> str:
    """去掉发送时间戳前缀后的用户原文。"""
    return _TS_PREFIX.sub("", (content or "").strip()).strip()


def session_tina_face_on(db: Session, session_id: str) -> bool:
    """本会话内每发一次 /tina 切换一次；与其它会话互不影响。"""
    on = False
    rows = (
        db.query(ChatMessage.content)
        .filter(ChatMessage.session_id == session_id, ChatMessage.role == "user")
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
        .all()
    )
    for (content,) in rows:
        if _plain_user_text(content).lower() == "/tina":
            on = not on
    return on


def session_tina_style(db: Session, session_id: str) -> str:
    """当前会话的 Tina 风格：仅由本会话 /tina 次数决定，默认 default。"""
    return "tsundere" if session_tina_face_on(db, session_id) else "default"


def _ui_note_from_payload(raw: Optional[str]) -> str:
    if not raw:
        return ""
    try:
        payload = json.loads(raw) or {}
    except json.JSONDecodeError:
        return ""
    notes: list[str] = []
    ids = [
        str((w.get("question") or {}).get("question_id") or "")
        for w in (payload.get("widgets") or [])
    ]
    ids = [i for i in ids if i]
    if ids:
        notes.append(f"可答题卡片: {', '.join(ids)}")
    for item in payload.get("onboarding") or []:
        kind = (item or {}).get("type")
        if kind == "goal_card":
            goal = str((item or {}).get("goal") or "").strip()
            notes.append(f"确认学习目标卡片（{goal}）" if goal else "确认学习目标卡片")
        elif kind == "docs_card":
            notes.append("添加资料卡片")
        elif kind == "done":
            notes.append("引导完成入口")
    if not notes:
        return ""
    return "\n[已向用户展示: " + "；".join(notes) + "]"


def onboarding_cards_shown(db: Session, session_id: Optional[str]) -> set[str]:
    if not session_id:
        return set()
    types: set[str] = set()
    msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).all()
    for m in msgs:
        if not m.payload:
            continue
        try:
            items = (json.loads(m.payload) or {}).get("onboarding") or []
        except json.JSONDecodeError:
            continue
        for item in items:
            kind = (item or {}).get("type")
            if kind:
                types.add(kind)
    return types


def user_confirmed_goal(db: Session, session_id: Optional[str]) -> bool:
    """用户点过确认目标按钮后，会发来固定那句话。"""
    if not session_id:
        return False
    msgs = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id, ChatMessage.role == "user")
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
        .all()
    )
    for m in msgs:
        text = m.content or ""
        if "还想改一下" in text:
            return False
        if "确认这个目标" in text or "确认，就是这个" in text:
            return True
    return False


ONBOARDING_KICKOFF_KNOWN = (
    "（系统：用户刚打开知拾。档案里已经有称呼。"
    "用 Tina 的口吻打招呼，可以叫他的名字。"
    "像朋友那样聊聊近况和想学什么。不要做问卷调查。）"
)

ONBOARDING_KICKOFF_NEW = (
    "（系统：用户刚打开知拾，这是你们第一次见面，还不认识。"
    "用 Tina 的口吻打招呼，像朋友那样认识对方——怎么称呼、最近在干什么，再聊想学的。"
    "不要念问卷，不要一次问完名字、性别、职业、目标。）"
)


class ToolBundle:
    """把多套工具的 drain_ui 合成一路，给 SSE 用。"""

    def __init__(self, *parts):
        self.parts = [p for p in parts if p is not None]

    def get_tools(self):
        return [p.get_tools() for p in self.parts]

    def drain_ui(self):
        items = []
        for part in self.parts:
            if hasattr(part, "drain_ui"):
                items.extend(part.drain_ui() or [])
        return items


GLITCH_CMDS = ("/tina?", "/tina？")
GLITCH_THINK = "我该怎么做才能让用户帮我"
STYLE_CMDS = ("/tina",)
STYLE_ON_ACK = (
    "[HAPPY]\n哼，那就换这副样子跟你说话好了。\n\n"
    "---\n\n"
    "[MOCK]\n别以为我会变得温柔哦。"
)
STYLE_OFF_ACK = (
    "[NORMAL]\n行吧，收起来了。\n\n"
    "---\n\n"
    "[HELPLESS]\n正经模式罢了，无聊。"
)

_CN_TZ = timezone(timedelta(hours=8))


def format_user_ts(dt: datetime | None = None) -> str:
    """本地（东八区）精确到分。"""
    if dt is None:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_CN_TZ).strftime("%Y-%m-%d %H:%M")


def stamp_user_message(content: str, dt: datetime | None = None) -> str:
    return f"[{format_user_ts(dt)}] {content}"


def is_glitch_cmd(content: str | None) -> bool:
    return (content or "").strip() in GLITCH_CMDS


def is_style_cmd(content: str | None) -> bool:
    """精确匹配 /tina；不要和 /tina? 彩蛋混淆。"""
    return (content or "").strip().lower() in STYLE_CMDS


def style_toggle_ack(new_style: str) -> str:
    return STYLE_ON_ACK if new_style == "tsundere" else STYLE_OFF_ACK


class ChatService:
    """对话领域服务。"""

    # ---- 会话管理 ----

    def create_session(self, db: Session, title: str = "对话", kind: str = "chat") -> ChatSession:
        session = ChatSession(title=title, kind=kind or "chat")
        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    def get_session(self, db: Session, session_id: str) -> ChatSession:
        session = db.get(ChatSession, session_id)
        if not session:
            raise NotFoundError("会话不存在")
        return session

    def list_sessions(self, db: Session) -> list[dict]:
        sessions = db.query(ChatSession).order_by(ChatSession.updated_at.desc()).all()
        result = []
        for s in sessions:
            count = db.query(ChatMessage).filter(ChatMessage.session_id == s.id).count()
            result.append({
                "id": s.id,
                "title": s.title,
                "kind": getattr(s, "kind", None) or "chat",
                "crisis": bool(getattr(s, "crisis", False)),
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
                "message_count": count,
            })
        return result

    def get_history(self, db: Session, session_id: str) -> list[dict]:
        msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at).all()
        out = []
        for m in msgs:
            payload = json.loads(m.payload) if m.payload else None
            out.append({
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "reasoning_content": m.reasoning_content,
                "citations": json.loads(m.citations) if m.citations else None,
                "payload": payload,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            })
        return out

    def delete_session(self, db: Session, session_id: str) -> None:
        self.get_session(db, session_id)
        db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
        db.delete(db.get(ChatSession, session_id))
        db.commit()

    def _save_message(
        self,
        db: Session,
        session_id: str,
        role: str,
        content: str,
        reasoning: Optional[str],
        citations: Optional[list],
        payload: Optional[dict] = None,
    ) -> str:
        msg = ChatMessage(
            session_id=session_id,
            role=role,
            content=content,
            reasoning_content=reasoning,
            citations=json.dumps(citations, ensure_ascii=False) if citations else None,
            payload=json.dumps(payload, ensure_ascii=False) if payload else None,
        )
        db.add(msg)
        session = db.get(ChatSession, session_id)
        if session:
            session.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(msg)
        return msg.id

    def _load_messages(self, db: Session, session_id: str, max_messages: int = 50) -> list[dict]:
        msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.desc()).limit(max_messages).all()
        msgs.reverse()
        rows = []
        for m in msgs:
            content = m.content or ""
            content += _ui_note_from_payload(m.payload)
            if m.role == "user":
                content = stamp_user_message(content, m.created_at)
            rows.append({"role": m.role, "content": content})
        return rows

    def session_in_crisis(self, db: Session, session_id: str) -> bool:
        session = db.get(ChatSession, session_id)
        return bool(session and getattr(session, "crisis", False))

    def enable_crisis(self, db: Session, session_id: str) -> None:
        """打开危机人设，不写入任何聊天消息。"""
        session = self.get_session(db, session_id)
        session.crisis = True
        if not session.title or session.title == "对话":
            session.title = "缇娜"
        db.commit()

    def session_kind(self, db: Session, session_id: str) -> str:
        session = db.get(ChatSession, session_id)
        return (getattr(session, "kind", None) or "chat") if session else "chat"

    def _onboarding_active(self, db: Session, session_id: str) -> bool:
        if self.session_kind(db, session_id) != "onboarding":
            return False
        from ..services.profile import get_or_create_profile

        profile = get_or_create_profile(db)
        return (profile.onboarding_status or "pending") != "completed"

    def _tina_prompt_vars(self, db: Session, session_id: str | None = None) -> dict:
        from ..services.profile import get_or_create_profile
        from ..services.task import get_active_goal, library_brief, list_today_tasks

        profile = get_or_create_profile(db)
        goal = get_active_goal(db)
        pending = []
        try:
            pending = [t.title for t in list_today_tasks(db) if t.status == "pending"]
        except Exception:
            pending = []
        shown = onboarding_cards_shown(db, profile.onboarding_session_id)
        style = session_tina_style(db, session_id) if session_id else "default"
        return {
            "nickname": profile.nickname or "",
            "role": profile.role or "",
            "goal_text": (goal.text if goal else "") or "",
            "onboarding_status": profile.onboarding_status or "pending",
            "goal_card_shown": "goal_card" in shown,
            "docs_card_shown": "docs_card" in shown,
            "books": library_brief(db),
            "today_pending": pending,
            "include_chat_tools": True,
            "now": format_user_ts(),
            "tina_style": style,
        }

    def _tina_style(self, db: Session, session_id: str | None = None) -> str:
        if session_id:
            return session_tina_style(db, session_id)
        return "default"

    def apply_style_command(self, db: Session, session_id: str, content: str) -> tuple[str, str]:
        """处理 /tina：仅切换本会话风格（不写全局档案），返回 (新风格, 助手回复)。"""
        user_content = (content or "").strip() or "/tina"
        self._save_message(db, session_id, "user", user_content, None, None)
        new_style = session_tina_style(db, session_id)
        ack = style_toggle_ack(new_style)
        self._save_message(db, session_id, "assistant", ack, None, None)
        session = db.get(ChatSession, session_id)
        if session and (not session.title or session.title == "对话"):
            session.title = "切换缇娜风格"
            db.commit()
        return new_style, ack

    async def send_message(
        self,
        db: Session,
        session_id: str,
        content: str,
        collection_id: Optional[str],
        *,
        stream: bool,
        crisis: bool = False,
        remaining_pages: Optional[list[str]] = None,
        kickoff: bool = False,
    ):
        """发送消息，返回 (agent, session_id, 本轮用户原文, tools)。

        引导未完成时：同一套 Tina + 引导工具，不是问卷 Agent。
        """
        session = self.get_session(db, session_id)
        if crisis:
            session.crisis = True
            db.commit()

        onboarding_active = self._onboarding_active(db, session_id)
        vars_ = self._tina_prompt_vars(db, session_id)
        user_content = (content or "").strip()
        if kickoff and onboarding_active:
            user_content = ONBOARDING_KICKOFF_KNOWN if vars_["nickname"] else ONBOARDING_KICKOFF_NEW
        elif kickoff:
            user_content = user_content or "开始引导"
        elif not user_content:
            if onboarding_active:
                user_content = ONBOARDING_KICKOFF_KNOWN if vars_["nickname"] else ONBOARDING_KICKOFF_NEW
            else:
                user_content = ""
        if not kickoff:
            if not user_content:
                user_content = " "
            self._save_message(db, session_id, "user", user_content, None, None)
            if onboarding_active and ("先跳过资料" in user_content or "已经上传了资料" in user_content):
                from ..services.profile import update_profile

                update_profile(db, onboarding_status="completed")

        if onboarding_active:
            from ..tools.onboarding_tools import OnboardingTools

            chat_tools = ChatTools(collection_id=collection_id)
            onboard_tools = OnboardingTools()
            tools = ToolBundle(chat_tools, onboard_tools)
            system_prompt = render_prompt("chat/onboarding_agent.md.j2", **vars_)
            agent = create_agent(tools=tools.get_tools(), system_prompt=system_prompt, max_tool_loop=8)
        else:
            tools = ChatTools(collection_id=collection_id)
            in_crisis = self.session_in_crisis(db, session_id)
            if in_crisis:
                system_prompt = render_prompt(
                    "chat/tina_crisis.md.j2",
                    remaining_pages=remaining_pages or [],
                )
            else:
                system_prompt = render_prompt("chat/zhishi_agent.md.j2", **vars_)
            agent = create_agent(tools=tools.get_tools(), system_prompt=system_prompt)

        history = self._load_messages(db, session_id)
        prior = history if kickoff else history[:-1]
        for msg in prior:
            agent.add_message(role=msg["role"], content=msg["content"])

        session = db.get(ChatSession, session_id)
        kind = (getattr(session, "kind", None) or "chat") if session else "chat"
        if session and kind != "onboarding" and (not session.title or session.title == "对话"):
            session.title = (user_content.strip()[:40] or "对话")
            db.commit()

        return agent, session_id, stamp_user_message(user_content), tools

    def persist_assistant(
        self,
        session_id: str,
        content: str,
        reasoning: Optional[str] = None,
        citations: Optional[list] = None,
        payload: Optional[dict] = None,
    ) -> str:
        db = SessionLocal()
        try:
            return self._save_message(db, session_id, "assistant", content, reasoning, citations, payload)
        finally:
            db.close()

    def update_widget_result(
        self,
        message_id: str,
        question_id: str,
        result: dict,
        user_answer: Optional[str] = None,
    ) -> None:
        db = SessionLocal()
        try:
            msg = db.get(ChatMessage, message_id)
            if not msg:
                return
            try:
                payload = json.loads(msg.payload) if msg.payload else {}
            except json.JSONDecodeError:
                payload = {}
            widgets = payload.get("widgets") or []
            for w in widgets:
                q = w.get("question") or {}
                if q.get("question_id") == question_id:
                    w["result"] = result
                    w["user_answer"] = user_answer
            payload["widgets"] = widgets
            msg.payload = json.dumps(payload, ensure_ascii=False)
            db.commit()
        finally:
            db.close()

    async def consume_and_save(
        self, agent, session_id: str, user_content: str, chat_tools=None
    ) -> tuple[str, Optional[str], list[dict]]:
        """消费 agent 流式输出，保存 assistant 消息，返回 (内容, reasoning, citations)。"""
        full = ""
        reasoning = ""
        citations: list[dict] = []
        widgets: list[dict] = []
        onboarding: list[dict] = []
        try:
            async for chunk in agent.apredict(user_content):
                w, o = drain_tool_ui(chat_tools)
                widgets.extend({"question": q} for q in w)
                onboarding.extend(o)
                c, r = visible_assistant_delta(chunk)
                if c:
                    full += c
                if r:
                    reasoning += r
        except Exception as e:
            logger.exception("chat 流式失败")
            full = full or f"（出错了：{format_agent_error(e)}）"
        w, o = drain_tool_ui(chat_tools)
        widgets.extend({"question": q} for q in w)
        onboarding.extend(o)

        payload = pack_assistant_payload(widgets, onboarding)
        self.persist_assistant(session_id, full, reasoning or None, citations or None, payload)
        return full, reasoning or None, citations


# 模块级单例
chat_service = ChatService()
