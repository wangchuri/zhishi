"""
首页智能建议 — 根据知识库文档生成个性化建议
"""
import logging

from fastapi import APIRouter, Depends

from app.api.deps import get_current_active_user
from app.core.config import is_local_rag
from app.services.dify_kb import DifyKB
from app.services.prompt_service import load_prompt, render_prompt
from app.utils.tina_loader import tina_env_path
from tina.llm import BaseAPI

logger = logging.getLogger(__name__)

router = APIRouter(tags=["首页建议"])

SYSTEM_PROMPT = load_prompt("dashboard/suggestions_system.md.j2")

_FALLBACK = [
    "查看知识库中的文档",
    "尝试向 Tina 提问相关问题",
    "上传更多相关资料丰富知识库",
]


def _parse_suggestions(content: str) -> list[str]:
    suggestions = [
        line.strip()[2:]
        for line in content.split("\n")
        if line.strip().startswith("- ")
    ]
    return suggestions[:3] if suggestions else _FALLBACK.copy()


@router.get("/suggestions")
async def get_dashboard_suggestions(
    current_user: dict = Depends(get_current_active_user),
):
    """
    根据用户知识库文档生成个性化建议

    流程：
        1. 获取用户知识库文档列表
        2. 提取文档名称和上传日期
        3. 构建提示词，调用 LLM 生成建议
    """
    dataset_id = current_user.get("dataset_id")

    if not dataset_id and not is_local_rag():
        return {
            "suggestions": ["上传你的第一份文档，开启智能学习", "完善学习画像，获得精准推荐"]
        }

    docs: list = []
    if dataset_id and not is_local_rag():
        try:
            kb = DifyKB(dataset_id)
            result = kb.list_documents(page=1, limit=20)
            docs = result.get("data", [])
        except Exception as e:
            logger.warning(f"获取文档列表失败: {e}")

    if not docs:
        return {
            "suggestions": ["上传你的第一份文档，开启智能学习", "完善学习画像，获得精准推荐"]
        }

    doc_lines = []
    for doc in docs[:10]:
        name = doc.get("name", "未命名文档")
        created = doc.get("created_at", "")
        created = created[:10] if created else "未知时间"
        doc_lines.append(f"- {name}（{created}）")

    user_prompt = render_prompt(
        "dashboard/suggestions_user.md.j2",
        variables={"doc_lines": doc_lines},
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    try:
        llm = BaseAPI(env_path=tina_env_path())
        response = await llm.apredict_no_stream(
            messages=messages, temperature=0.7, max_tokens=300
        )
        content = response.get("content", "")
        return {"suggestions": _parse_suggestions(content)}
    except Exception as e:
        logger.error(f"生成建议失败: {e}")
        return {"suggestions": _FALLBACK.copy()}
