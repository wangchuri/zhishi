"""引导会话：落在 chat_sessions（kind=onboarding），对话走同一套 Chat API。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import ChatSession
from ..services.chat import chat_service
from ..services.profile import get_or_create_profile, profile_out, update_profile
from ..services.task import get_active_goal


def _looks_like_form_script(messages: list) -> bool:
    texts = [str(m.get("content") or "") for m in messages if m.get("role") == "assistant"]
    blob = "\n".join(texts[:4])
    return (
        ("你的名字是" in blob)
        or ("接下来我会问你几个问题" in blob)
        or ("今天先不着急干正事" in blob)
    )


class OnboardingService:
    def ensure_session(self, db: Session, *, replay: bool = False) -> ChatSession:
        profile = get_or_create_profile(db)
        if replay:
            session = chat_service.create_session(db, title="新手引导", kind="onboarding")
            update_profile(
                db,
                onboarding_status="in_progress",
                onboarding_session_id=session.id,
            )
            return session
        if profile.onboarding_session_id:
            existing = db.get(ChatSession, profile.onboarding_session_id)
            if existing:
                if (getattr(existing, "kind", None) or "chat") != "onboarding":
                    existing.kind = "onboarding"
                    db.commit()
                history = chat_service.get_history(db, existing.id)
                goal = get_active_goal(db)
                if history and not (goal and goal.text) and _looks_like_form_script(history):
                    session = chat_service.create_session(db, title="新手引导", kind="onboarding")
                    update_profile(
                        db,
                        onboarding_status="in_progress",
                        onboarding_session_id=session.id,
                    )
                    return session
                return existing
        session = chat_service.create_session(db, title="新手引导", kind="onboarding")
        update_profile(db, onboarding_status="in_progress", onboarding_session_id=session.id)
        return session

    def state(self, db: Session) -> dict:
        session = self.ensure_session(db)
        profile = get_or_create_profile(db)
        messages = chat_service.get_history(db, session.id)
        return {
            "session_id": session.id,
            "profile": profile_out(db, profile),
            "messages": messages,
            "needs_kickoff": len(messages) == 0,
        }


onboarding_service = OnboardingService()
