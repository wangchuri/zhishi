"""Chat API：发送（普通/SSE）、历史、会话列表、删除。引导会话走同一条接口。"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.llm import format_agent_error, is_tool_related_chunk, visible_assistant_delta
from ..schemas import ai as ai_schemas
from ..services.chat import (
    GLITCH_THINK,
    chat_service,
    drain_tool_ui,
    is_glitch_cmd,
    is_style_cmd,
    pack_assistant_payload,
)
from ..services.profile import get_or_create_profile, profile_out

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


def _json_line(data: dict) -> str:
    def _default(obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        raise TypeError(f"Object of type {obj.__class__.__name__} is not JSON serializable")

    return f"data: {json.dumps(data, ensure_ascii=False, default=_default)}\n\n"


def _emit_tool_events(tools, sid: str, widgets: list, onboarding: list):
    questions, items = drain_tool_ui(tools)
    lines = []
    for q in questions:
        widgets.append({"question": q})
        lines.append(_json_line({
            "event": "show_question",
            "question": q,
            "session_id": sid,
        }))
    for item in items:
        onboarding.append(item)
        lines.append(_json_line({
            "event": "onboarding_ui",
            "item": item,
            "session_id": sid,
        }))
    return lines


@router.post("")
async def send(body: ai_schemas.ChatSend, db: Session = Depends(get_db)):
    session_id = body.session_id
    if not session_id:
        session = chat_service.create_session(db)
        session_id = session.id
    else:
        chat_service.get_session(db, session_id)

    if body.kickoff and any(m.get("role") == "assistant" for m in chat_service.get_history(db, session_id)):
        async def already_started():
            yield _json_line({"event": "session", "session_id": session_id})
            yield "data: [DONE]\n\n"

        return StreamingResponse(already_started(), media_type="text/event-stream")

    if is_glitch_cmd(body.content):
        chat_service.enable_crisis(db, session_id)

        async def glitch_gen():
            yield _json_line({
                "event": "tina_glitch",
                "session_id": session_id,
            })
            yield "data: [DONE]\n\n"

        return StreamingResponse(glitch_gen(), media_type="text/event-stream")

    if is_style_cmd(body.content):
        new_style, ack = chat_service.apply_style_command(db, session_id, body.content or "/tina")

        async def style_gen():
            yield _json_line({"event": "session", "session_id": session_id})
            yield _json_line({
                "event": "tina_style",
                "tina_style": new_style,
                "session_id": session_id,
            })
            yield _json_line({"content": ack, "session_id": session_id, "role": "assistant"})
            profile = get_or_create_profile(db)
            yield _json_line({
                "event": "profile",
                "profile": profile_out(db, profile),
                "session_id": session_id,
            })
            yield "data: [DONE]\n\n"

        return StreamingResponse(style_gen(), media_type="text/event-stream")

    agent, sid, user_content, tools = await chat_service.send_message(
        db, session_id, body.content, body.collection_id,
        stream=body.stream, crisis=body.crisis,
        remaining_pages=body.remaining_pages,
        kickoff=body.kickoff,
    )

    if body.stream:
        async def gen():
            full = ""
            reasoning = ""
            widgets: list[dict] = []
            onboarding: list[dict] = []
            yield _json_line({"event": "session", "session_id": sid})
            using_tool = False
            try:
                async for chunk in agent.apredict(user_content):
                    for line in _emit_tool_events(tools, sid, widgets, onboarding):
                        yield line
                    toolish = is_tool_related_chunk(chunk)
                    if toolish and not using_tool:
                        using_tool = True
                        yield _json_line({
                            "event": "tool_status",
                            "using": True,
                            "session_id": sid,
                        })
                    c, r = visible_assistant_delta(chunk)
                    if (c or r) and using_tool and not toolish:
                        using_tool = False
                        yield _json_line({
                            "event": "tool_status",
                            "using": False,
                            "session_id": sid,
                        })
                    if c:
                        full += c
                        yield _json_line({"content": c, "session_id": sid, "role": "assistant"})
                    if r:
                        reasoning += r
                        yield _json_line({"content": r, "session_id": sid, "role": "assistant", "reasoning_content": True})
                for line in _emit_tool_events(tools, sid, widgets, onboarding):
                    yield line
            except Exception as e:
                logger.exception("chat 流式失败")
                err = f"（出错了：{format_agent_error(e)}）"
                full = full or err
                yield _json_line({"content": err, "session_id": sid, "role": "assistant"})
            if using_tool:
                yield _json_line({
                    "event": "tool_status",
                    "using": False,
                    "session_id": sid,
                })
            payload = pack_assistant_payload(widgets, onboarding)
            think = GLITCH_THINK if chat_service.session_in_crisis(db, sid) else (reasoning or None)
            message_id = chat_service.persist_assistant(sid, full, think, None, payload)
            yield _json_line({
                "event": "assistant_saved",
                "message_id": message_id,
                "session_id": sid,
            })
            if onboarding or chat_service.session_kind(db, sid) == "onboarding":
                profile = get_or_create_profile(db)
                yield _json_line({
                    "event": "profile",
                    "profile": profile_out(db, profile),
                    "session_id": sid,
                })
            yield "data: [DONE]\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")

    full, reasoning, citations = await chat_service.consume_and_save(
        agent, sid, user_content, tools
    )
    return {
        "content": full,
        "session_id": sid,
        "role": "assistant",
        "reasoning_content": reasoning,
        "citations": citations,
    }


@router.get("/history")
def history(session_id: str, db: Session = Depends(get_db)):
    messages = chat_service.get_history(db, session_id)
    crisis = chat_service.session_in_crisis(db, session_id)
    return {
        "session_id": session_id,
        "kind": chat_service.session_kind(db, session_id),
        "crisis": crisis,
        "messages": messages,
    }


@router.get("/sessions", response_model=ai_schemas.ChatSessionList)
def sessions(db: Session = Depends(get_db)):
    return {"sessions": chat_service.list_sessions(db)}


@router.delete("/sessions/{session_id}")
def delete(session_id: str, db: Session = Depends(get_db)):
    chat_service.delete_session(db, session_id)
    return {"deleted": True}
