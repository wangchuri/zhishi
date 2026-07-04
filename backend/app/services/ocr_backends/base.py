"""本地 OCR 引擎抽象接口。"""
from __future__ import annotations

from typing import Optional, Protocol


class LocalOcrEngine(Protocol):
    """可插拔本地 OCR 引擎。"""

    name: str
    device_label: str

    def is_available(self) -> bool:
        """依赖是否已安装。"""

    def recognize(self, image_bytes: bytes) -> Optional[str]:
        """
        识别图片字节。

        Returns:
            str: 文本（可为空）
            None: 引擎失败
        """
