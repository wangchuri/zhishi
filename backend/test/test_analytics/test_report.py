"""学习报告服务测试：模板报告与生成流程（mock LLM）。"""
import asyncio
from unittest.mock import patch

from app.crud import note as note_crud
from app.services import report_service


def _run(coro):
    return asyncio.run(coro)


def test_template_report_contains_stats():
    md = report_service._template_report("统计摘要内容")
    assert "# 学习报告" in md
    assert "统计摘要内容" in md
    assert "LLM 服务不可用" in md


def test_generate_report_uses_template_when_no_llm(db, user, collections):
    with patch("app.services.report_service._get_llm", return_value=None):
        out = _run(report_service.generate_learning_report(db, user.id))
    assert out.saved_to_notes is True
    assert out.report.title.startswith("学习报告")
    assert "## 学习概览" in out.report.content_md


def test_generate_report_falls_back_on_llm_error(db, user, collections):
    class _Broken:
        async def apredict_no_stream(self, **kw):
            raise RuntimeError("boom")

    with patch("app.services.report_service._get_llm", return_value=_Broken()):
        out = _run(report_service.generate_learning_report(db, user.id))
    assert out.saved_to_notes is True
    assert "LLM 服务不可用" in out.report.content_md


def test_generate_report_persists_note(db, user, collections):
    with patch("app.services.report_service._get_llm", return_value=None):
        _run(report_service.generate_learning_report(db, user.id))
    notes = note_crud.list_notes(db, user.id, note_type="report", limit=10)
    assert len(notes) == 1
    assert notes[0].note_type == "report"


def test_get_latest_report_missing_404(db, user):
    from fastapi import HTTPException

    import pytest

    with pytest.raises(HTTPException) as ei:
        report_service.get_latest_report(db, user.id)
    assert ei.value.status_code == 404
