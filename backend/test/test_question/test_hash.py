"""题干规范化与 content_hash 去重逻辑测试。"""
import json

from app.services.question_hash import compute_content_hash, normalize_text


def test_normalize_text_strips_whitespace_and_punct():
    assert normalize_text("  微积分  是什么？! ") == "微积分是什么"
    assert normalize_text("Hello World") == "helloworld"
    assert normalize_text("") == ""


def test_normalize_text_nfkc_and_lower():
    assert normalize_text("ＡＢＣ １２３") == "abc123"
    assert normalize_text("数学（上）") == "数学上"


def test_compute_content_hash_deterministic():
    h1 = compute_content_hash("1+1=?", [{"key": "A", "text": "2"}], "A")
    h2 = compute_content_hash("1+1=?", [{"key": "A", "text": "2"}], "A")
    assert h1 == h2


def test_compute_content_hash_sensitive_to_answer():
    h1 = compute_content_hash("1+1=?", [{"key": "A", "text": "2"}], "A")
    h2 = compute_content_hash("1+1=?", [{"key": "A", "text": "2"}], "B")
    assert h1 != h2


def test_compute_content_hash_preserves_option_order():
    # _options_to_str 使用 json.dumps(sort_keys=True)，仅排序 key，不排序数组顺序
    options_a = [{"key": "A", "text": "北京"}, {"key": "B", "text": "上海"}]
    options_b = [{"key": "B", "text": "上海"}, {"key": "A", "text": "北京"}]
    h1 = compute_content_hash("首都是哪里", options_a, "A")
    h2 = compute_content_hash("首都是哪里", options_b, "A")
    assert h1 != h2


def test_compute_content_hash_string_options_json():
    options_str = json.dumps([{"key": "A", "text": "北京"}], ensure_ascii=False)
    h = compute_content_hash("首都是哪里", options_str, "A")
    assert isinstance(h, str) and len(h) == 64
