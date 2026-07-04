"""OCR GPU 检测与设备解析。"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

_GPU_ID_RE = re.compile(r"gpu:(\d+)", re.IGNORECASE)


def is_paddle_cuda_available() -> bool:
    """PaddlePaddle 是否编译 CUDA 且可见 GPU。"""
    try:
        import paddle

        if not paddle.is_compiled_with_cuda():
            return False
        return int(paddle.device.cuda.device_count()) > 0
    except Exception:
        return False


def parse_gpu_id(device: str) -> int:
    """从 ocr_device（如 gpu:0）解析 GPU 序号。"""
    match = _GPU_ID_RE.match((device or "").strip())
    if match:
        return int(match.group(1))
    return 0


def resolve_ocr_device(use_gpu: bool, device: str) -> tuple[str, bool]:
    """
    解析实际运行设备。

    Returns:
        (device_str, gpu_active): device_str 为 "gpu:N" 或 "cpu"
    """
    if not use_gpu:
        return "cpu", False

    dev = (device or "gpu:0").strip().lower()
    if dev == "cpu":
        return "cpu", False

    if is_paddle_cuda_available():
        if not dev.startswith("gpu"):
            dev = f"gpu:{parse_gpu_id(dev)}"
        logger.info("OCR GPU 可用，使用设备 %s", dev)
        return dev, True

    logger.warning(
        "ocr_use_gpu=true 但未检测到 Paddle CUDA（请安装 paddlepaddle-gpu），回退 CPU"
    )
    return "cpu", False
