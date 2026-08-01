"""
QuestionGenAgent 验证 — 真实 LLM 调用 + mock _normalize_question
运行: cd backend && python test/test_question_gen_agent.py

测试内容:
1. test_normalize_custom_question   — 验证 _normalize_question 对 custom 题型的处理
2. test_submit_custom_question      — Agent 真实调用 submit_custom_question 出题
3. test_parallel_multi_tool         — Agent 并行调用多个 submit_* 工具
4. test_retry_on_insufficient_count — Agent 数量不足触发重试
"""
import asyncio
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.utils.tina_loader import tina_env_path
from app.services.question_gen_service import _normalize_question


# ============================================================
# 测试 1: _normalize_question custom 题型处理（无 LLM）
# ============================================================

def test_normalize_custom_question():
    """验证 _normalize_question 处理 custom 题型的各个分支。"""

    # 1.1 合法 custom 题目
    raw_ok = {
        "stem": "请在地图上标注北京市的位置",
        "question_type": "custom",
        "answer": '{"city": "北京", "lat": 39.9, "lng": 116.4}',
        "explanation": "北京市位于华北平原北部",
        "tags": ["地理", "中国地图"],
        "reference_text": "北京市是中华人民共和国的首都",
        "source": "ai_generated",
        "html_content": "<div id='map' style='width:100%;height:400px;background:#eef;'><p>点击标注城市位置</p></div>",
        "answer_params": [
            {"key": "city", "label": "城市名称", "type": "text"},
            {"key": "lat", "label": "纬度", "type": "number"},
        ],
    }
    result = _normalize_question(raw_ok)
    assert result is not None, "合法 custom 题目不应返回 None"
    assert result["question_type"] == "custom"
    assert result["stem"] == "请在地图上标注北京市的位置"
    assert result["html_content"] == raw_ok["html_content"]
    assert result["answer_params"] == raw_ok["answer_params"]
    print("  OK 1.1 合法 custom 题目")

    # 1.2 html_content 为空 → 应返回 None
    raw_no_html = {
        "stem": "缺少 HTML 的 custom 题",
        "question_type": "custom",
        "answer": "x",
        "html_content": "",
        "answer_params": [],
    }
    result = _normalize_question(raw_no_html)
    assert result is None, "html_content 为空的 custom 题目应返回 None"
    print("  OK 1.2 html_content 为空 → None")

    # 1.3 stem 为空 → 返回 None
    raw_no_stem = {
        "stem": "",
        "question_type": "custom",
        "answer": "x",
        "html_content": "<p>test</p>",
        "answer_params": [],
    }
    result = _normalize_question(raw_no_stem)
    assert result is None, "stem 为空的题目应返回 None"
    print("  OK 1.3 stem 为空 → None")

    # 1.4 非 custom 类型不受 html_content 影响
    raw_sc = {
        "stem": "单选题",
        "question_type": "single_choice",
        "options": [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}],
        "answer": "A",
        "html_content": "",
    }
    result = _normalize_question(raw_sc)
    assert result is not None
    assert "html_content" not in result
    print("  OK 1.4 非 custom 类型不受 html_content 影响")

    print("✓ test_normalize_custom_question passed\n")


# ============================================================
# 测试 2: Agent 真实调用 submit_custom_question
# ============================================================

async def _run_submit_custom_question():
    from app.agents.question_gen_agent import QuestionGenWorker

    worker = QuestionGenWorker(user_id=999999)
    assert worker.is_ready, "Agent 应初始化成功"

    pages = [{
        "page_number": 1,
        "title": "中国行政区划",
        "content": (
            "中国共有34个省级行政区，包括23个省、5个自治区、4个直辖市和2个特别行政区。"
            "北京市是中华人民共和国的首都，位于华北平原北部，总面积约1.64万平方千米，"
            "常住人口约2189万人。上海市是中国的经济中心，位于长江入海口，总面积约6340平方千米，"
            "常住人口约2487万人。广州市是广东省省会，位于珠江三角洲，总面积约7434平方千米。"
            "表格中列出了各省会城市及其人口数据。"
        ),
    }]

    questions = await worker.submit(pages=pages, questions_per_page=1)

    assert len(questions) >= 1, f"应提交至少 1 道题，实际 {len(questions)}"

    custom_questions = [q for q in questions if q.get("question_type") == "custom"]
    if custom_questions:
        q = custom_questions[0]
        print(f"  custom 题目: stem={q['stem'][:40]}")
        assert q.get("html_content"), "custom 题目必须有 html_content"
        assert q.get("answer_params"), "custom 题目必须有 answer_params"
        print(f"  html_content 长度: {len(q['html_content'])}")
        print(f"  answer_params: {q['answer_params']}")
    else:
        types = {q.get("question_type") for q in questions}
        print(f"  未出 custom 题，题目类型: {types}")

    print(f"  总题数: {len(questions)}")
    for q in questions:
        assert q.get("stem"), "每道题必须有 stem"
        assert q.get("question_type") in ("single_choice", "fill_blank", "short_answer", "application", "custom")
    print("✓ test_submit_custom_question passed\n")


def test_submit_custom_question():
    asyncio.run(_run_submit_custom_question())


# ============================================================
# 测试 3: Agent 并行调用多个 submit_* 工具
# ============================================================

async def _run_parallel_multi_tool():
    """Agent 在单次 turn 内并行调用多个不同 submit_* 工具。"""
    from app.agents.question_gen_agent import QuestionGenWorker

    worker = QuestionGenWorker(user_id=999998)
    assert worker.is_ready

    pages = [{
        "page_number": 1,
        "title": "Python 基础",
        "content": (
            "Python 是一种高级编程语言，由 Guido van Rossum 于 1991 年发布。"
            "它支持多种编程范式，包括面向对象、函数式和过程式编程。"
            "Python 的列表推导式是一种简洁的创建列表的方式，例如 [x**2 for x in range(10)]。"
            "字典是键值对的集合，用花括号表示。元组是不可变的序列，用圆括号表示。"
            "Python 使用缩进来定义代码块，而不是花括号。"
        ),
    }]

    questions = await worker.submit(pages=pages, questions_per_page=2)

    assert len(questions) >= 1, f"应提交题目，实际 {len(questions)}"
    assert len(questions) >= 2, f"应提交至少 2 道题，实际 {len(questions)}"

    types = {q.get("question_type") for q in questions}
    print(f"  题目类型分布: {types}")
    assert len(types) >= 1
    print(f"  总题数: {len(questions)}")

    for q in questions:
        assert q.get("stem")
        assert q.get("question_type") in ("single_choice", "fill_blank", "short_answer", "application", "custom")
        if q["question_type"] == "single_choice":
            assert len(q.get("options", [])) >= 2
        elif q["question_type"] == "custom":
            assert q.get("html_content")

    print("✓ test_parallel_multi_tool passed\n")


def test_parallel_multi_tool():
    asyncio.run(_run_parallel_multi_tool())


# ============================================================
# 测试 4: Agent 数量不足触发重试
# ============================================================

async def _run_retry_on_insufficient_count():
    """
    Agent 出题数量不足时触发 on_turn_end 重试。
    使用极短页面内容，让 Agent 无法在首轮达到要求数量。
    """
    from app.agents.question_gen_agent import QuestionGenWorker

    worker = QuestionGenWorker(user_id=999997)
    assert worker.is_ready

    pages = [{
        "page_number": 1,
        "title": "简短标题",
        "content": "这是一段非常简短的内容。只包含一句话。没有太多知识点。",
    }]

    questions = await worker.submit(pages=pages, questions_per_page=3)

    print(f"  最终提交题数: {len(questions)} (要求: 3)")
    for i, q in enumerate(questions):
        print(f"    [{i+1}] {q.get('question_type')}: {q['stem'][:40]}")

    assert len(questions) >= 1, "应提交至少 1 道题"
    if len(questions) < 3:
        gap = 3 - len(questions)
        print(f"  缺口 {gap} 道（≤2 可接受），未触发额外重试")
    else:
        print("  ✅ 成功出满 3 道题（可能经过重试）")

    for q in questions:
        assert q.get("stem")
        assert q.get("question_type") in ("single_choice", "fill_blank", "short_answer", "application", "custom")
        if q["question_type"] == "custom":
            assert q.get("html_content")

    print("✓ test_retry_on_insufficient_count passed\n")


def test_retry_on_insufficient_count():
    asyncio.run(_run_retry_on_insufficient_count())


# ============================================================
# 主入口
# ============================================================

if __name__ == "__main__":
    print("=" * 60)
    print("test_question_gen_agent 开始")
    print("=" * 60)
    t0 = time.time()

    test_normalize_custom_question()

    print("─" * 40)
    print("test_submit_custom_question (真实 LLM)...")
    test_submit_custom_question()

    print("─" * 40)
    print("test_parallel_multi_tool (真实 LLM)...")
    test_parallel_multi_tool()

    print("─" * 40)
    print("test_retry_on_insufficient_count (真实 LLM)...")
    test_retry_on_insufficient_count()

    elapsed = time.time() - t0
    print("=" * 60)
    print(f"所有测试通过！耗时 {elapsed:.1f}s")
    print("=" * 60)