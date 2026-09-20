"""Chat API：发送（普通/SSE）、历史、会话列表、删除。引导会话走同一条接口。"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import SessionLocal, get_db
from ..core.llm import format_agent_error, is_tool_related_chunk, visible_assistant_delta
from ..schemas import ai as ai_schemas
from ..services.chat import (
    GLITCH_THINK,
    _append_text_block,
    _merge_tool_ui,
    chat_service,
    drain_tool_ui,
    is_glitch_cmd,
    is_style_cmd,
    pack_assistant_payload,
)
from ..tools.tina_mood_actions import last_assistant_raw_text
from ..services.profile import get_or_create_profile, profile_out

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


def _release_request_db(db: Session) -> None:
    """流式响应返回前归还连接，避免整段 LLM 输出期间占着连接池。"""
    try:
        db.close()
    except Exception:
        pass


def _json_line(data: dict) -> str:
    def _default(obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        raise TypeError(f"Object of type {obj.__class__.__name__} is not JSON serializable")

    return f"data: {json.dumps(data, ensure_ascii=False, default=_default)}\n\n"


def _emit_mood_events(mood_actions, sid: str) -> list[str]:
    if mood_actions is None:
        return []
    lines = []
    for mood in mood_actions.drain():
        lines.append(_json_line({
            "event": "tina_mood",
            "mood": mood,
            "session_id": sid,
        }))
    return lines


def _emit_tool_events(tools, sid: str, widgets: list, tips: list, onboarding: list, plots: list, canvases: list, blocks: list):
    questions, tip_items, items, plot_items, canvas_items = drain_tool_ui(tools)
    lines = []
    _merge_tool_ui(widgets, tips, onboarding, plots, canvases, blocks, questions, tip_items, items, plot_items, canvas_items)
    for q in questions:
        lines.append(_json_line({
            "event": "show_question",
            "question": q,
            "session_id": sid,
        }))
    for t in tip_items:
        lines.append(_json_line({
            "event": "show_tip",
            "tip": t,
            "session_id": sid,
        }))
    for plot in plot_items:
        lines.append(_json_line({
            "event": "show_plot",
            "plot": plot,
            "session_id": sid,
        }))
    for canvas in canvas_items:
        lines.append(_json_line({
            "event": "show_canvas",
            "canvas": canvas,
            "session_id": sid,
        }))
    for item in items:
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
        _release_request_db(db)

        async def already_started():
            yield _json_line({"event": "session", "session_id": session_id})
            yield "data: [DONE]\n\n"

        return StreamingResponse(already_started(), media_type="text/event-stream")

    if is_glitch_cmd(body.content):
        chat_service.enable_crisis(db, session_id)
        _release_request_db(db)

        async def glitch_gen():
            yield _json_line({
                "event": "tina_glitch",
                "session_id": session_id,
            })
            yield "data: [DONE]\n\n"

        return StreamingResponse(glitch_gen(), media_type="text/event-stream")

    if is_style_cmd(body.content):
        new_style, ack = chat_service.apply_style_command(db, session_id, body.content or "/tina")
        _release_request_db(db)

        async def style_gen():
            yield _json_line({"event": "session", "session_id": session_id})
            yield _json_line({
                "event": "tina_style",
                "tina_style": new_style,
                "session_id": session_id,
            })
            yield _json_line({"content": ack, "session_id": session_id, "role": "assistant"})
            sdb = SessionLocal()
            try:
                profile = get_or_create_profile(sdb)
                yield _json_line({
                    "event": "profile",
                    "profile": profile_out(sdb, profile),
                    "session_id": session_id,
                })
            finally:
                sdb.close()
            yield "data: [DONE]\n\n"

        return StreamingResponse(style_gen(), media_type="text/event-stream")

    agent, sid, user_content, tools, mood_actions = await chat_service.send_message(
        db, session_id, body.content, body.collection_id,
        stream=body.stream, crisis=body.crisis,
        remaining_pages=body.remaining_pages,
        kickoff=body.kickoff,
    )

    if body.stream:
        # 归还请求级连接后再流式输出；流内写库用短生命周期 Session
        _release_request_db(db)

        async def gen():
            full = ""
            reasoning = ""
            widgets: list[dict] = []
            tips: list[dict] = []
            onboarding: list[dict] = []
            plots: list[dict] = []
            canvases: list[dict] = []
            blocks: list[dict] = []
            yield _json_line({"event": "session", "session_id": sid})
            using_tool = False
            try:
                async for chunk in agent.apredict(user_content):
                    for line in _emit_tool_events(tools, sid, widgets, tips, onboarding, plots, canvases, blocks):
                        yield line
                    for line in _emit_mood_events(mood_actions, sid):
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
                        _append_text_block(blocks, c)
                        yield _json_line({"content": c, "session_id": sid, "role": "assistant"})
                    if r:
                        reasoning += r
                        yield _json_line({"content": r, "session_id": sid, "role": "assistant", "reasoning_content": True})
                for line in _emit_tool_events(tools, sid, widgets, tips, onboarding, plots, canvases, blocks):
                    yield line
                for line in _emit_mood_events(mood_actions, sid):
                    yield line
            except Exception as e:
                logger.exception("chat 流式失败")
                err = f"（出错了：{format_agent_error(e)}）"
                if not full:
                    full = err
                    _append_text_block(blocks, err)
                yield _json_line({"content": err, "session_id": sid, "role": "assistant"})
            if using_tool:
                yield _json_line({
                    "event": "tool_status",
                    "using": False,
                    "session_id": sid,
                })
            # 可见流已 Hide 标签；入库用原文，便于历史回放表情；blocks 保持无标签展示
            persist_text = last_assistant_raw_text(agent) or full
            payload = pack_assistant_payload(widgets, onboarding, tips, blocks, plots, canvases)
            sdb = SessionLocal()
            try:
                in_crisis = chat_service.session_in_crisis(sdb, sid)
                kind = chat_service.session_kind(sdb, sid)
                think = GLITCH_THINK if in_crisis else (reasoning or None)
                message_id = chat_service.persist_assistant(sid, persist_text, think, None, payload)
                yield _json_line({
                    "event": "assistant_saved",
                    "message_id": message_id,
                    "session_id": sid,
                })
                if onboarding or kind == "onboarding":
                    profile = get_or_create_profile(sdb)
                    yield _json_line({
                        "event": "profile",
                        "profile": profile_out(sdb, profile),
                        "session_id": sid,
                    })
            finally:
                sdb.close()
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
