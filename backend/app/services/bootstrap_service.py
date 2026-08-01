"""
启动引导服务 — 去鉴权模式下创建默认本地用户与默认知识库分区
"""
import logging

from sqlalchemy.orm import Session

from app.models import User, PlanTier
from app.core.security import get_password_hash
from app.crud.kb import seed_default_collections

logger = logging.getLogger(__name__)

# 本地模式固定用户（不改验证权限，仅提供匿名本地使用）
DEFAULT_USER_EMAIL = "local@zhishi.local"
DEFAULT_USER_PASSWORD = "local-zhishi"
DEFAULT_USER_NICKNAME = "本地学习者"


def get_or_create_default_user(db: Session) -> dict:
    """
    确保默认用户存在，返回兼容 current_user 结构的 dict。
    服务启动或依赖注入时调用，幂等。
    """
    user = db.query(User).filter(User.email == DEFAULT_USER_EMAIL).first()
    if not user:
        user = User(
            email=DEFAULT_USER_EMAIL,
            password_hash=get_password_hash(DEFAULT_USER_PASSWORD),
            username="local",
            nickname=DEFAULT_USER_NICKNAME,
            is_active=True,
            plan_level=0,
            is_email_verified=False,
        )
        db.add(user)
        db.flush()
        logger.info("已创建本地默认用户: %s", DEFAULT_USER_EMAIL)

        # 创建默认知识库分区（学习区 / 生活区）
        try:
            seed_default_collections(db, user.id, user.dataset_id)
            db.flush()
        except Exception as e:
            logger.warning("默认知识库分区创建失败（不影响使用）: %s", e)

        db.commit()
        db.refresh(user)

    return {
        "user_id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "username": user.username,
        "level": user.plan_level,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "dataset_id": user.dataset_id,
        "api_limit_daily": user.api_limit_daily,
        "token_limit_monthly": user.token_limit_monthly,
        "knowledge_base_limit": user.knowledge_base_limit,
        "model_access": user.model_access,
        "concurrent_limit": user.concurrent_limit,
    }


def bootstrap_default_user(db: Session) -> dict:
    """
    服务启动时调用：确保默认用户与默认分区存在。
    """
    return get_or_create_default_user(db)