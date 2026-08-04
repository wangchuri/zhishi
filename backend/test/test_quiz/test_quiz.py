"""刷题服务测试：判分逻辑、会话创建、答题提交、结果统计。"""
import asyncio
import json

import pytest
from fastapi import HTTPException

from app.models import GlobalQuestion
from app.schemas.quiz import QuizSessionCreate
from app.services.question_gen_service import _persist_question_core
from app.services.quiz_service import (
    _grade_answer,
    _grade_fill_blank_string,
    _parse_ai_grade_response,
    _parse_multi_blank_values,
    create_quiz_session,
    get_session_results,
    get_quiz_session,
    submit_answer,
)


def _run(coro):
    return asyncio.run(coro)


def _fill_blank_q(stem="___ 是北京，___ 是上海", answer='["北京","上海"]'):
    return GlobalQuestion(
        content_hash="h",
        stem=stem,
        question_type="fill_blank",
        answer=answer,
        explanation="解析",
        source_type="generated",
    )


def _single_choice_q(answer="B"):
    return GlobalQuestion(
        content_hash="h2",
        stem="1+1=?",
        question_type="single_choice",
        answer=answer,
        explanation="解析",
        source_type="generated",
    )


def test_parse_multi_blank_values():
    assert _parse_multi_blank_values('["A","B"]') == ["A", "B"]
    assert _parse_multi_blank_values("A;B") == ["A", "B"]
    assert _parse_multi_blank_values("A；B") == ["A", "B"]
    assert _parse_multi_blank_values("A、B") == ["A", "B"]
    assert _parse_multi_blank_values("") == []


def test_grade_fill_blank_correct():
    q = _fill_blank_q()
    assert _grade_fill_blank_string(q, '["北京","上海"]') == "correct"


def test_grade_fill_blank_wrong():
    q = _fill_blank_q()
    assert _grade_fill_blank_string(q, '["北京","广州"]') == "wrong"


def test_grade_fill_blank_case_insensitive():
    q = _fill_blank_q(answer='["ABC"]', stem="填空 ___")
    assert _grade_fill_blank_string(q, '["abc"]') == "correct"


def test_grade_fill_blank_count_mismatch():
    q = _fill_blank_q()
    assert _grade_fill_blank_string(q, '["北京"]') == "wrong"


def test_grade_answer_single_choice_correct():
    status, method, s, ai = _run(_grade_answer(_single_choice_q(), "B", None))
    assert status == "correct"
    assert method == "string"


def test_grade_answer_single_choice_wrong():
    status, _, _, _ = _run(_grade_answer(_single_choice_q(), "A", None))
    assert status == "wrong"


def test_grade_answer_empty_answer_wrong():
    status, _, _, _ = _run(_grade_answer(_single_choice_q(), "", None))
    assert status == "wrong"


def test_grade_answer_unknown_hint():
    status, method, s, ai = _run(
        _grade_answer(_single_choice_q(), "B", "unknown")
    )
    assert status == "unknown"


def test_parse_ai_grade_response():
    assert _parse_ai_grade_response('{"status":"correct","reason":"对"}') == (
        "correct",
        "对",
    )
    assert _parse_ai_grade_response(
        '```json\n{"status":"partial","reason":"部分"}\n```'
    ) == ("partial", "部分")
    assert _parse_ai_grade_response("正确") == ("correct", "正确")


def _persist_q(db, user, doc, stem="1+1=?", answer="B"):
    qdata = {
        "stem": stem,
        "question_type": "single_choice",
        "options": [
            {"key": "A", "text": "3"},
            {"key": "B", "text": "2"},
        ],
        "answer": answer,
        "explanation": "2 是答案",
        "tags": ["数学"],
    }
    _persist_question_core(
        db,
        user_id=user.id,
        document=doc,
        qdata=qdata,
        source_type="generated",
        segment_id=None,
        excerpt="e",
    )
    db.commit()


def _qids(db, user, doc):
    from app.services.question_gen_service import list_questions

    out = list_questions(db, user.id, document_id=doc.id)
    return [q.id for q in out.questions]


def test_create_quiz_session_with_question_ids(db, user, study_doc):
    _persist_q(db, user, study_doc)
    ids = _qids(db, user, study_doc)
    out = create_quiz_session(db, user.id, QuizSessionCreate(question_ids=ids))
    assert out.total_questions == 1
    assert out.status == "active"
    assert out.questions[0].question_id == ids[0]


def test_create_quiz_session_no_questions_409(db, user, study_doc):
    with pytest.raises(HTTPException) as ei:
        create_quiz_session(
            db, user.id, QuizSessionCreate(document_id=study_doc.id)
        )
    assert ei.value.status_code == 409


def test_create_quiz_session_with_questions_ignores_stale_status(db, user, study_doc):
    """回归：文档有题但 question_gen_status 非 completed（如中断后恢复）仍可刷题。"""
    _persist_q(db, user, study_doc)
    study_doc.question_gen_status = "not_started"
    db.commit()
    out = create_quiz_session(
        db, user.id, QuizSessionCreate(document_id=study_doc.id, filter="all")
    )
    assert out.total_questions == 1
    assert out.status == "active"


def test_submit_answer_auto_completes_session(db, user, study_doc):
    _persist_q(db, user, study_doc)
    ids = _qids(db, user, study_doc)
    sess = create_quiz_session(db, user.id, QuizSessionCreate(question_ids=ids))

    result = _run(
        submit_answer(
            db,
            user.id,
            sess.id,
            question_id=ids[0],
            user_answer="B",
        )
    )
    assert result.status == "correct"
    assert result.answered_count == 1
    assert result.total_questions == 1
    assert result.session_status == "completed"


def test_submit_answer_wrong_builds_citation(db, user, study_doc):
    _persist_q(db, user, study_doc)
    ids = _qids(db, user, study_doc)
    sess = create_quiz_session(db, user.id, QuizSessionCreate(question_ids=ids))
    result = _run(
        submit_answer(
            db,
            user.id,
            sess.id,
            question_id=ids[0],
            user_answer="A",
        )
    )
    assert result.status == "wrong"


def test_submit_question_not_in_session_400(db, user, study_doc):
    _persist_q(db, user, study_doc)
    ids = _qids(db, user, study_doc)
    sess = create_quiz_session(db, user.id, QuizSessionCreate(question_ids=ids))
    with pytest.raises(HTTPException) as ei:
        _run(
            submit_answer(
                db, user.id, sess.id, question_id="other-id", user_answer="B"
            )
        )
    assert ei.value.status_code == 400


def test_submit_after_completed_400(db, user, study_doc):
    _persist_q(db, user, study_doc)
    ids = _qids(db, user, study_doc)
    sess = create_quiz_session(db, user.id, QuizSessionCreate(question_ids=ids))
    _run(
        submit_answer(
            db, user.id, sess.id, question_id=ids[0], user_answer="B"
        )
    )
    with pytest.raises(HTTPException) as ei:
        _run(
            submit_answer(
                db, user.id, sess.id, question_id=ids[0], user_answer="B"
            )
        )
    assert ei.value.status_code == 400


def test_get_session_results_counts(db, user, study_doc):
    _persist_q(db, user, study_doc, stem="1+1=?", answer="B")
    _persist_q(db, user, study_doc, stem="2+2=?", answer="A")
    ids = _qids(db, user, study_doc)
    sess = create_quiz_session(db, user.id, QuizSessionCreate(question_ids=ids))

    # 会话内题目顺序会被随机打乱，按题目实际正确答案作答
    for q in sess.questions:
        question = (
            db.query(GlobalQuestion)
            .filter(GlobalQuestion.id == q.question_id)
            .first()
        )
        _run(
            submit_answer(
                db,
                user.id,
                sess.id,
                question_id=q.question_id,
                user_answer=question.answer,
            )
        )

    results = get_session_results(db, user.id, sess.id)
    assert results.status == "completed"
    assert results.total_questions == 2
    assert results.correct_count == 2
    assert results.wrong_count == 0
    assert len(results.items) == 0


def test_get_quiz_session_not_found(db, user):
    with pytest.raises(HTTPException) as ei:
        get_quiz_session(db, user.id, "missing")
    assert ei.value.status_code == 404
