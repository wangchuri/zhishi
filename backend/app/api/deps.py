from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import SessionLocal

# --- Dependency Injection ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user():
    """
    去鉴权改造：不再校验 token / Redis 会话。
    始终返回本地默认用户（由 init_db 保证存在）。
    """
    from app.services.bootstrap_service import get_or_create_default_user
    with SessionLocal() as db:
        return get_or_create_default_user(db)

def get_current_active_user(current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_active", True): # Default to True if missing, or handle strictly
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user
