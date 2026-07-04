"""OCR 输入图像工具。"""
from __future__ import annotations

import io
from typing import Any


def bytes_to_bgr_ndarray(image_bytes: bytes) -> Any:
    """PNG/JPEG 字节 → OpenCV BGR ndarray；失败时抛出异常。"""
    import cv2
    import numpy as np

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("无法解码图片字节")
    return img


def bytes_to_pil(image_bytes: bytes):
    """PNG/JPEG 字节 → PIL Image。"""
    from PIL import Image

    return Image.open(io.BytesIO(image_bytes)).convert("RGB")
