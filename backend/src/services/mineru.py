"""MinerU 扫描件解析服务（适配 mineru 3.4.5 内置 API）。

- 懒拉起 mineru-api 子进程（.venv/Scripts/mineru-api.exe）
- POST /file_parse 提交（multipart + 表单字段），同步等待解析结果
- 响应 results[{文件名}] → md_content + images(dataURI)
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
from typing import Optional

from ..core.errors import AppError

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent

DEFAULT_MINERU_PORT = 49683
MINERU_HOST = "127.0.0.1"


def _mineru_api_exe() -> str:
    """定位 mineru-api 可执行文件（优先 venv/bin，其次系统 PATH）。"""
    venv_bin = Path(sys.executable).parent / "mineru-api.exe"
    if venv_bin.is_file():
        return str(venv_bin)
    return "mineru-api"


def _is_mineru_up(port: int) -> bool:
    try:
        with socket.create_connection((MINERU_HOST, port), timeout=2):
            return True
    except Exception:
        return False


class MineruService:
    """MinerU 解析服务。"""

    def ensure_mineru_api(self, port: int = DEFAULT_MINERU_PORT, timeout: int = 300) -> bool:
        """确保 mineru-api 已启动（懒拉起），返回是否就绪。"""
        if _is_mineru_up(port):
            return True

        exe = _mineru_api_exe()
        cmd = [exe, "--host", MINERU_HOST, "--port", str(port)]
        env = dict(os.environ)
        logger.info("拉起 mineru-api: %s", " ".join(cmd))
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
            if _is_mineru_up(port):
                return True
            time.sleep(2)
        return False

    def parse_pdf(
        self,
        content: bytes,
        port: int = DEFAULT_MINERU_PORT,
        *,
        lang: str = "ch",
        formula_enable: bool = True,
    ) -> dict:
        """提交 PDF 到 MinerU 同步解析，返回 {total_pages, page_mds, images}。"""
        up = self.ensure_mineru_api(port)
        if not up:
            raise AppError("MinerU 服务启动失败，请检查 mineru-api 是否可运行")

        base = f"http://{MINERU_HOST}:{port}"
        import uuid

        filename = f"doc_{uuid.uuid4().hex[:8]}.pdf"

        # multipart: file 字段 + 表单选项
        boundary = "----zhishi" + uuid.uuid4().hex[:8]

        def field(name: str, value: str) -> bytes:
            return (
                f"--{boundary}\r\n".encode()
                + f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
                + value.encode()
                + b"\r\n"
            )

        body = b"".join(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'.encode(),
                b"Content-Type: application/pdf\r\n\r\n",
                content,
                b"\r\n",
                field("lang_list", lang),
                field("formula_enable", "true" if formula_enable else "false"),
                field("return_md", "true"),
                field("return_images", "true"),
                field("return_content_list", "true"),
                field("backend", "pipeline"),
                field("parse_method", "auto"),
                f"--{boundary}--\r\n".encode(),
            ]
        )

        req = urllib.request.Request(f"{base}/file_parse", method="POST")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

        logger.info("MinerU 提交解析: %s", filename)
        try:
            with urllib.request.urlopen(req, data=body, timeout=1800) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:500]
            raise AppError(f"MinerU 解析失败（HTTP {e.code}）: {detail}") from e
        except Exception as e:
            raise AppError(f"MinerU 请求失败: {e}") from e

        # 解析响应 results[{文件名}]
        results = payload.get("results") or {}
        file_results = next(iter(results.values()), {}) if results else {}

        md_text = file_results.get("md_content") or ""
        images: dict[str, bytes] = {}
        for name, data_uri in (file_results.get("images") or {}).items():
            if isinstance(data_uri, str) and "," in data_uri:
                import base64

                try:
                    images[name] = base64.b64decode(data_uri.split(",", 1)[1])
                except Exception:
                    pass

        if not md_text.strip():
            raise AppError(f"MinerU 解析完成但未产出内容: {payload.get('status')}")

        content_list = file_results.get("content_list")
        if isinstance(content_list, str):
            try:
                content_list = json.loads(content_list)
            except Exception:
                content_list = None
        page_mds = self._pages_from_content_list(content_list)
        if not page_mds:
            page_mds = self._split_pages(md_text)
        return {
            "total_pages": len(page_mds),
            "page_mds": page_mds,
            "images": images,
        }

    def _pages_from_content_list(self, content_list) -> list[dict]:
        """用 MinerU content_list 按 page_idx 拆页。"""
        if not isinstance(content_list, list) or not content_list:
            return []
        from collections import defaultdict

        def block_text(item: dict) -> str:
            for key in ("text", "md", "content"):
                val = item.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip()
            img = item.get("img_path") or item.get("image_path")
            if img:
                return f"![]({Path(str(img)).name})"
            return ""

        # v2: 外层按页
        if isinstance(content_list[0], list):
            pages = []
            for i, blocks in enumerate(content_list, 1):
                parts = [block_text(b) for b in blocks if isinstance(b, dict)]
                pages.append({"page": i, "markdown": "\n\n".join(p for p in parts if p)})
            return pages

        buckets: dict[int, list[str]] = defaultdict(list)
        for item in content_list:
            if not isinstance(item, dict):
                continue
            idx = item.get("page_idx", item.get("page_no", item.get("page")))
            if idx is None:
                continue
            text = block_text(item)
            if text:
                buckets[int(idx)].append(text)
        if not buckets:
            return []
        return [{"page": i + 1, "markdown": "\n\n".join(buckets[i])} for i in sorted(buckets)]

    def _split_pages(self, md_text: str) -> list[dict]:
        """按页码标题把整份 md 拆成逐页。"""
        import re

        # 必须带「第 N 页」或 Page N，避免把「## 26 版…」误当成页码
        pat = re.compile(r"(?mi)^#{1,3}\s*(?:第\s*(\d+)\s*页|page\s+(\d+))\s*$")
        matches = list(pat.finditer(md_text))
        if not matches:
            return [{"page": 1, "markdown": md_text}]
        page_mds: list[dict] = []
        for i, m in enumerate(matches):
            page_no = int(m.group(1) or m.group(2))
            start = m.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(md_text)
            page_mds.append({"page": page_no, "markdown": md_text[start:end].strip()})
        return page_mds or [{"page": 1, "markdown": md_text}]


# 模块级单例
mineru_service = MineruService()
