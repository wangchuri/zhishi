"""文档缩略图测试 — display_name 字段回归 + 动态生成真实校验。"""
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.api.v1.kb import get_document_thumbnail
from app.services import thumbnail_service


def test_thumbnail_endpoint_uses_display_name(db, user, study_doc):
    # 文档无原始文件字节：应优雅返回 404，而不是因字段缺失抛 500
    with patch("app.api.v1.kb.kb_crud.get_document_by_id_or_dify", return_value=study_doc), \
         patch("app.services.thumbnail_service.get_thumbnail_path", return_value=None), \
         patch("app.services.storage_service.storage_service.read_file_at_path", return_value=None):
        try:
            get_document_thumbnail(study_doc.id, db, {"user_id": user.id})
            assert False, "应抛 404"
        except HTTPException as e:
            assert e.status_code == 404


def test_generate_thumbnail_pdf_renders():
    import fitz

    doc = fitz.open()
    doc.new_page()
    pdf_bytes = doc.tobytes()
    doc.close()

    path = thumbnail_service.generate_thumbnail(
        "hash_thumb_test", pdf_bytes, "pdf", filename_hint="sample.pdf"
    )
    assert path is not None
    p = Path(path)
    assert p.exists() and p.stat().st_size > 0


def test_get_thumbnail_path_cache_hit(db, user, study_doc):
    # 已缓存缩略图：直接返回 FileResponse
    with patch("app.api.v1.kb.kb_crud.get_document_by_id_or_dify", return_value=study_doc), \
         patch("app.services.thumbnail_service.get_thumbnail_path", return_value="/tmp/fake.thumb.png"):
        from fastapi.responses import FileResponse

        resp = get_document_thumbnail(study_doc.id, db, {"user_id": user.id})
        assert isinstance(resp, FileResponse)
