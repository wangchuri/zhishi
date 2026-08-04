"""
Prompt 模板加载器 — 以 md/j2 文件管理所有 Agent / LLM 提示词。

约定：
- `prompts/<module>/<name>.md`      纯文本模板（markdown）
- `prompts/<module>/<name>.md.j2`   Jinja2 模板（可注入变量）
- 修改模板文件即可迭代提示词，无需改代码
"""
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from jinja2 import Environment, FileSystemLoader, StrictUndefined

logger = logging.getLogger(__name__)

# prompts/ 根目录（backend/prompts）
PROMPTS_ROOT = Path(__file__).resolve().parent.parent.parent / "prompts"

_env = Environment(
    loader=FileSystemLoader(str(PROMPTS_ROOT)),
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
    autoescape=False,
)


def render_prompt(
    name: str,
    *,
    variables: Optional[Dict[str, Any]] = None,
    jinja: bool = True,
) -> str:
    """渲染并返回提示词模板内容。

    Args:
        name: 相对 prompts/ 的模板路径，如 "chat/zhishi_agent.md.j2"
        variables: Jinja2 模板变量（非模板文件可忽略）
        jinja: False 时直接读取文件内容（跳过渲染）
    """
    variables = variables or {}
    template = _env.get_template(name)
    try:
        return template.render(**variables).strip() + "\n"
    except Exception as e:
        logger.error("渲染 prompt %s 失败: %s", name, e)
        raise


def load_prompt(name: str) -> str:
    """读取纯文本 prompt（不渲染）。"""
    template = _env.get_template(name)
    return template.render().strip() + "\n"
