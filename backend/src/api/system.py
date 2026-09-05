"""系统级配置 API（写回 config.yml）。"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..core.config import config
from ..core.errors import AppError

router = APIRouter(prefix="/api/v1/system", tags=["system"])


class MineruSettingsOut(BaseModel):
    mode: Literal["local", "cloud"]
    api_token: str = ""
    api_base: str = "https://mineru.net"
    model_version: Literal["pipeline", "vlm"] = "vlm"
    config_path: str = ""


class MineruSettingsUpdate(BaseModel):
    mode: Optional[Literal["local", "cloud"]] = None
    api_token: Optional[str] = None
    api_base: Optional[str] = Field(default=None, description="如 https://mineru.net")
    model_version: Optional[Literal["pipeline", "vlm"]] = None


@router.get("/mineru", response_model=MineruSettingsOut)
def get_mineru_settings() -> MineruSettingsOut:
    return MineruSettingsOut(**config.mineru_settings_public())


@router.put("/mineru", response_model=MineruSettingsOut)
def put_mineru_settings(body: MineruSettingsUpdate) -> MineruSettingsOut:
    updates: dict = {}
    data = body.model_dump(exclude_unset=True)
    if "mode" in data and data["mode"] is not None:
        updates["mineru_mode"] = data["mode"]
    if "api_token" in data:
        updates["mineru_api_token"] = (data["api_token"] or "").strip()
    if "api_base" in data and data["api_base"] is not None:
        base = str(data["api_base"]).strip().rstrip("/")
        updates["mineru_api_base"] = base or "https://mineru.net"
    if "model_version" in data and data["model_version"] is not None:
        updates["mineru_model_version"] = data["model_version"]

    if not updates:
        return MineruSettingsOut(**config.mineru_settings_public())

    mode = updates.get("mineru_mode", config.mineru_mode)
    token = updates.get("mineru_api_token", config.mineru_api_token)
    if mode == "cloud" and not token:
        raise AppError("云端模式需要填写 MinerU API Token（在 mineru.net 管理页创建）")

    try:
        config.update_values(updates)
    except OSError as e:
        raise AppError(f"写入配置文件失败: {e}") from e

    return MineruSettingsOut(**config.mineru_settings_public())
