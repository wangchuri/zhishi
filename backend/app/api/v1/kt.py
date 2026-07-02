"""
KT 知识追踪路由 — 所有接口需要登录鉴权
"""

from fastapi import APIRouter, HTTPException, Depends
from app.api.deps import get_current_active_user
from models import (
    CognitiveStateRequest,
    CorrectResponse,
    EvaluateResponse,
    LearningPathRequest,
    SkillGraphResponse,
    PrerequisiteRequest,
    PrerequisiteResponse,
)
from server import _get_lekt

router = APIRouter(tags=["知识追踪"])


@router.post("/correct", response_model=CorrectResponse)
async def kt_correct(
    req: CognitiveStateRequest,
    current_user: dict = Depends(get_current_active_user),
):
    lekt = _get_lekt()
    if not lekt.is_loaded:
        raise HTTPException(503, "LEKT 模型未加载")
    result = lekt.correct(req.states)
    return CorrectResponse(**result)


@router.post("/evaluate", response_model=EvaluateResponse)
async def kt_evaluate(
    req: CognitiveStateRequest,
    current_user: dict = Depends(get_current_active_user),
):
    lekt = _get_lekt()
    if not lekt.is_loaded:
        raise HTTPException(503, "LEKT 模型未加载")
    result = lekt.evaluate(req.states)
    return EvaluateResponse(**result)


@router.post("/learning-path")
async def kt_learning_path(
    req: LearningPathRequest,
    current_user: dict = Depends(get_current_active_user),
):
    lekt = _get_lekt()
    if not lekt.is_loaded:
        raise HTTPException(503, "LEKT 模型未加载")
    return {"recommendations": lekt.recommend_learning_path(req.states, req.top_k)}


@router.post("/prerequisites", response_model=PrerequisiteResponse)
async def kt_prerequisites(
    req: PrerequisiteRequest,
    current_user: dict = Depends(get_current_active_user),
):
    lekt = _get_lekt()
    if not lekt.is_loaded:
        raise HTTPException(503, "LEKT 模型未加载")
    result = lekt.get_prerequisites(req.skill_id)
    if result["skill"] is None:
        raise HTTPException(404, f"技能 {req.skill_id} 不存在")
    return PrerequisiteResponse(**result)


@router.get("/skill-graph", response_model=SkillGraphResponse)
async def kt_skill_graph(
    current_user: dict = Depends(get_current_active_user),
):
    lekt = _get_lekt()
    if not lekt.is_loaded:
        raise HTTPException(503, "LEKT 模型未加载")
    result = lekt.get_dependency_graph()
    return SkillGraphResponse(**result)
