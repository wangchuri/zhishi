"""Tutor 辅导 API。"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.llm import format_agent_error, visible_assistant_delta
from ..schemas import quiz as quiz_schemas
from ..services.tutor import tutor_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/tutor", tags=["tutor"])


def _json_line(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/sessions", response_model=quiz_schemas.TutorSession)
def create_session(body: quiz_schemas.TutorSessionCreate, db: Session = Depends(get_db)):
    session = tutor_service.create_tutor_session(
        db,
        question_id=body.question_id,
        quiz_session_id=body.quiz_session_id,
        quiz_answer_id=body.quiz_answer_id,
    )
    return tutor_service.session_out(db, session)


@router.get("/sessions/{session_id}", response_model=quiz_schemas.TutorSession)
def get_session(session_id: str, db: Session = Depends(get_db)):
    session = tutor_service.get_session(db, session_id)
    return tutor_service.session_out(db, session)


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    body: quiz_schemas.TutorMessageSend,
    db: Session = Depends(get_db),
):
    session = tutor_service.get_session(db, session_id)

    from ..core.llm import prepare_images, predict_stream

    image_paths, file_ids = await prepare_images(body.attachments)

    if body.stream:
        agent = tutor_service.ensure_agent(db, session)
        # 用户消息先落库：Agent 上下文只在内存里，落库后重进/重启都还在
        tutor_service.append_message(
            db, session, "user", body.content, attachments=body.attachments
        )
        # 流式输出前归还连接，避免 LLM 生成期间占满连接池
        try:
            db.close()
        except Exception:
            pass

        async def gen():
            full = ""
            reasoning_buf = ""
            try:
                async for chunk in predict_stream(
                    agent,
                    body.content,
                    multimodal=True,
                    file_ids=file_ids,
                    image_paths=image_paths,
                ):
                    c, r = visible_assistant_delta(chunk)
                    if c:
                        full += c
                        yield _json_line({"content": c})
                    if r:
                        reasoning_buf += r
                        yield _json_line({"reasoning_content": r})
            except Exception as e:
                logger.exception("辅导流式失败")
                yield _json_line({"content": f"（辅导出错了：{format_agent_error(e)}）"})
            finally:
                # 流结束再落库 assistant 回复（用独立连接，不占请求连接）
                if full:
                    from ..core.database import SessionLocal

                    db2 = SessionLocal()
                    try:
                        s2 = tutor_service.get_session(db2, session_id)
                        tutor_service.append_message(
                            db2,
                            s2,
                            "assistant",
                            full,
                            reasoning_content=reasoning_buf or None,
                        )
                    except Exception:
                        logger.exception("辅导回复落库失败")
                    finally:
                        db2.close()
            yield "data: [DONE]\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")

    content, reasoning = await tutor_service.send_message(
        db, session, body.content, body.attachments
    )
    return {"role": "assistant", "content": content, "reasoning_content": reasoning}
