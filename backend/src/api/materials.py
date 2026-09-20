"""题目材料 API：列表 / 检索 / 详情（笔记侧栏、材料复用）。"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..services.question import _material_out, question_service

router = APIRouter(prefix="/api/v1/materials", tags=["materials"])


@router.get("")
def list_materials(
    document_id: Optional[str] = None,
    keyword: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    return {
        "materials": question_service.list_materials(
            db, document_id=document_id, keyword=keyword, limit=limit
        )
    }


@router.get("/{material_id}")
def get_material(material_id: str, db: Session = Depends(get_db)):
    m = question_service.get_material(db, material_id)
    if not m:
        raise HTTPException(status_code=404, detail="材料不存在")
    return _material_out(m)
