"""Prompt 模板服务测试 — 加载与渲染。"""
import pytest

from app.services import prompt_service
from app.services.prompt_service import load_prompt, render_prompt


def test_load_plain_prompt():
    txt = load_prompt("chat/zhishi_agent.md.j2")
    assert "Tina" in txt
    assert "知识库" in txt


def test_render_with_variables():
    out = render_prompt(
        "chat/zhishi_rag_context.md.j2",
        variables={
            "knowledge_context": "片段1",
            "user_message": "什么是微积分",
        },
    )
    assert "片段1" in out
    assert "什么是微积分" in out


def test_question_gen_prompt_keeps_literal_braces():
    # 模板中字面 {{blank}} 不能被 jinja 当作变量解析
    txt = load_prompt("question_gen/generate_questions.md.j2")
    assert "{{blank}}" in txt


def test_missing_template_raises():
    with pytest.raises(Exception):
        load_prompt("not_exists/foo.md.j2")


def test_undefined_variable_raises():
    with pytest.raises(Exception):
        render_prompt(
            "chat/zhishi_rag_context.md.j2",
            variables={},  # knowledge_context / user_message 缺失
        )


def test_grade_prompt_render():
    out = render_prompt(
        "quiz/grade_prompt.md.j2",
        variables={
            "type_label": "填空题",
            "stem": "___ 是首都",
            "correct_display": "北京",
            "user_answer": "上海",
        },
    )
    assert "北京" in out
    assert "上海" in out


def test_dashboard_user_prompt_render():
    out = render_prompt(
        "dashboard/suggestions_user.md.j2",
        variables={"doc_lines": ["- a.md", "- b.md"]},
    )
    assert "a.md" in out
    assert "b.md" in out


def test_system_prompts_loaded_from_templates():
    from app.agents import training_agent, zhishi_agent
    from app.agents.question_gen_agent import GENERATE_SYSTEM_PROMPT
    from app.services.quiz_service import GRADE_AI_SYS_PROMPT
    from app.services.report_service import REPORT_SYSTEM_PROMPT
    from app.services.tutor_service import SOCRATIC_RULES

    assert "Tina" in zhishi_agent.SYSTEM_PROMPT
    assert "出题" in GENERATE_SYSTEM_PROMPT
    assert "训练" in training_agent.SYSTEM_PROMPT
    assert "判题" in GRADE_AI_SYS_PROMPT
    assert "学习报告" in REPORT_SYSTEM_PROMPT
    assert "苏格拉底" in SOCRATIC_RULES
