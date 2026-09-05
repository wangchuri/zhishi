"""MinerU 扫描件解析服务。

支持两种模式（config.yml / 设置页）：
- local：懒拉起本机 mineru-api，POST /file_parse（同步）
- cloud：mineru.net 精准解析 API（申请上传链 → PUT → 轮询 → 下 zip）
"""

from __future__ import annotations

import io
import json
import logging
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Optional

import requests

from ..core.config import config
from ..core.errors import AppError

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent

DEFAULT_MINERU_PORT = 49683
MINERU_HOST = "127.0.0.1"
_CLOUD_POLL_INTERVAL = 3.0
_CLOUD_POLL_TIMEOUT = 1800
_CLOUD_MAX_PAGES = 200
_CLOUD_MAX_BYTES = 200 * 1024 * 1024
_CLOUD_APPLY_RETRIES = 3
_CLOUD_SEGMENT_RETRIES = 3
_CLOUD_DOWNLOAD_RETRIES = 5
_CLOUD_PUT_RETRIES = 3


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
        """提交 PDF 解析，返回 {total_pages, page_mds, images}。"""
        if config.mineru_mode == "cloud":
            return self._parse_pdf_cloud(content, lang=lang, formula_enable=formula_enable)
        return self._parse_pdf_local(
            content, port=port, lang=lang, formula_enable=formula_enable
        )

    def _parse_pdf_local(
        self,
        content: bytes,
        *,
        port: int,
        lang: str,
        formula_enable: bool,
    ) -> dict:
        up = self.ensure_mineru_api(port)
        if not up:
            raise AppError("MinerU 服务启动失败，请检查 mineru-api 是否可运行，或在设置中改用云端")

        base = f"http://{MINERU_HOST}:{port}"
        filename = f"doc_{uuid.uuid4().hex[:8]}.pdf"

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

        logger.info("MinerU 本地解析: %s", filename)
        try:
            with urllib.request.urlopen(req, data=body, timeout=1800) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:500]
            raise AppError(f"MinerU 解析失败（HTTP {e.code}）: {detail}") from e
        except Exception as e:
            raise AppError(f"MinerU 请求失败: {e}") from e

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

    def _parse_pdf_cloud(
        self,
        content: bytes,
        *,
        lang: str,
        formula_enable: bool,
    ) -> dict:
        token = config.mineru_api_token
        if not token:
            raise AppError("云端 MinerU 未配置 Token，请到设置页填写")

        api_base = config.mineru_api_base
        model_version = config.mineru_model_version
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        }

        chunks = self._split_pdf_for_cloud(content)
        if len(chunks) > 1:
            logger.info(
                "MinerU 云端拆分: %s 段（云端限制 ≤%s 页 / ≤%sMB）",
                len(chunks),
                _CLOUD_MAX_PAGES,
                _CLOUD_MAX_BYTES // (1024 * 1024),
            )

        merged_pages: list[dict] = []
        merged_images: dict[str, bytes] = {}

        def run_chunk(idx: int, start_page: int, end_page: int, part_bytes: bytes) -> None:
            last_err: Exception | None = None
            for attempt in range(1, _CLOUD_SEGMENT_RETRIES + 1):
                try:
                    logger.info(
                        "MinerU 云端分段 %s/%s (尝试 %s/%s): 原书第 %s–%s 页，%.1fMB",
                        idx,
                        len(chunks),
                        attempt,
                        _CLOUD_SEGMENT_RETRIES,
                        start_page,
                        end_page,
                        len(part_bytes) / (1024 * 1024),
                    )
                    part = self._cloud_parse_one_file(
                        part_bytes,
                        filename=f"doc_{uuid.uuid4().hex[:8]}_p{start_page}-{end_page}.pdf",
                        api_base=api_base,
                        headers=headers,
                        model_version=model_version,
                        lang=lang,
                        formula_enable=formula_enable,
                    )
                    # 清除该段页码范围旧结果再合并（支持缺页重试）
                    merged_pages[:] = [
                        p
                        for p in merged_pages
                        if not (start_page <= int(p.get("page") or 0) <= end_page)
                    ]
                    # 去掉该段旧图前缀
                    for k in [k for k in merged_images if k.startswith(f"c{idx:02d}_")]:
                        merged_images.pop(k, None)

                    prefix = f"c{idx:02d}_"
                    page_offset = start_page - 1
                    renamed: dict[str, str] = {}
                    for name, data in (part.get("images") or {}).items():
                        new_name = f"{prefix}{Path(name).name}"
                        if new_name in merged_images:
                            new_name = f"{prefix}{uuid.uuid4().hex[:6]}_{Path(name).name}"
                        merged_images[new_name] = data
                        renamed[Path(name).name] = new_name
                        renamed[name] = new_name

                    got: set[int] = set()
                    for pg in part.get("page_mds") or []:
                        local_no = int(pg.get("page") or 1)
                        global_no = page_offset + local_no
                        if global_no < start_page or global_no > end_page:
                            # 防御：仍收入，但缺页检测用区间
                            pass
                        md = self._rewrite_image_refs(str(pg.get("markdown") or ""), renamed)
                        merged_pages.append({"page": global_no, "markdown": md})
                        got.add(global_no)

                    expected = set(range(start_page, end_page + 1))
                    missing = expected - got
                    # MinerU 偶发少页：若缺页超过 0 且本段并非空，允许重试
                    if missing and attempt < _CLOUD_SEGMENT_RETRIES:
                        logger.warning(
                            "MinerU 分段 %s 缺页 %s，将重试 (%s/%s)",
                            idx,
                            sorted(missing)[:20],
                            attempt,
                            _CLOUD_SEGMENT_RETRIES,
                        )
                        time.sleep(2 * attempt)
                        continue
                    if not got and attempt < _CLOUD_SEGMENT_RETRIES:
                        logger.warning(
                            "MinerU 分段 %s 无页面内容，将重试 (%s/%s)",
                            idx,
                            attempt,
                            _CLOUD_SEGMENT_RETRIES,
                        )
                        time.sleep(2 * attempt)
                        continue

                    if missing:
                        logger.warning(
                            "MinerU 分段 %s 仍缺页 %s（已达重试上限，保留已有页）",
                            idx,
                            sorted(missing)[:20],
                        )
                    return
                except Exception as e:
                    last_err = e
                    logger.warning(
                        "MinerU 分段 %s 失败 (%s/%s): %s",
                        idx,
                        attempt,
                        _CLOUD_SEGMENT_RETRIES,
                        e,
                    )
                    time.sleep(2 * attempt)
            raise AppError(
                f"MinerU 分段解析失败（第 {start_page}–{end_page} 页，已重试 {_CLOUD_SEGMENT_RETRIES} 次）: {last_err}"
            ) from last_err

        for idx, (start_page, end_page, part_bytes) in enumerate(chunks, 1):
            run_chunk(idx, start_page, end_page, part_bytes)

        # 全书视角：中间缺页再针对覆盖缺页的分段重试一轮
        expected_all: set[int] = set()
        for start_page, end_page, _ in chunks:
            expected_all.update(range(start_page, end_page + 1))
        got_all = {int(p.get("page") or 0) for p in merged_pages}
        missing_all = sorted(expected_all - got_all)
        if missing_all:
            logger.warning("MinerU 合并后仍缺页 %s，对相关分段追加重试", missing_all[:30])
            for idx, (start_page, end_page, part_bytes) in enumerate(chunks, 1):
                overlap = [p for p in missing_all if start_page <= p <= end_page]
                if overlap:
                    run_chunk(idx, start_page, end_page, part_bytes)

        if not merged_pages:
            raise AppError("MinerU 云端解析完成但未产出页面内容")

        merged_pages.sort(key=lambda p: int(p.get("page") or 0))
        # 去重同页（保留最后一次）
        by_page: dict[int, dict] = {}
        for p in merged_pages:
            by_page[int(p.get("page") or 0)] = p
        merged_pages = [by_page[k] for k in sorted(by_page)]
        return {
            "total_pages": len(merged_pages),
            "page_mds": merged_pages,
            "images": merged_images,
        }

    def _split_pdf_for_cloud(self, content: bytes) -> list[tuple[int, int, bytes]]:
        """拆成多段 (start_page_1based, end_page_1based, pdf_bytes)，满足云端页数/体积上限。"""
        import fitz

        try:
            doc = fitz.open(stream=content, filetype="pdf")
        except Exception as e:
            raise AppError(f"无法读取 PDF: {e}") from e

        try:
            n = int(doc.page_count or 0)
            if n <= 0:
                raise AppError("PDF 没有可解析的页面")

            # 页数与体积都未超限：整本一次上传
            if n <= _CLOUD_MAX_PAGES and len(content) <= _CLOUD_MAX_BYTES:
                return [(1, n, content)]

            chunks: list[tuple[int, int, bytes]] = []

            def extract(s0: int, e0: int) -> bytes:
                """半开区间 [s0, e0)。"""
                part = fitz.open()
                try:
                    part.insert_pdf(doc, from_page=s0, to_page=e0 - 1)
                    return part.tobytes(deflate=True, garbage=3)
                finally:
                    part.close()

            def emit(s0: int, e0: int) -> None:
                if e0 <= s0:
                    return
                data = extract(s0, e0)
                pages = e0 - s0
                if pages <= _CLOUD_MAX_PAGES and len(data) <= _CLOUD_MAX_BYTES:
                    chunks.append((s0 + 1, e0, data))
                    return
                if pages <= 1:
                    raise AppError(
                        f"第 {s0 + 1} 页单独仍超过云端 {_CLOUD_MAX_BYTES // (1024 * 1024)}MB 限制，"
                        "请压缩扫描件后重试，或改用本地 MinerU"
                    )
                mid = (s0 + e0) // 2
                if mid <= s0:
                    raise AppError(f"无法继续拆分第 {s0 + 1}–{e0} 页以满足云端体积限制")
                emit(s0, mid)
                emit(mid, e0)

            # 先按 200 页切窗，体积过大再对窗口二分
            for s0 in range(0, n, _CLOUD_MAX_PAGES):
                emit(s0, min(n, s0 + _CLOUD_MAX_PAGES))

            if not chunks:
                raise AppError("PDF 拆分后没有可上传的分段")
            return chunks
        finally:
            doc.close()

    def _cloud_parse_one_file(
        self,
        content: bytes,
        *,
        filename: str,
        api_base: str,
        headers: dict,
        model_version: str,
        lang: str,
        formula_enable: bool,
    ) -> dict:
        data_id = uuid.uuid4().hex[:16]
        apply_url = f"{api_base}/api/v4/file-urls/batch"
        apply_body = {
            "files": [{"name": filename, "data_id": data_id}],
            "model_version": model_version,
            "enable_formula": bool(formula_enable),
            "enable_table": True,
            "language": lang or "ch",
        }

        apply_json = None
        apply_res = None
        last_err = ""
        for attempt in range(1, _CLOUD_APPLY_RETRIES + 1):
            try:
                apply_res = requests.post(apply_url, headers=headers, json=apply_body, timeout=60)
                apply_json = apply_res.json()
            except requests.RequestException as e:
                last_err = str(e)
                logger.warning("MinerU 申请上传失败(%s/%s): %s", attempt, _CLOUD_APPLY_RETRIES, e)
                time.sleep(2 * attempt)
                continue
            except Exception:
                last_err = f"HTTP {getattr(apply_res, 'status_code', '?')}"
                time.sleep(2 * attempt)
                continue

            if apply_res is not None and apply_res.status_code == 200 and apply_json.get("code") == 0:
                break
            last_err = (apply_json or {}).get("msg") or getattr(apply_res, "text", "")[:300]
            logger.warning("MinerU 申请上传拒绝(%s/%s): %s", attempt, _CLOUD_APPLY_RETRIES, last_err)
            time.sleep(2 * attempt)
        else:
            raise AppError(f"MinerU 申请上传失败: {last_err}")

        batch_id = (apply_json.get("data") or {}).get("batch_id")
        file_urls = (apply_json.get("data") or {}).get("file_urls") or []
        if not batch_id or not file_urls:
            raise AppError("MinerU 未返回上传地址")

        upload_url = file_urls[0]
        put_res = None
        last_put_err = ""
        for attempt in range(1, _CLOUD_PUT_RETRIES + 1):
            try:
                put_res = requests.put(upload_url, data=content, timeout=600)
                if put_res.status_code in (200, 201):
                    break
                last_put_err = f"HTTP {put_res.status_code}"
            except requests.RequestException as e:
                last_put_err = str(e)
                logger.warning("MinerU 上传失败(%s/%s): %s", attempt, _CLOUD_PUT_RETRIES, e)
                time.sleep(2 * attempt)
                continue
            logger.warning("MinerU 上传拒绝(%s/%s): %s", attempt, _CLOUD_PUT_RETRIES, last_put_err)
            time.sleep(2 * attempt)
        else:
            raise AppError(f"MinerU 文件上传失败: {last_put_err}")

        logger.info("MinerU 云端上传完成，轮询 batch=%s", batch_id)
        zip_url = self._poll_cloud_batch(api_base, headers, batch_id)
        return self._result_from_cloud_zip(zip_url)

    @staticmethod
    def _rewrite_image_refs(md: str, renamed: dict[str, str]) -> str:
        if not md or not renamed:
            return md
        out = md
        # 长键优先，避免短文件名误伤
        for old in sorted(renamed.keys(), key=len, reverse=True):
            new = renamed[old]
            if old == new:
                continue
            out = out.replace(f"](images/{old})", f"](images/{new})")
            out = out.replace(f"]({old})", f"]({new})")
        return out

    def _poll_cloud_batch(self, api_base: str, headers: dict, batch_id: str) -> str:
        url = f"{api_base}/api/v4/extract-results/batch/{batch_id}"
        deadline = time.time() + _CLOUD_POLL_TIMEOUT
        last_state = ""
        while time.time() < deadline:
            try:
                res = requests.get(url, headers=headers, timeout=60)
                payload = res.json()
            except Exception as e:
                logger.warning("MinerU 轮询失败: %s", e)
                time.sleep(_CLOUD_POLL_INTERVAL)
                continue

            if res.status_code != 200 or payload.get("code") != 0:
                msg = payload.get("msg") or res.text[:200]
                raise AppError(f"MinerU 查询任务失败: {msg}")

            results = (payload.get("data") or {}).get("extract_result") or []
            if not results:
                time.sleep(_CLOUD_POLL_INTERVAL)
                continue

            item = results[0]
            state = (item.get("state") or "").lower()
            if state != last_state:
                logger.info("MinerU 云端状态: %s", state)
                last_state = state

            if state == "done":
                zip_url = item.get("full_zip_url") or ""
                if not zip_url:
                    raise AppError("MinerU 解析完成但未返回结果包")
                return zip_url
            if state == "failed":
                raise AppError(f"MinerU 解析失败: {item.get('err_msg') or '未知错误'}")

            time.sleep(_CLOUD_POLL_INTERVAL)

        raise AppError(f"MinerU 云端解析超时（>{_CLOUD_POLL_TIMEOUT}s），请稍后在设置中重试或改用本地")

    def _result_from_cloud_zip(self, zip_url: str) -> dict:
        zip_bytes = None
        last_err = ""
        for attempt in range(1, _CLOUD_DOWNLOAD_RETRIES + 1):
            try:
                zip_res = requests.get(zip_url, timeout=300)
                zip_res.raise_for_status()
                zip_bytes = zip_res.content
                if zip_bytes:
                    break
                last_err = "空响应"
            except requests.RequestException as e:
                last_err = str(e)
                logger.warning(
                    "MinerU 结果包下载失败(%s/%s): %s",
                    attempt,
                    _CLOUD_DOWNLOAD_RETRIES,
                    e,
                )
                time.sleep(min(30, 2 * attempt))
        if not zip_bytes:
            raise AppError(f"下载 MinerU 结果包失败（已重试 {_CLOUD_DOWNLOAD_RETRIES} 次）: {last_err}")

        md_text = ""
        content_list = None
        images: dict[str, bytes] = {}

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = [n for n in zf.namelist() if not n.endswith("/")]
            # full.md 优先
            md_candidates = [n for n in names if n.lower().endswith("full.md")]
            if not md_candidates:
                md_candidates = [n for n in names if n.lower().endswith(".md")]
            if md_candidates:
                # 取路径最短的 full.md / md
                md_name = sorted(md_candidates, key=lambda n: (n.count("/"), len(n)))[0]
                md_text = zf.read(md_name).decode("utf-8", errors="replace")

            list_candidates = [
                n for n in names if n.lower().endswith("content_list.json") or n.lower().endswith("_content_list.json")
            ]
            if list_candidates:
                list_name = sorted(list_candidates, key=lambda n: (n.count("/"), len(n)))[0]
                try:
                    content_list = json.loads(zf.read(list_name).decode("utf-8"))
                except Exception:
                    content_list = None

            for name in names:
                lower = name.lower()
                if "/images/" in lower.replace("\\", "/") or lower.startswith("images/"):
                    base = Path(name).name
                    if base:
                        images[base] = zf.read(name)

        if not md_text.strip():
            raise AppError("MinerU 结果包中没有 Markdown")

        # 云端 md 常引用 images/xxx，统一成文件名便于后续改写
        page_mds = self._pages_from_content_list(content_list)
        if not page_mds:
            page_mds = self._split_pages(md_text)
        # 若 content_list 带路径图片，补进 images 键的引用名
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
