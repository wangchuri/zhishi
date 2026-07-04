"""
OCR 服务 — 图片转文本（本地 PaddleOCR / RapidOCR / 百度云端）

使用方式：
    from app.services.ocr_service import extract_text_from_image
    text = extract_text_from_image(image_path)

后端选择（config.OCR_BACKEND）：
    paddle / local — PaddleOCR（PP-OCRv5，支持 GPU）
    rapidocr       — RapidOCR（可选 Paddle GPU 或 ONNX CPU）
    baidu          — 百度 OCR（凭据见 BAIDU_OCR_* 或 baidu_ocr.json）
    auto           — 先本地引擎，失败再百度
"""
from app.core import paddle_env  # noqa: F401
import base64
import logging
import time
from pathlib import Path
from typing import Optional

import httpx

from app.core.config import (
    BAIDU_OCR_API_KEY,
    BAIDU_OCR_SECRET_KEY,
    BAIDU_OCR_API_URL,
    OCR_BACKEND,
)
from app.services.ocr_backends.registry import (
    create_local_engine,
    get_local_engine,
    is_local_backend,
)

logger = logging.getLogger(__name__)

# Token 缓存（全局单例）
_cached_token: Optional[str] = None
_cached_token_expiry: float = 0.0


def is_paddle_ocr_available() -> bool:
    """PaddleOCR 是否已安装（兼容旧调用方）。"""
    try:
        import paddleocr  # noqa: F401
        return True
    except ImportError:
        return False


def _resolve_local_engine():
    engine = get_local_engine()
    if engine is not None:
        return engine
    if OCR_BACKEND == "auto":
        return create_local_engine("paddle")
    return None


def is_local_ocr_available() -> bool:
    """当前配置的本地 OCR 引擎是否已安装。"""
    engine = _resolve_local_engine()
    return engine is not None and engine.is_available()


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


def is_baidu_ocr_configured() -> bool:
    """百度 OCR 凭据是否已配置。"""
    return bool(BAIDU_OCR_API_KEY and BAIDU_OCR_SECRET_KEY)


def _call_baidu_ocr_api(image_base64: str) -> Optional[str]:
    """调用百度 OCR API，返回文本；失败返回 None，空页返回 ''。"""
    token = _get_access_token()
    if not token:
        return None

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

    if "error_code" in data and data["error_code"] != 0:
        logger.error(
            f"ocr_service: OCR 返回错误: {data.get('error_code')} - {data.get('error_msg')}"
        )
        if data["error_code"] in (110, 111):
            global _cached_token, _cached_token_expiry
            _cached_token = None
            _cached_token_expiry = 0.0
        return None

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
    return text if text else ""


def _extract_text_baidu_bytes(image_bytes: bytes) -> Optional[str]:
    """百度 OCR 识别图片字节。"""
    if not is_baidu_ocr_configured():
        logger.error("ocr_service: 百度 OCR 凭据未配置")
        return None

    try:
        image_base64 = base64.b64encode(image_bytes).decode("ascii")
    except Exception as e:
        logger.error(f"ocr_service: 图片编码失败: {e}")
        return None

    return _call_baidu_ocr_api(image_base64)


def _ocr_with_local_engine(image_bytes: bytes) -> Optional[str]:
    """本地 OCR 引擎识别。"""
    engine = _resolve_local_engine()
    if engine is None:
        return None
    if not engine.is_available():
        return None
    return engine.recognize(image_bytes)


def extract_text_from_image_bytes(image_bytes: bytes) -> Optional[str]:
    """
    对图片字节执行 OCR，返回提取的纯文本。

    Returns:
        str: 识别文本（可为空字符串）
        None: 引擎未配置/未安装或 API 失败
    """
    backend = OCR_BACKEND

    if is_local_backend(backend):
        return _ocr_with_local_engine(image_bytes)

    if backend == "baidu":
        return _extract_text_baidu_bytes(image_bytes)

    # auto: 先本地再百度
    local_text = _ocr_with_local_engine(image_bytes)
    if local_text is not None:
        return local_text
    return _extract_text_baidu_bytes(image_bytes)


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

    try:
        with open(image_path, "rb") as f:
            image_bytes = f.read()
    except Exception as e:
        logger.error(f"ocr_service: 读取图片失败: {e}")
        return None

    return extract_text_from_image_bytes(image_bytes)


def _local_engine_install_hint() -> str:
    if OCR_BACKEND == "rapidocr":
        return "RapidOCR 未安装，请运行: pip install rapidocr onnxruntime"
    return "PaddleOCR 未安装，请运行: pip install paddleocr paddlepaddle-gpu"


def ocr_unavailable_message() -> str:
    """根据 OCR_BACKEND 返回未配置/未安装时的提示。"""
    if is_local_backend(OCR_BACKEND):
        if not is_local_ocr_available():
            return _local_engine_install_hint()
        return f"{OCR_BACKEND} OCR 识别失败"

    if OCR_BACKEND == "baidu":
        if not is_baidu_ocr_configured():
            return (
                "百度 OCR 未配置：请设置 BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY，"
                "或在 zhishi_app/assets/config/baidu_ocr.json 中填写凭据"
            )
        return "百度 OCR 调用失败，请检查凭据与网络"

    # auto
    if not is_local_ocr_available() and not is_baidu_ocr_configured():
        return (
            "OCR 未配置：请安装 paddleocr / rapidocr，"
            "或配置百度 OCR 凭据"
        )
    return "OCR 识别失败，请检查本地 OCR 或百度 OCR 配置"
