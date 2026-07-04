"""针对训练 API"""
import json
from typing import Union

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.schemas.training import (
    TargetedTrainingStartOut,
    TrainingTutorMessageCreate,
    TrainingTutorReplyOut,
)
from app.services import training_service

router = APIRouter(tags=["针对训练"])


@router.post(
    "/targeted/start",
    response_model=TargetedTrainingStartOut,
    status_code=status.HTTP_201_CREATED,
)
def start_targeted_training(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
):
    """Agent 制定训练计划：选题 + rationale，并创建刷题会话。"""
    result = training_service.start_targeted_training(db, current_user["user_id"])
    db.commit()
    return result


@router.post(
    "/targeted/tutor/{agent_session_id}",
    response_model=None,
)
def training_tutor_message(
    agent_session_id: str,
    payload: TrainingTutorMessageCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_active_user),
) -> Union[TrainingTutorReplyOut, StreamingResponse]:
    """针对训练页 AI 辅导 — 复用制定计划时的 Agent 上下文。"""
    user_id = current_user["user_id"]

    if payload.stream:

        def sse_stream():
            try:
                for chunk in training_service.stream_training_tutor(
                    db, user_id, agent_session_id, payload.content
                ):
                    data = json.dumps(
                        {
                            "agent_session_id": agent_session_id,
                            "role": chunk.get("role", "assistant"),
                            "content": chunk.get("content", ""),
                            **(
                                {"reasoning_content": chunk["reasoning_content"]}
                                if chunk.get("reasoning_content")
                                else {}
                            ),
                            **({"tool_name": chunk["tool_name"]} if chunk.get("tool_name") else {}),
                        },
                        ensure_ascii=False,
                    )
                    yield f"event: message\ndata: {data}\n\n"
            finally:
                db.commit()

        return StreamingResponse(
            sse_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    full_content = ""
    for chunk in training_service.stream_training_tutor(
        db, user_id, agent_session_id, payload.content
    ):
        if chunk.get("content"):
            full_content += chunk["content"]
    db.commit()
    return TrainingTutorReplyOut(
        content=full_content or "（无回复）",
        agent_session_id=agent_session_id,
    )
