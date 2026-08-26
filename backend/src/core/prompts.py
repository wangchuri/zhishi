"""从 backend/prompts 加载 / 渲染 Agent 提示词（md / md.j2）。"""

from __future__ import annotations

from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .paths import resource_dir

_PROMPTS_ROOT = resource_dir() / "prompts"

_env = Environment(
    loader=FileSystemLoader(str(_PROMPTS_ROOT)),
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
    autoescape=False,
)


def render_prompt(name: str, **variables: Any) -> str:
    """渲染 `prompts/` 下的 Jinja 模板，如 `question_gen/generate_questions.md.j2`。"""
    template = _env.get_template(name)
    return template.render(**variables).strip() + "\n"


def load_prompt(name: str) -> str:
    """读取模板（不含变量；含 `{% raw %}` 的文件也可直接加载）。"""
    return render_prompt(name)
