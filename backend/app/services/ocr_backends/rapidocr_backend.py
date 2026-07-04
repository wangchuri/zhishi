"""RapidOCR 本地引擎（可选 Paddle GPU / 默认 ONNX CPU）。"""
from __future__ import annotations

import logging
import threading
from typing import Any, Optional

from app.services.ocr_backends.gpu_utils import is_paddle_cuda_available, parse_gpu_id
from app.services.ocr_backends.image_utils import bytes_to_bgr_ndarray

logger = logging.getLogger(__name__)

_engine: Any = None
_engine_lock = threading.Lock()
_recognize_lock = threading.Lock()
_runtime_device = "cpu"
_runtime_gpu = False


def _build_rapidocr(use_gpu: bool, device: str):
    from rapidocr import RapidOCR

    if use_gpu and is_paddle_cuda_available():
        gpu_id = parse_gpu_id(device)
        try:
            from rapidocr import EngineType

            det_engine = EngineType.PADDLE
        except ImportError:
            det_engine = "paddle"

        return RapidOCR(
            params={
                "Det.engine_type": det_engine,
                "Rec.engine_type": det_engine,
                "Cls.engine_type": det_engine,
                "EngineConfig.paddle.use_cuda": True,
                "EngineConfig.paddle.cuda_ep_cfg.device_id": gpu_id,
            }
        )

    logger.info("RapidOCR 使用 ONNX Runtime CPU 推理")
    return RapidOCR()


def _parse_rapidocr_result(result) -> str:
    if not result:
        return ""
    lines: list[str] = []
    for item in result:
        if not item or len(item) < 2:
            continue
        text = item[1]
        if text:
            lines.append(str(text))
    return "\n".join(lines)


def _get_engine(use_gpu: bool, device: str):
    global _engine, _runtime_device, _runtime_gpu

    want_gpu = use_gpu and is_paddle_cuda_available()
    target = f"gpu:{parse_gpu_id(device)}" if want_gpu else "cpu"

    with _engine_lock:
        if _engine is not None and _runtime_device == target:
            return _engine

        try:
            from rapidocr import RapidOCR  # noqa: F401
        except ImportError:
            return None

        try:
            engine = _build_rapidocr(use_gpu, device)
        except Exception as exc:
            if want_gpu:
                logger.warning(
                    "RapidOCR GPU 初始化失败 (%s)，回退 ONNX CPU", exc, exc_info=True
                )
                target = "cpu"
                want_gpu = False
                engine = RapidOCR()
            else:
                raise

        _engine = engine
        _runtime_device = target
        _runtime_gpu = want_gpu
        logger.info("RapidOCR 已就绪: device=%s, gpu=%s", target, want_gpu)
        return _engine


class RapidOcrBackend:
    name = "rapidocr"

    def __init__(self, use_gpu: bool, device: str) -> None:
        self._use_gpu = use_gpu
        self._device = device

    @property
    def device_label(self) -> str:
        return _runtime_device

    def is_available(self) -> bool:
        try:
            import rapidocr  # noqa: F401
            return True
        except ImportError:
            return False

    def recognize(self, image_bytes: bytes) -> Optional[str]:
        engine = _get_engine(self._use_gpu, self._device)
        if engine is None:
            return None

        try:
            img = bytes_to_bgr_ndarray(image_bytes)
        except Exception as exc:
            logger.warning("RapidOCR 图片解码失败: %s", exc)
            return None

        try:
            with _recognize_lock:
                result, _elapse = engine(img)
            return _parse_rapidocr_result(result)
        except Exception as exc:
            logger.warning("RapidOCR 识别失败: %s", exc)
            return None
