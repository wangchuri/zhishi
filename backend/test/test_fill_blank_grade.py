"""
填空题判分单元测试
运行: cd backend && python test_fill_blank_grade.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.models import GlobalQuestion
from app.services.quiz_service import _grade_answer, _grade_fill_blank_string, _parse_multi_blank_values


def _make_question(**kwargs) -> GlobalQuestion:
    q = GlobalQuestion(
        content_hash="test_hash",
        stem=kwargs.get("stem", "测试 ___ 和 ___"),
        question_type=kwargs.get("question_type", "fill_blank"),
        answer=kwargs.get("answer", json.dumps(["北京", "上海"], ensure_ascii=False)),
        explanation="解析",
        source_type="generated",
    )
    return q


def test_parse_multi_blank_values():
    assert _parse_multi_blank_values('["A","B"]') == ["A", "B"]
    assert _parse_multi_blank_values("A;B") == ["A", "B"]
    assert _parse_multi_blank_values("A；B") == ["A", "B"]
    print("OK parse_multi_blank_values")


def test_fill_blank_string_correct():
    q = _make_question()
    user = json.dumps(["北京", "上海"], ensure_ascii=False)
    assert _grade_fill_blank_string(q, user) == "correct"
    print("OK fill_blank_string_correct")


def test_fill_blank_string_wrong():
    q = _make_question()
    user = json.dumps(["北京", "广州"], ensure_ascii=False)
    assert _grade_fill_blank_string(q, user) == "wrong"
    print("OK fill_blank_string_wrong")


def test_fill_blank_case_insensitive():
    q = _make_question(answer=json.dumps(["ABC"], ensure_ascii=False), stem="填空 ___")
    assert _grade_fill_blank_string(q, json.dumps(["abc"])) == "correct"
    print("OK fill_blank_case_insensitive")


def test_grade_answer_fill_blank_method():
    q = _make_question()
    user = json.dumps(["北京", "上海"], ensure_ascii=False)
    status, method, string_status, ai_reason = _grade_answer(q, user, None)
    assert status == "correct"
    assert method == "string"
    assert string_status == "correct"
    assert ai_reason is None
    print("OK grade_answer_fill_blank_method")


if __name__ == "__main__":
    test_parse_multi_blank_values()
    test_fill_blank_string_correct()
    test_fill_blank_string_wrong()
    test_fill_blank_case_insensitive()
    test_grade_answer_fill_blank_method()
    print("\nAll fill_blank grade checks passed.")
