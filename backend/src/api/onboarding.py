"""引导 API：档案 + 引导会话。对话本身走 POST /api/v1/chat。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..schemas.task import ProfileOut, ProfileUpdate
from ..services.onboarding import onboarding_service
from ..services.profile import profile_out, update_profile

router = APIRouter(prefix="/api/v1", tags=["onboarding"])


@router.get("/me/profile", response_model=ProfileOut)
def read_profile(db: Session = Depends(get_db)):
    return profile_out(db)


@router.put("/me/profile", response_model=ProfileOut)
def put_profile(body: ProfileUpdate, db: Session = Depends(get_db)):
    row = update_profile(
        db,
        nickname=body.nickname,
        role=body.role,
        onboarding_status=body.onboarding_status,
    )
    return profile_out(db, row)


@router.get("/onboarding/session")
def onboarding_session(replay: bool = False, db: Session = Depends(get_db)):
    if replay:
        onboarding_service.ensure_session(db, replay=True)
    return onboarding_service.state(db)
