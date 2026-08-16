"""MinerU 扫描件解析服务。

- 懒拉起 mineru-api 子进程（环境变量 MINERU_FORMULA_CH_SUPPORT=true 支持中文公式）
- 提交解析任务后异步轮询进度
- 输出按页 markdown + 图片（images/ 相对路径）
"""

from __future__ import annotations

import json
import logging
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from ..core.errors import AppError

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent

DEFAULT_MINERU_PORT = 49683
MINERU_HOST = "127.0.0.1"

# 高精度中文识别 + 中文公式
_MINERU_ENV = {
    "MINERU_FORMULA_CH_SUPPORT": "true",
    "PDF_PARSE_METHOD": "auto",
    "MINERU_LANG": "ch_server",
}


def _is_mineru_up(port: int) -> bool:
    with socket.create_connection((MINERU_HOST, port), timeout=2):
        return True


def _http_json(method: str, url: str, data: dict | None = None) -> dict:
    req = urllib.request.Request(url, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
        body = json.dumps(data).encode("utf-8")
    else:
        body = None
    with urllib.request.urlopen(req, data=body, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


class MineruService:
    """MinerU 解析服务。"""

    def ensure_mineru_api(self, port: int = DEFAULT_MINERU_PORT, timeout: int = 180) -> bool:
        """确保 mineru-api 已启动（懒拉起），返回是否就绪。"""
        if _is_mineru_up(port):
            return True

        python = sys.executable
        cmd = [python, "-m", "mineru_api.server"]
        env = dict(os.environ)
        env.update(_MINERU_ENV)
        env.setdefault("MINERU_API_PORT", str(port))
        logger.info("拉起 mineru-api: %s", cmd)
        try:
            subprocess.Popen(
                cmd,
                env=env,
                cwd=str(_BACKEND_DIR),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except Exception as e:
            logger.warning("拉起 mineru-api 失败: %s", e)
            return False

        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if _is_mineru_up(port):
                    return True
            except Exception:
                pass
            time.sleep(2)
        return False

    def parse_pdf(self, content: bytes, port: int = DEFAULT_MINERU_PORT) -> dict:
        """提交 PDF 到 MinerU，等待解析完成。

        返回: {total_pages, page_mds: [{page, markdown}], images: {name: bytes}}
        """
        if not self.ensure_mineru_api(port):
            raise AppError("MinerU 服务启动失败，请检查 mineru-api 是否可运行")

        base = f"http://{MINERU_HOST}:{port}"

        import uuid

        filename = f"doc_{uuid.uuid4().hex[:8]}.pdf"
        req = urllib.request.Request(f"{base}/file_parse", method="POST")
        boundary = "----zhishi" + uuid.uuid4().hex[:8]
        body = b"".join(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
                b"Content-Type: application/pdf\r\n\r\n",
                content,
                b"\r\n",
                f"--{boundary}--\r\n".encode(),
            ]
        )
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        with urllib.request.urlopen(req, data=body, timeout=120) as resp:
            submitted = json.loads(resp.read().decode("utf-8"))

        batch_id = submitted.get("batch_id") or submitted.get("task_id")
        if not batch_id:
            raise AppError(f"MinerU 提交失败: {submitted}")

        while True:
            status = _http_json("GET", f"{base}/task_status?batch_id={batch_id}")
            st = status.get("status") or status.get("state")
            if st in ("completed", "done", "success"):
                break
            if st in ("failed", "error"):
                raise AppError(f"MinerU 解析失败: {status}")
            time.sleep(2)

        result = _http_json("GET", f"{base}/get_parse_result?batch_id={batch_id}")
        pages_data = result.get("pages") or result.get("results") or []

        page_mds: list[dict] = []
        images: dict[str, bytes] = {}
        for p in pages_data:
            md = p.get("markdown") or p.get("text") or ""
            page_no = p.get("page") or p.get("page_number") or len(page_mds) + 1
            page_mds.append({"page": int(page_no), "markdown": md})
            for img in p.get("images", []) or []:
                name = img.get("name") or img.get("filename")
                b64 = img.get("data") or img.get("content")
                if name and b64:
                    import base64

                    try:
                        images[name] = base64.b64decode(b64)
                    except Exception:
                        pass

        return {
            "total_pages": len(page_mds),
            "page_mds": page_mds,
            "images": images,
        }


# 模块级单例
mineru_service = MineruService()
