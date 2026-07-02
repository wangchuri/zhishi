"""
LEKT API 封装层 — 单例模式

核心文件：
  lekt_api.cp314-win_amd64.pyd  主 API（LEKTAPI 类）
  logic_matrix.npy              先修关系矩阵 (N×N, float32)

要求：Python 3.14 + Windows x86_64
"""

import numpy as np
from pathlib import Path
from typing import Optional


class LEKTService:
    """LEKT/LADL 算法单例服务"""

    _instance: Optional["LEKTService"] = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(
        self,
        matrix_path: str = "logic_matrix.npy",
        epsilon: float = 0.05,
        lambda_logic: float = 0.1,
        beta: float = 1.0,
        skill_names: Optional[dict] = None,
    ):
        if hasattr(self, "_initialized") and self._initialized:
            return

        self.matrix_path = Path(matrix_path).resolve()
        self.epsilon = epsilon
        self.lambda_logic = lambda_logic
        self.beta = beta
        self._initialized = True
        self._loaded = False
        self._api = None
        self._matrix: Optional[np.ndarray] = None
        self.num_skills: int = 0

        # 技能名称映射 (index -> name)
        self.skill_names: dict = skill_names or {}

        self._load()

    def _load(self):
        """加载矩阵和 API（延迟加载，方便管理生命周期）"""
        if not self.matrix_path.exists():
            print(f"[LEKTService] 警告: {self.matrix_path} 不存在，将使用空矩阵（无约束）")
            self._matrix = np.zeros((0, 0), dtype=np.float32)
            self.num_skills = 0
        else:
            self._matrix = np.load(self.matrix_path).astype(np.float32)
            self.num_skills = self._matrix.shape[0]
            print(f"[LEKTService] 已加载先修矩阵: {self.num_skills} 个技能, "
                  f"{int(self._matrix.sum())} 条先修边")

        try:
            from lekt_api import LEKTAPI
            self._api = LEKTAPI(
                str(self.matrix_path),
                epsilon=self.epsilon,
                lambda_logic=self.lambda_logic,
                beta=self.beta,
            )
            self._loaded = True
            print("[LEKTService] LEKTAPI 初始化成功")
        except ImportError as e:
            print(f"[LEKTService] 无法导入 LEKTAPI: {e}")
            self._loaded = False

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    # ─── 辅助转换 ────────────────────────────────────────

    def _dict_to_tensor(self, states: dict[str, float]) -> np.ndarray:
        """将 {skill_id: mastery} 转为 shape (1, 1, N) 的 numpy 数组"""
        if self.num_skills == 0:
            return np.zeros((1, 1, 1), dtype=np.float32)
        arr = np.zeros((1, 1, self.num_skills), dtype=np.float32)
        for skill_id, mastery in states.items():
            idx = self._skill_id_to_idx(skill_id)
            if idx is not None and 0 <= idx < self.num_skills:
                arr[0, 0, idx] = float(mastery)
        return arr

    def _tensor_to_dict(self, tensor: np.ndarray) -> dict[str, float]:
        """将 (1, 1, N) numpy 数组转为 {skill_id: mastery}"""
        arr = tensor.reshape(-1)
        return {self._idx_to_skill_id(i): float(arr[i]) for i in range(len(arr))}

    def _skill_id_to_idx(self, skill_id: str) -> Optional[int]:
        parts = skill_id.replace("skill_", "").split("_")
        try:
            return int(parts[0])
        except (ValueError, IndexError):
            return None

    def _idx_to_skill_id(self, idx: int) -> str:
        return f"skill_{idx}"

    # ─── KT 核心接口 ─────────────────────────────────────

    def correct(self, states: dict[str, float]) -> dict:
        """
        LADL 修正：给定当前认知状态，返回满足先修约束的修正结果
        优先使用 LEKTAPI (.pyd)，回退到纯 NumPy 实现
        """
        if self.num_skills == 0:
            return {"corrected": states, "changes": {k: 0.0 for k in states}, "violation_count": 0}

        if self._loaded:
            result = self._correct_via_pyd(states)
        else:
            result = self._correct_fallback(states)
        return result

    def _correct_via_pyd(self, states: dict[str, float]) -> dict:
        """通过 .pyd LEKTAPI 修正"""
        tensor = self._dict_to_tensor(states)
        import torch
        with torch.no_grad():
            corrected_tensor = self._api.correct(torch.from_numpy(tensor))
        corrected_tensor = corrected_tensor.numpy()
        corrected = self._tensor_to_dict(corrected_tensor)
        original = self._tensor_to_dict(tensor)
        return self._build_correct_result(states, corrected)

    def _correct_fallback(self, states: dict[str, float]) -> dict:
        """纯 NumPy 回退修正：确保每个先修 >= 后继 - epsilon"""
        eps = self.epsilon
        arr = np.array([
            states.get(self._idx_to_skill_id(i), 0.0)
            for i in range(self.num_skills)
        ], dtype=np.float32)
        result = arr.copy()
        for i in range(self.num_skills):
            for j in range(self.num_skills):
                if self._matrix[i, j] > 0:
                    if result[i] < result[j] - eps:
                        avg = (result[i] + result[j]) / 2.0
                        result[i] = max(result[i], avg)
                        result[j] = min(result[j], avg)
        corrected = {
            self._idx_to_skill_id(i): float(min(1.0, max(0.0, result[i])))
            for i in range(self.num_skills)
        }
        return self._build_correct_result(states, corrected)

    def _build_correct_result(self, original_states: dict, corrected: dict) -> dict:
        changes = {}
        for k in set(list(corrected.keys()) + list(original_states.keys())):
            changes[k] = round(corrected.get(k, 0.0) - original_states.get(k, 0.0), 4)
        violation_count = 0
        for i in range(self.num_skills):
            for j in range(self.num_skills):
                if self._matrix[i, j] > 0:
                    orig_i = original_states.get(self._idx_to_skill_id(i), 0)
                    orig_j = original_states.get(self._idx_to_skill_id(j), 0)
                    if orig_i < orig_j - self.epsilon:
                        violation_count += 1
        return {"corrected": corrected, "changes": changes, "violation_count": violation_count}

    def evaluate(self, states: dict[str, float]) -> dict:
        """
        评估认知状态的先修约束满足情况
        返回 lvr (违反占比) 和 vs (平均幅度)
        """
        if self.num_skills == 0:
            return {"lvr": 0.0, "vs": 0.0, "is_consistent": True}

        if self._loaded:
            tensor = self._dict_to_tensor(states)
            import torch
            result = self._api.evaluate(torch.from_numpy(tensor))
            lvr = float(result.get("lvr", 0))
            vs = float(result.get("vs", 0))
        else:
            lvr, vs = self._evaluate_fallback(states)
        return {"lvr": round(lvr, 6), "vs": round(vs, 6), "is_consistent": lvr < 0.01}

    def _evaluate_fallback(self, states: dict[str, float]) -> tuple:
        """纯 NumPy 回退评估"""
        eps = self.epsilon
        violations = 0
        total_violation = 0.0
        edge_count = 0
        for i in range(self.num_skills):
            for j in range(self.num_skills):
                if self._matrix[i, j] > 0:
                    edge_count += 1
                    si = states.get(self._idx_to_skill_id(i), 0)
                    sj = states.get(self._idx_to_skill_id(j), 0)
                    if si < sj - eps:
                        violations += 1
                        total_violation += sj - si
        lvr = violations / edge_count if edge_count > 0 else 0.0
        vs = total_violation / edge_count if edge_count > 0 else 0.0
        return lvr, vs

    def recommend_learning_path(self, states: dict[str, float], top_k: int = 5) -> list:
        """
        推荐学习路径：基于当前掌握度和先修关系推荐下一步应学技能
        策略：
          1. 找出所有"先修已满足但自身未掌握"的技能
          2. 优先推荐"被更多后续技能依赖"的基础技能
        """
        if self.num_skills == 0:
            return []

        matrix = self._matrix
        candidates = []

        for skill_j in range(self.num_skills):
            mastery_j = states.get(self._idx_to_skill_id(skill_j), 0)
            if mastery_j >= 0.8:
                continue  # 已掌握，跳过

            # 检查先修是否都满足
            prereqs_ok = True
            missing_prereqs = []
            for skill_i in range(self.num_skills):
                if matrix[skill_i, skill_j] == 1:
                    mastery_i = states.get(self._idx_to_skill_id(skill_i), 0)
                    if mastery_i < 0.6:
                        prereqs_ok = False
                        missing_prereqs.append(self._idx_to_skill_id(skill_i))

            if not prereqs_ok:
                # 先推荐缺失的先修技能
                continue

            # 计算该技能的重要性（作为多少技能的先修）
            importance = int(matrix[skill_j].sum())

            candidates.append({
                "skill_id": self._idx_to_skill_id(skill_j),
                "skill_name": self.skill_names.get(skill_j, self._idx_to_skill_id(skill_j)),
                "current_mastery": round(mastery_j, 3),
                "importance": importance,
                "priority_score": importance + (1 - mastery_j),  # 越基础 + 越薄弱 = 越优先
            })

        candidates.sort(key=lambda x: x["priority_score"], reverse=True)
        return candidates[:top_k]

    def get_prerequisites(self, skill_id: str) -> dict:
        """查询指定技能的先修关系和后续依赖"""
        idx = self._skill_id_to_idx(skill_id)
        if idx is None or idx >= self.num_skills:
            return {"skill": None, "prerequisites": [], "dependents": []}

        matrix = self._matrix
        prereqs = []
        for i in range(self.num_skills):
            if matrix[i, idx] == 1:
                prereqs.append({
                    "id": self._idx_to_skill_id(i),
                    "name": self.skill_names.get(i, self._idx_to_skill_id(i)),
                })

        dependents = []
        for j in range(self.num_skills):
            if matrix[idx, j] == 1:
                dependents.append({
                    "id": self._idx_to_skill_id(j),
                    "name": self.skill_names.get(j, self._idx_to_skill_id(j)),
                })

        return {
            "skill": {
                "id": skill_id,
                "name": self.skill_names.get(idx, skill_id),
                "index": idx,
            },
            "prerequisites": prereqs,
            "dependents": dependents,
        }

    def get_dependency_graph(self) -> dict:
        """获取完整依赖图数据"""
        matrix = self._matrix
        skills = []
        for i in range(self.num_skills):
            skills.append({
                "id": self._idx_to_skill_id(i),
                "name": self.skill_names.get(i, self._idx_to_skill_id(i)),
                "index": i,
            })

        edges = []
        for i in range(self.num_skills):
            for j in range(self.num_skills):
                if matrix[i, j] == 1:
                    edges.append({"source": self._idx_to_skill_id(i), "target": self._idx_to_skill_id(j)})

        return {"skills": skills, "edges": edges, "total_skills": self.num_skills, "total_edges": len(edges)}
