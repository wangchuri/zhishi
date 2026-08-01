"""
缩略图生成服务 — 文档封面图

PDF → PyMuPDF 渲染第一页
其他（txt/md/docx）→ Pillow 生成文字卡片
"""
import io
import logging
from pathlib import Path
from typing import Optional

from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

_THUMB_SUFFIX = ".thumb.png"


def generate_thumbnail(
    content_hash: str,
    file_bytes: bytes,
    file_type: str,
    *,
    filename_hint: str = "",
) -> Optional[str]:
    """生成缩略图并保存到全局存储，返回存储路径；失败返回 None。"""
    thumb_bytes = _render_thumbnail(file_bytes, file_type, filename_hint=filename_hint)
    if not thumb_bytes:
        logger.warning("generate_thumbnail: 未能生成缩略图 (hash=%s, type=%s)", content_hash, file_type)
        return None
    return storage_service.save_global_file(content_hash, thumb_bytes, suffix=_THUMB_SUFFIX)


def get_thumbnail_path(content_hash: str) -> Optional[str]:
    """获取已生成缩略图的存储路径。"""
    thumb_dir = _get_global_dir(content_hash)
    thumb_path = thumb_dir / f"{content_hash}{_THUMB_SUFFIX}"
    return str(thumb_path) if thumb_path.exists() else None


def delete_thumbnail(content_hash: str) -> bool:
    """删除缩略图。"""
    path = get_thumbnail_path(content_hash)
    if path:
        return storage_service.delete_file_at_path(path)
    return False


# ── 内部实现 ──────────────────────────────────────────


def _get_global_dir(content_hash: str) -> Path:
    from app.services.storage_service import LOCAL_STORAGE_DIR
    return Path(LOCAL_STORAGE_DIR) / "global" / content_hash[:2]


def _render_thumbnail(file_bytes: bytes, file_type: str, *, filename_hint: str = "") -> Optional[bytes]:
    """按文件类型渲染缩略图字节 (PNG)。"""
    ft = (file_type or "").lower().strip().lstrip(".")

    if ft in ("pdf",):
        return _render_pdf_thumbnail(file_bytes)
    if ft in ("txt", "md", "docx", "image", "ocr"):
        return _render_text_card(filename_hint or ft or "文档", ft)
    # 未知类型或不支持
    return _render_text_card(filename_hint or "文档", "file")


def _render_pdf_thumbnail(file_bytes: bytes) -> Optional[bytes]:
    """PyMuPDF 渲染第一页为 PNG。"""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc[0]
        # 72 DPI 低分辨率缩略图，~200px 宽
        pix = page.get_pixmap(dpi=72)
        out = pix.tobytes("png")
        doc.close()
        return out
    except ImportError:
        logger.warning("PyMuPDF 不可用，无法生成 PDF 缩略图")
        return None
    except Exception as e:
        logger.warning("PDF 缩略图生成失败: %s", e)
        return None


def _render_text_card(title: str, subtitle: str) -> Optional[bytes]:
    """Pillow 生成文字封面卡片 (320×440 PNG)。"""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        logger.warning("Pillow 不可用，无法生成文字卡片缩略图")
        return None

    W, H = 320, 440
    bg_color = (245, 243, 255)  # 浅紫背景
    accent = (99, 102, 241)     # 主题色

    img = Image.new("RGB", (W, H), bg_color)
    draw = ImageDraw.Draw(img)

    # 尝试加载中文字体，fallback 到默认
    font_large = _try_load_font(36)
    font_small = _try_load_font(20)
    font_icon = _try_load_font(64)

    # 中心图标（书本 emoji 或纯文本）
    icon_text = "📖"
    if font_icon:
        try:
            bbox = draw.textbbox((0, 0), icon_text, font=font_icon)
            iw = bbox[2] - bbox[0]
            draw.text(((W - iw) / 2, 80), icon_text, font=font_icon, fill=accent)
        except Exception:
            pass

    # 标题
    if font_large:
        max_w = W - 40
        display_title = _truncate_text(draw, title, font_large, max_w, "…")
        tb = draw.textbbox((0, 0), display_title, font=font_large)
        tw = tb[2] - tb[0]
        draw.text(((W - tw) / 2, 200), display_title, font=font_large, fill=(30, 30, 30))

    # 副标题（文档类型）
    if font_small:
        stb = draw.textbbox((0, 0), subtitle, font=font_small)
        sw = stb[2] - stb[0]
        draw.text(((W - sw) / 2, 260), subtitle, font=font_small, fill=(120, 120, 120))

    # 装饰线
    draw.rounded_rectangle([(80, 320), (240, 324)], radius=2, fill=accent)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _try_load_font(size: int):
    """尝试加载常见中文字体。"""
    candidates = [
        "C:/Windows/Fonts/msyh.ttc",         # 微软雅黑
        "C:/Windows/Fonts/simsun.ttc",       # 宋体
        "/System/Library/Fonts/PingFang.ttc",  # macOS
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",  # Linux
    ]
    for path in candidates:
        p = Path(path)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                continue
    return None


def _truncate_text(draw, text: str, font, max_width: int, ellipsis: str = "…") -> str:
    """文字截断，确保不超宽。"""
    if not text:
        return ""
    bbox = draw.textbbox((0, 0), text, font=font)
    if bbox[2] - bbox[0] <= max_width:
        return text
    for i in range(len(text), 0, -1):
        t = text[:i] + ellipsis
        b = draw.textbbox((0, 0), t, font=font)
        if b[2] - b[0] <= max_width:
            return t
    return text[:1] + ellipsis