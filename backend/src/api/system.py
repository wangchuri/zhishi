"""系统级配置 API（写回 config.yml）。"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..core.config import config
from ..core.errors import AppError
from ..services.mineru import mineru_service

router = APIRouter(prefix="/api/v1/system", tags=["system"])


class MineruSettingsOut(BaseModel):
    mode: Literal["local", "cloud"]
    api_token: str = ""
    api_base: str = "https://mineru.net"
    model_version: Literal["pipeline", "vlm"] = "vlm"
    pdf_parse_policy: Literal["smart", "all", "scanned_only"] = "smart"
    config_path: str = ""
    # 运行时状态
    installed: bool = False
    available: bool = False
    installing: bool = False
    install_dir: str = ""


class MineruSettingsUpdate(BaseModel):
    mode: Optional[Literal["local", "cloud"]] = None
    api_token: Optional[str] = None
    api_base: Optional[str] = Field(default=None, description="如 https://mineru.net")
    model_version: Optional[Literal["pipeline", "vlm"]] = None
    pdf_parse_policy: Optional[Literal["smart", "all", "scanned_only"]] = None


def _mineru_out() -> MineruSettingsOut:
    data = config.mineru_settings_public()
    data.update(
        installed=mineru_service.is_installed(),
        available=mineru_service.is_ready(),
        installing=mineru_service.install_status()["state"] == "installing",
        install_dir=str(config.mineru_install_dir),
    )
    return MineruSettingsOut(**data)


@router.get("/mineru", response_model=MineruSettingsOut)
def get_mineru_settings() -> MineruSettingsOut:
    return _mineru_out()


@router.post("/mineru/install")
def install_mineru():
    """一键安装 MinerU 到独立环境（后台执行，配 GET /mineru/install/status 看进度）。"""
    return mineru_service.install_mineru()


@router.get("/mineru/install/status")
def mineru_install_status():
    return mineru_service.install_status()


@router.post("/mineru/release")
def mineru_release():
    """立即释放 mineru-api 进程（空闲时会自动释放）。"""
    return {"released": mineru_service.release()}


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
    if "pdf_parse_policy" in data and data["pdf_parse_policy"] is not None:
        updates["pdf_parse_policy"] = data["pdf_parse_policy"]

    if not updates:
        return _mineru_out()

    mode = updates.get("mineru_mode", config.mineru_mode)
    token = updates.get("mineru_api_token", config.mineru_api_token)
    if mode == "cloud" and not token:
        raise AppError("云端模式需要填写 MinerU API Token（在 mineru.net 管理页创建）")

    try:
        config.update_values(updates)
    except OSError as e:
        raise AppError(f"写入配置文件失败: {e}") from e

    return _mineru_out()


# ---- 插件（内置领域插件 + MCP）----


@router.get("/plugins")
def get_plugins() -> dict:
    """插件状态：内置插件的接口/工具/开关，MCP server 的连接情况。"""
    from ..plugins.registry import plugin_registry

    return plugin_registry.status()


class PluginToggle(BaseModel):
    enabled: bool


@router.put("/plugins/{plugin_id}")
def set_plugin_enabled(plugin_id: str, body: PluginToggle) -> dict:
    """开关一个内置插件（写回 config.yml 并重载，不用重启后端）。"""
    from ..plugins.builtin import BUILTIN_PLUGINS
    from ..plugins.registry import plugin_registry

    if plugin_id not in BUILTIN_PLUGINS:
        raise AppError(f"没有这个内置插件：{plugin_id}")

    plugins = dict(config.plugins)
    builtin = dict(plugins.get("builtin") or {})
    builtin[plugin_id] = bool(body.enabled)
    plugins["builtin"] = builtin
    try:
        config.update_values({"plugins": plugins})
    except OSError as e:
        raise AppError(f"写入配置文件失败: {e}") from e

    plugin_registry.reload()
    return plugin_registry.status()


@router.post("/plugins/reload")
def reload_plugins() -> dict:
    """重新读配置并重连（改完 config.yml 不用重启后端）。

    注意：会断开现有 MCP 会话；正在进行的对话不受影响（它们已经拿到工具表）。
    """
    from ..plugins.registry import plugin_registry

    plugin_registry.reload()
    return plugin_registry.status()
