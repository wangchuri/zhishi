"""英语插件：给英文题挂发音和生词。

第一版**不依赖任何外部服务**：
- 发音交给浏览器 / 系统 TTS（Web Speech API），插件只给 ``{text, lang}``；
  以后要接真人录音或云端 TTS，把 ``audio.src`` 填上，前端会自动优先用 src。
- 生词是从题干里抽出来的（去停用词、去重、按出现顺序取前几个），
  音标和释义等接了词典再补。

产出挂在实体的 ``extensions.english`` 上，前端用内置的
``AudioButton`` / ``WordChip`` 渲染——插件不碰前端代码。
"""

from __future__ import annotations

import re

from ...hooks import add_extension

PLUGIN = {
    "id": "english",
    "name": "英语",
    "description": "英文题的发音与生词（浏览器 TTS，无需联网）",
    "default_enabled": True,
}

# 英文题判定：ASCII 字母占「字母 + 汉字」的比例
_EN_RATIO_THRESHOLD = 0.45
# 抽生词：4 个字母以上，允许连字符和撇号（well-known / don't）
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]{3,}")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")

# 高频词不当作生词
_STOPWORDS = frozenset(
    """
    that this these those with without from into onto about above after again
    against because before being below between both each every other some such
    than then them they their theirs there here when where which while whose
    what will would should could shall must have has had having does done doing
    been were was are is are not neither either very much many more most less
    least also just only even still yet ever never always often sometimes
    """.split()
)

_MAX_WORDS = 4


def _english_ratio(text: str) -> float:
    letters = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    cjk = len(_CJK_RE.findall(text))
    total = letters + cjk
    return (letters / total) if total else 0.0


def _plain_text(text: str) -> str:
    """朗读用的纯文本：去掉公式、markdown 标记、连续空白。"""
    text = re.sub(r"\$\$[\s\S]*?\$\$", " ", text or "")
    text = re.sub(r"\$[^$\n]+\$", " ", text)
    text = re.sub(r"[`*_>#\[\]()|]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _keywords(text: str, limit: int = _MAX_WORDS) -> list[str]:
    seen: list[str] = []
    for raw in _WORD_RE.findall(text or ""):
        word = raw.strip("'-").lower()
        if len(word) < 4 or word in _STOPWORDS or word in seen:
            continue
        seen.append(word)
        if len(seen) >= limit:
            break
    return seen


def attach_english_extras(payload: dict) -> dict:
    """钩子：题目要发给前端前，英文题挂上发音按钮和生词。

    **不在这里查词典**——题目列表一次 20 题、每题好几个生词，同步查会拖慢首屏。
    只给每个词一个 ``dictUrl``，用户点开时才查（见 ``dict.py``）。
    """
    if not isinstance(payload, dict):
        return payload

    stem = str(payload.get("stem") or "")
    option_text = " ".join(
        str(opt.get("text") or "")
        for opt in (payload.get("options") or [])
        if isinstance(opt, dict)
    )
    sample = f"{stem} {option_text}".strip()
    if not sample or _english_ratio(sample) < _EN_RATIO_THRESHOLD:
        return payload

    spoken = _plain_text(stem)
    data: dict = {}
    if spoken:
        data["audio"] = [{"label": "朗读题干", "text": spoken, "lang": "en-US"}]

    words = _keywords(sample)
    if words:
        data["words"] = [
            {
                "word": word,
                "audio": {"text": word, "lang": "en-US"},
                # 前端点开时才请求，避免首屏一次查几十个词
                "dictUrl": f"/api/v1/plugins/{PLUGIN['id']}/dict?word={word}",
            }
            for word in words
        ]

    if not data:
        return payload
    return add_extension(payload, PLUGIN["id"], data)


def dict_endpoint(word: str = "") -> dict:
    """GET /api/v1/plugins/english/dict?word=xxx —— 查音标和中文释义。"""
    from .dict import lookup

    return lookup(word)


def register(api) -> None:
    api.route("/dict", dict_endpoint)
    api.on("question.presented", attach_english_extras)
    api.prompt_section(
        "用户问到英语题时：先说明题干在问什么，讲生词给中文释义，"
        "需要发音时提醒用户点题干旁的发音按钮（不要用音标符号硬凑）。"
    )
