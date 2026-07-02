from pydantic import BaseModel
from typing import List, Optional, Dict


class CognitiveStateRequest(BaseModel):
    """认知状态请求：skill_id -> mastery [0,1]"""
    model_config = {"protected_namespaces": ()}
    states: Dict[str, float]  # {"skill_0": 0.8, "skill_1": 0.3, ...}


class CorrectResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    corrected: Dict[str, float]
    changes: Dict[str, float]  # 修正幅度
    violation_count: int


class EvaluateResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    lvr: float  # 违反先修约束的步骤占比
    vs: float   # 违反的平均幅度
    is_consistent: bool  # 是否整体一致 (lvr < 0.01)


class LearningPathRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    states: Dict[str, float]
    top_k: int = 5


class SkillInfo(BaseModel):
    model_config = {"protected_namespaces": ()}
    id: str
    name: str
    index: int


class DependencyEdge(BaseModel):
    model_config = {"protected_namespaces": ()}
    source: str  # 先修技能
    target: str  # 后继技能


class SkillGraphResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    skills: List[SkillInfo]
    edges: List[DependencyEdge]
    total_skills: int
    total_edges: int


class PrerequisiteRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    skill_id: str


class PrerequisiteResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    skill: SkillInfo
    prerequisites: List[SkillInfo]
    dependents: List[SkillInfo]  # 依赖此技能的后继技能


class HealthResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    status: str
    skills_count: int
    model_loaded: bool
