"""英文查词：音标 + 中文释义。

数据源（都不需要 API key）：
1. 有道 `dict.youdao.com/jsonapi` —— 有中文释义、响应快（实测 ~140ms）
2. `api.dictionaryapi.dev` —— 官方免费接口，只有英文释义、偏慢（~1.3s），当兜底
3. 都失败返回空 dict —— 前端只保留发音按钮，不影响做题

**只在用户点开词条时才查**（钩子只给 ``dictUrl``）。题目列表一次 20 题、每题
好几个生词，如果在钩子里同步查会拖慢首屏。

缓存是进程内的简单 LRU：同一个词在会话里只查一次。
"""

from __future__ import annotations

import json
import logging
import threading
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

_CACHE: dict[str, dict] = {}
_CACHE_ORDER: list[str] = []
_CACHE_MAX = 500
_LOCK = threading.Lock()
_TIMEOUT = 4

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Zhishi/0.1"


def _http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


# ---- 有道 ----


def _extract_meanings(node: object) -> list[str]:
    """从有道那种嵌套结构里把释义文本掏出来。

    实测结构比文档深好几层：:

        "trs": [{"tr": [{"l": {"sentence": [], "i": ["v. 抛弃，遗弃…"]}}]}]

    所以按 dict / list / str 递归找 ``i``；``l.sentence`` 是例句，不取。
    """
    if isinstance(node, str):
        return [node] if node.strip() else []
    if isinstance(node, list):
        out: list[str] = []
        for item in node:
            out.extend(_extract_meanings(item))
        return out
    if isinstance(node, dict):
        if "i" in node:
            return _extract_meanings(node["i"])
        if "l" in node:
            return _extract_meanings(node["l"])
    return []


def _youdao_meanings(item: dict) -> list[str]:
    """从有道 ``ec.word[0].trs`` 里抽释义（去重、保序）。"""
    out: list[str] = []
    for tr in item.get("trs") or []:
        node = tr.get("tr") if isinstance(tr, dict) else tr
        for text in _extract_meanings(node):
            line = text.strip()
            if line and line not in out:
                out.append(line)
    return out


def _from_youdao(word: str) -> dict:
    url = "https://dict.youdao.com/jsonapi?q=" + urllib.parse.quote(word)
    data = _http_json(url)
    entries = (data.get("ec") or {}).get("word") or []
    if not entries:
        return {}
    item = entries[0]
    phonetic = (item.get("usphone") or item.get("ukphone") or "").strip()
    meanings = _youdao_meanings(item)
    if not phonetic and not meanings:
        return {}
    return {
        "word": word,
        "phonetic": f"/{phonetic}/" if phonetic else None,
        "meanings": meanings[:5],
    }


# ---- dictionaryapi.dev ----


def _from_dictionaryapi(word: str) -> dict:
    url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + urllib.parse.quote(word)
    data = _http_json(url)
    if not isinstance(data, list) or not data:
        return {}
    first = data[0] or {}
    phonetic = str(first.get("phonetic") or "").strip()
    if not phonetic:
        for item in first.get("phonetics") or []:
            text = str((item or {}).get("text") or "").strip()
            if text:
                phonetic = text
                break
    meanings: list[str] = []
    for block in first.get("meanings") or []:
        pos = str((block or {}).get("partOfSpeech") or "").strip()
        for defn in (block or {}).get("definitions") or []:
            text = str((defn or {}).get("definition") or "").strip()
            if not text:
                continue
            line = f"{pos}. {text}" if pos else text
            if line not in meanings:
                meanings.append(line)
            if len(meanings) >= 5:
                break
        if len(meanings) >= 5:
            break
    if not phonetic and not meanings:
        return {}
    return {
        "word": word,
        "phonetic": phonetic or None,
        "meanings": meanings[:5],
    }


# ---- 对外 ----


def _cache_put(word: str, data: dict) -> None:
    with _LOCK:
        if word not in _CACHE:
            _CACHE_ORDER.append(word)
        _CACHE[word] = data
        while len(_CACHE_ORDER) > _CACHE_MAX:
            old = _CACHE_ORDER.pop(0)
            _CACHE.pop(old, None)


def lookup(word: str) -> dict:
    """查一个英文词，返回 ``{word, phonetic, meanings}``；查不到返回空 dict。"""
    key = (word or "").strip().lower()
    if not key or len(key) > 40:
        return {}
    with _LOCK:
        cached = _CACHE.get(key)
    if cached is not None:
        return cached

    data: dict = {}
    for source in (_from_youdao, _from_dictionaryapi):
        try:
            data = source(key)
        except Exception:
            logger.debug("查词源 %s 失败：%s", source.__name__, key, exc_info=True)
            data = {}
        if data:
            break

    _cache_put(key, data)
    return data


def cache_size() -> int:
    with _LOCK:
        return len(_CACHE)
