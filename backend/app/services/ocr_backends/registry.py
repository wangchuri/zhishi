"""OCR 本地引擎注册与单例。"""
from __future__ import annotations

import logging
from typing import Optional

from app.core.config import (
    OCR_BACKEND,
    OCR_DEVICE,
    OCR_PADDLE_MODEL,
    OCR_USE_GPU,
)
from app.services.ocr_backends.base import LocalOcrEngine
from app.services.ocr_backends.paddle_backend import PaddleOcrBackend
from app.services.ocr_backends.rapidocr_backend import RapidOcrBackend

logger = logging.getLogger(__name__)

_LOCAL_BACKENDS = frozenset({"paddle", "rapidocr", "local"})
_engine: Optional[LocalOcrEngine] = None


def normalize_local_backend(name: str) -> str:
    """local 为 paddle 的兼容别名。"""
    backend = (name or "paddle").strip().lower()
    if backend == "local":
        return "paddle"
    return backend


def is_local_backend(name: str) -> bool:
    return normalize_local_backend(name) in _LOCAL_BACKENDS


def create_local_engine(backend: str) -> LocalOcrEngine:
    name = normalize_local_backend(backend)
    if name == "rapidocr":
        return RapidOcrBackend(use_gpu=OCR_USE_GPU, device=OCR_DEVICE)
    return PaddleOcrBackend(
        use_gpu=OCR_USE_GPU,
        device=OCR_DEVICE,
        model_tier=OCR_PADDLE_MODEL,
    )


def get_local_engine() -> Optional[LocalOcrEngine]:
    """按 OCR_BACKEND 返回本地引擎单例；非本地后端返回 None。"""
    global _engine

    if not is_local_backend(OCR_BACKEND):
        return None

    if _engine is None:
        _engine = create_local_engine(OCR_BACKEND)
        logger.info(
            "本地 OCR 引擎: %s (use_gpu=%s, device=%s)",
            _engine.name,
            OCR_USE_GPU,
            OCR_DEVICE,
        )
    return _engine


def reset_local_engine() -> None:
    """测试或热重载用。"""
    global _engine
    _engine = None
