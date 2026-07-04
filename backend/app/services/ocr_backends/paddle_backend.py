"""PaddleOCR 本地引擎（PP-OCRv5，支持 GPU）。"""
from __future__ import annotations

import logging
import threading
from typing import Any, Optional

from app.services.ocr_backends.gpu_utils import resolve_ocr_device
from app.services.ocr_backends.image_utils import bytes_to_bgr_ndarray

logger = logging.getLogger(__name__)

_engine: Any = None
_engine_lock = threading.Lock()
_recognize_lock = threading.Lock()
_runtime_device = "cpu"
_runtime_gpu = False


def _paddle_model_kwargs(model_tier: str) -> dict[str, str]:
    tier = (model_tier or "server").strip().lower()
    if tier == "mobile":
        return {
            "text_detection_model_name": "PP-OCRv5_mobile_det",
            "text_recognition_model_name": "PP-OCRv5_mobile_rec",
        }
    return {
        "text_detection_model_name": "PP-OCRv5_server_det",
        "text_recognition_model_name": "PP-OCRv5_server_rec",
    }


def _build_paddle_ocr(device: str, model_tier: str):
    from paddleocr import PaddleOCR

    base_kwargs: dict[str, Any] = {
        "lang": "ch",
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": True,
        "enable_mkldnn": False,
        "device": device,
    }
    base_kwargs.update(_paddle_model_kwargs(model_tier))

    try:
        return PaddleOCR(**base_kwargs)
    except TypeError:
        # 旧版 paddleocr 可能不支持 PP-OCRv5 模型名或 device 参数
        fallback: dict[str, Any] = {
            "lang": "ch",
            "use_textline_orientation": True,
            "enable_mkldnn": False,
        }
        gpu_id = 0
        if device.startswith("gpu"):
            try:
                gpu_id = int(device.split(":", 1)[1])
            except (IndexError, ValueError):
                gpu_id = 0
            fallback["device"] = device
        try:
            return PaddleOCR(**fallback)
        except TypeError:
            if device.startswith("gpu"):
                fallback.pop("device", None)
                fallback["use_gpu"] = True
                fallback["gpu_id"] = gpu_id
            return PaddleOCR(**fallback)


def _parse_paddle_result(result) -> str:
    if not result:
        return ""

    lines: list[str] = []
    for item in result:
        rec_texts = None
        if hasattr(item, "get"):
            rec_texts = item.get("rec_texts")
        elif isinstance(item, dict):
            rec_texts = item.get("rec_texts")
        if rec_texts:
            lines.extend(str(t) for t in rec_texts if t)
            continue

        if isinstance(item, (list, tuple)):
            for line in item:
                if line and len(line) >= 2 and line[1] and line[1][0]:
                    lines.append(str(line[1][0]))

    return "\n".join(lines)


def _get_engine(use_gpu: bool, device: str, model_tier: str):
    global _engine, _runtime_device, _runtime_gpu

    resolved, gpu_active = resolve_ocr_device(use_gpu, device)
    with _engine_lock:
        if _engine is not None and _runtime_device == resolved:
            return _engine

        if _engine is not None:
            logger.info(
                "PaddleOCR 设备变更 %s → %s，重新初始化",
                _runtime_device,
                resolved,
            )

        try:
            from paddleocr import PaddleOCR  # noqa: F401
        except ImportError:
            return None

        try:
            engine = _build_paddle_ocr(resolved, model_tier)
        except Exception as exc:
            if gpu_active:
                logger.warning(
                    "PaddleOCR GPU 初始化失败 (%s)，回退 CPU", exc, exc_info=True
                )
                resolved, gpu_active = "cpu", False
                engine = _build_paddle_ocr(resolved, model_tier)
            else:
                raise

        _engine = engine
        _runtime_device = resolved
        _runtime_gpu = gpu_active
        logger.info(
            "PaddleOCR 已就绪: device=%s, model=%s, gpu=%s",
            resolved,
            model_tier,
            gpu_active,
        )
        return _engine


class PaddleOcrBackend:
    name = "paddle"

    def __init__(self, use_gpu: bool, device: str, model_tier: str) -> None:
        self._use_gpu = use_gpu
        self._device = device
        self._model_tier = model_tier

    @property
    def device_label(self) -> str:
        return _runtime_device

    def is_available(self) -> bool:
        try:
            import paddleocr  # noqa: F401
            return True
        except ImportError:
            return False

    def recognize(self, image_bytes: bytes) -> Optional[str]:
        engine = _get_engine(self._use_gpu, self._device, self._model_tier)
        if engine is None:
            return None

        try:
            img = bytes_to_bgr_ndarray(image_bytes)
        except Exception as exc:
            logger.warning("PaddleOCR 图片解码失败: %s", exc)
            return None

        try:
            with _recognize_lock:
                predict = getattr(engine, "predict", None)
                if callable(predict):
                    result = predict(img)
                else:
                    result = engine.ocr(img)
            return _parse_paddle_result(result)
        except Exception as exc:
            logger.warning("PaddleOCR 识别失败: %s", exc)
            return None
