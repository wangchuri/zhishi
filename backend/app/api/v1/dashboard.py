"""
首页智能建议 — 根据知识库文档生成个性化建议
"""
import logging
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_active_user
from app.services.dify_kb import DifyKB
from app.utils.tina_loader import tina_env_path
from tina.llm import BaseAPI

logger = logging.getLogger(__name__)

router = APIRouter(tags=["首页建议"])

SYSTEM_PROMPT = """你是知拾（Zhishi）的知识管理助手 Tina。请根据用户知识库中的文档列表，生成 2-3 条简洁的个性化学习建议（每条不超过 30 字）。
建议方向：
- 提醒复习某些文档
- 建议整理或补充某个主题
- 推荐ai对话的方向
只输出建议列表，每行一条，以 "- " 开头，不要其他内容。"""


@router.get("/suggestions")
def get_dashboard_suggestions(
    current_user: dict = Depends(get_current_active_user),
):
    """
    根据用户知识库文档生成个性化建议

    流程：
        1. 获取用户知识库文档列表
        2. 提取文档名称和上传日期
        3. 构建提示词，调用 LLM 生成建议
    """
    user_id = current_user["user_id"]
    dataset_id = current_user.get("dataset_id")

    if not dataset_id:
        return {"suggestions": ["上传你的第一份文档，开启智能学习", "完善学习画像，获得精准推荐"]}

    # 获取文档列表
    try:
        kb = DifyKB(dataset_id)
        result = kb.list_documents(page=1, limit=20)
        docs = result.get("data", [])
    except Exception as e:
        logger.warning(f"获取文档列表失败: {e}")
        docs = []

    if not docs:
        return {"suggestions": ["上传你的第一份文档，开启智能学习", "完善学习画像，获得精准推荐"]}

    # 构建提示词
    doc_lines = []
    for doc in docs[:10]:  # 最多取 10 个
        name = doc.get("name", "未命名文档")
        created = doc.get("created_at", "")
        if created:
            created = created[:10]  # 只取日期部分
        else:
            created = "未知时间"
        doc_lines.append(f"- {name}（{created}）")

    user_prompt = "用户知识库中有以下文档：\n" + "\n".join(doc_lines) + "\n\n请根据上述文档给出学习建议。"

    # 调用 LLM
    try:
        llm = BaseAPI(env_path=tina_env_path())
        response = llm.chat(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=300,
        )
        content = response.get("content", "")
        # 解析建议行
        suggestions = [line.strip()[2:] for line in content.split("\n") if line.strip().startswith("- ")]
        if not suggestions:
            suggestions = ["查看知识库中的文档", "尝试向 Tina 提问相关问题", "上传更多相关资料丰富知识库"]
        return {"suggestions": suggestions[:3]}
    except Exception as e:
        logger.error(f"生成建议失败: {e}")
        return {"suggestions": ["查看知识库中的文档", "尝试向 Tina 提问相关问题", "上传更多相关资料丰富知识库"]}