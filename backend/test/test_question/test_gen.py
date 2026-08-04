"""出题服务测试：JSON 解析、题目标准化、持久化去重、查询与删除。"""
import json

import pytest
from fastapi import HTTPException

from app.services.question_gen_service import (
    _extract_json_array,
    _normalize_question,
    _persist_question_core,
    delete_user_questions,
    get_question_detail,
    list_questions,
)


def _qdata(stem="1+1=?", answer="A", qtype="single_choice", **kw):
    data = {
        "stem": stem,
        "answer": answer,
        "question_type": qtype,
        "options": [
            {"key": "A", "text": "2"},
            {"key": "B", "text": "3"},
            {"key": "C", "text": "4"},
        ],
        "explanation": "2 是最小的质数",
        "tags": ["数学"],
    }
    data.update(kw)
    return data


def test_extract_json_array_plain():
    assert _extract_json_array('[{"a":1}]') == [{"a": 1}]


def test_extract_json_array_fenced():
    text = "```json\n[{\"a\":1},{\"b\":2}]\n```"
    assert _extract_json_array(text) == [{"a": 1}, {"b": 2}]


def test_extract_json_array_dict_wrapped():
    assert _extract_json_array('{"stem":"x"}') == [{"stem": "x"}]


def test_extract_json_array_embedded():
    text = "以下是题目：\n[{\"stem\":\"y\"}]"
    assert _extract_json_array(text) == [{"stem": "y"}]


def test_extract_json_array_invalid():
    assert _extract_json_array("没有数组") is None
    assert _extract_json_array("") is None


def test_normalize_single_choice_ok():
    q = _normalize_question(_qdata())
    assert q["question_type"] == "single_choice"
    assert q["answer"] == "A"
    assert len(q["options"]) == 3


def test_normalize_single_choice_bad_answer():
    assert _normalize_question(_qdata(answer="Z")) is None


def test_normalize_single_choice_too_few_options():
    assert (
        _normalize_question(
            _qdata(options=[{"key": "A", "text": "2"}])
        )
        is None
    )


def test_normalize_fill_blank():
    q = _normalize_question(
        _qdata(
            stem="___ 是中国首都，___ 是上海简称",
            answer='["北京","沪"]',
            qtype="fill_blank",
        )
    )
    assert q["question_type"] == "fill_blank"
    assert json.loads(q["answer"]) == ["北京", "沪"]


def test_normalize_fill_blank_slot_mismatch():
    q = _normalize_question(
        _qdata(
            stem="___ 是中国首都",
            answer='["北京","沪"]',
            qtype="fill_blank",
        )
    )
    assert q is None


def test_normalize_short_answer():
    q = _normalize_question(
        _qdata(stem="简述微积分", answer="研究变化率", qtype="short_answer")
    )
    assert q["question_type"] == "short_answer"


def test_normalize_custom_requires_html():
    assert (
        _normalize_question(
            _qdata(stem="自定义题", answer="x", qtype="custom")
        )
        is None
    )
    q = _normalize_question(
        _qdata(
            stem="自定义题",
            answer="x",
            qtype="custom",
            html_content="<p>题目</p>",
            answer_params="{}",
        )
    )
    assert q is not None and q["question_type"] == "custom"


def test_normalize_unknown_type_falls_back_to_single_choice():
    assert _normalize_question(_qdata(question_type="weird")) is not None


def test_persist_question_creates_and_reuses(db, user, study_doc):
    created1, reused1 = _persist_question_core(
        db,
        user_id=user.id,
        document=study_doc,
        qdata=_qdata(),
        source_type="generated",
        segment_id=None,
        excerpt="excerpt",
    )
    db.commit()
    assert created1 is True and reused1 is False

    created2, reused2 = _persist_question_core(
        db,
        user_id=user.id,
        document=study_doc,
        qdata=_qdata(),
        source_type="generated",
        segment_id=None,
        excerpt="excerpt",
    )
    db.commit()
    assert created2 is False and reused2 is True

    out = list_questions(db, user.id, document_id=study_doc.id)
    assert out.total == 1


def test_list_questions_counts(db, user, study_doc):
    _persist_question_core(
        db,
        user_id=user.id,
        document=study_doc,
        qdata=_qdata(),
        source_type="generated",
        segment_id=None,
        excerpt="e",
    )
    db.commit()
    out = list_questions(db, user.id)
    assert out.total == 1
    q = out.questions[0]
    assert q.document_id == study_doc.id
    assert q.collection_id == study_doc.collection_id


def test_get_question_detail_with_provenance(db, user, study_doc):
    created, _ = _persist_question_core(
        db,
        user_id=user.id,
        document=study_doc,
        qdata=_qdata(),
        source_type="generated",
        segment_id=None,
        excerpt="出处文本",
    )
    db.commit()
    assert created
    out = list_questions(db, user.id, document_id=study_doc.id)
    qid = out.questions[0].id

    detail = get_question_detail(db, user.id, qid)
    assert detail.id == qid
    assert len(detail.provenance) == 1
    assert detail.provenance[0].document_id == study_doc.id


def test_get_question_detail_missing_raises(db, user):
    with pytest.raises(HTTPException) as ei:
        get_question_detail(db, user.id, "missing-id")
    assert ei.value.status_code == 404


def test_delete_user_questions_by_document(db, user, study_doc):
    _persist_question_core(
        db,
        user_id=user.id,
        document=study_doc,
        qdata=_qdata(),
        source_type="generated",
        segment_id=None,
        excerpt="e",
    )
    db.commit()
    resp = delete_user_questions(db, user.id, document_id=study_doc.id)
    assert resp.deleted_count == 1
    assert list_questions(db, user.id, document_id=study_doc.id).total == 0


def test_delete_user_questions_requires_target(db, user):
    with pytest.raises(HTTPException) as ei:
        delete_user_questions(db, user.id)
    assert ei.value.status_code == 400
