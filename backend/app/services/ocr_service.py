"""
百度 OCR 服务 — 图片转文本

使用方式：
    from app.services.ocr_service import extract_text_from_image
    text = extract_text_from_image(image_path)

凭据来源：
    config.py 中 BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY
    从 zhishi_app/assets/config/baidu_ocr.json 读取
"""
import base64
import json
import logging
import time
from pathlib import Path
from typing import Optional

import httpx

from app.core.config import (
    BAIDU_OCR_API_KEY,
    BAIDU_OCR_SECRET_KEY,
    BAIDU_OCR_API_URL,
)

logger = logging.getLogger(__name__)

# Token 缓存（全局单例）
_cached_token: Optional[str] = None
_cached_token_expiry: float = 0.0


def _get_access_token() -> Optional[str]:
    """
    获取百度 OAuth2 access_token（带缓存）

    调用：
        GET https://aip.baidubce.com/oauth/2.0/token
            ?grant_type=client_credentials
            &client_id={api_key}
            &client_secret={secret_key}
    """
    global _cached_token, _cached_token_expiry

    # 缓存未过期，直接返回
    if _cached_token and time.time() < _cached_token_expiry - 60:
        return _cached_token

    if not BAIDU_OCR_API_KEY or not BAIDU_OCR_SECRET_KEY:
        logger.error("ocr_service: 百度 OCR 凭据未配置")
        return None

    url = (
        "https://aip.baidubce.com/oauth/2.0/token"
        f"?grant_type=client_credentials"
        f"&client_id={BAIDU_OCR_API_KEY}"
        f"&client_secret={BAIDU_OCR_SECRET_KEY}"
    )

    try:
        with httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
            resp = client.get(url)
    except httpx.RequestError as e:
        logger.error(f"ocr_service: 获取 access_token 网络请求失败: {e}")
        return None

    if resp.status_code != 200:
        logger.error(f"ocr_service: 获取 access_token 失败 (HTTP {resp.status_code}): {resp.text}")
        return None

    data = resp.json()
    if "error" in data:
        logger.error(f"ocr_service: 获取 access_token 失败: {data.get('error')} - {data.get('error_description')}")
        return None

    _cached_token = data.get("access_token")
    expires_in = data.get("expires_in", 2592000)  # 默认 30 天
    _cached_token_expiry = time.time() + expires_in
    logger.info(f"ocr_service: access_token 已获取，有效期 {expires_in}s")
    return _cached_token


def extract_text_from_image(image_path: str) -> Optional[str]:
    """
    对图片执行 OCR 识别，返回提取的纯文本

    Args:
        image_path: 本地图片路径

    Returns:
        str or None: 识别出的文本，失败返回 None
    """
    path_obj = Path(image_path)
    if not path_obj.exists():
        logger.error(f"ocr_service: 图片文件不存在: {image_path}")
        return None

    # 获取 token
    token = _get_access_token()
    if not token:
        return None

    # 读取图片并 base64 编码
    try:
        with open(image_path, "rb") as f:
            image_bytes = f.read()
        image_base64 = base64.b64encode(image_bytes).decode("ascii")
    except Exception as e:
        logger.error(f"ocr_service: 读取图片失败: {e}")
        return None

    # 调用 OCR API
    url = f"{BAIDU_OCR_API_URL}?access_token={token}"

    try:
        with httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            resp = client.post(
                url,
                data={"image": image_base64},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except httpx.RequestError as e:
        logger.error(f"ocr_service: OCR 请求失败: {e}")
        return None

    if resp.status_code != 200:
        logger.error(f"ocr_service: OCR 请求失败 (HTTP {resp.status_code}): {resp.text}")
        return None

    data = resp.json()

    # 检查错误
    if "error_code" in data and data["error_code"] != 0:
        logger.error(f"ocr_service: OCR 返回错误: {data.get('error_code')} - {data.get('error_msg')}")
        # token 过期时清除缓存
        if data["error_code"] in (110, 111):
            global _cached_token, _cached_token_expiry
            _cached_token = None
            _cached_token_expiry = 0.0
        return None

    # 提取文本
    words_result = data.get("words_result", [])
    if not words_result:
        logger.warning("ocr_service: OCR 返回为空（图片可能不含文字）")
        return ""

    lines = []
    for item in words_result:
        word = item.get("words", "")
        if word:
            lines.append(word)

    text = "\n".join(lines)
    logger.info(f"ocr_service: OCR 完成，{len(lines)} 行，共 {len(text)} 字符")
    return text if text else None