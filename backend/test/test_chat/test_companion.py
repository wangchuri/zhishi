"""伴学对话服务测试 — 按书持久化、会话隔离、系统提示词占位渲染。"""
import pytest

from app.services import companion_service
from app.services.prompt_service import render_prompt
from app.services.storage_service import storage_service


def test_system_prompt_renders_placeholders():
    out = render_prompt(
        "companion/chat.md.j2",
        variables={
            "document_name": "高数",
            "page_number": 3,
            "page_content": "导数的定义",
        },
    )
    assert "高数" in out
    assert "第 3 页" in out
    assert "导数的定义" in out


def test_session_initially_empty(db, user, study_doc):
    session = companion_service.get_session(db, user.id, study_doc.id)
    assert session["meta"]["document_id"] == study_doc.id
    assert session["meta"]["document_name"] == study_doc.display_name
    assert session["messages"] == []


def test_append_message_persists(db, user, study_doc):
    companion_service._append_message(db, user.id, study_doc.id, "user", "什么是导数？")
    companion_service._append_message(db, user.id, study_doc.id, "assistant", "导数是变化率。")

    session = companion_service.get_session(db, user.id, study_doc.id)
    assert len(session["messages"]) == 2
    assert session["messages"][0]["role"] == "user"
    assert session["messages"][0]["content"] == "什么是导数？"
    assert session["messages"][1]["role"] == "assistant"

    # 从存储重新读取（模拟重启）
    raw = storage_service.load_companion_history(user.id, study_doc.id)
    assert raw is not None
    assert len(raw["messages"]) == 2


def test_sessions_isolated_by_document(db, user, study_collection):
    from helpers import make_document

    doc_a = make_document(db, user, study_collection, content_hash="hash_comp_a", display_name="a.md")
    doc_b = make_document(db, user, study_collection, content_hash="hash_comp_b", display_name="b.md")

    companion_service._append_message(db, user.id, doc_a.id, "user", "A 的问题")
    session_a = companion_service.get_session(db, user.id, doc_a.id)
    session_b = companion_service.get_session(db, user.id, doc_b.id)

    assert len(session_a["messages"]) == 1
    assert len(session_b["messages"]) == 0


def test_stream_reply_saves_messages_and_updates_system_prompt(db, user, study_doc, monkeypatch):
    captured = {}

    async def fake_predict_stream(message, collection_id=None, db=None, **kw):
        captured["message"] = message
        yield {"role": "assistant", "content": "第一段"}
        yield {"role": "assistant", "content": "第二段"}

    class FakeAgent:
        is_ready = True
        prompt = None

        def set_system_prompt(self, p):
            self.prompt = p
            captured["prompt"] = p

        async def predict_stream(self, message, collection_id=None, db=None):
            async for c in fake_predict_stream(message, collection_id=collection_id, db=db):
                yield c

    monkeypatch.setattr(companion_service, "_get_agent", lambda uid, ds="": FakeAgent())

    async def run():
        chunks = []
        async for c in companion_service.stream_companion_reply(
            db, user.id, study_doc.id, "这页讲了什么？", 2, "极限的定义"
        ):
            chunks.append(c)
        return chunks

    import asyncio

    chunks = asyncio.run(run())

    full = "".join(c["content"] for c in chunks)
    assert full == "第一段第二段"

    # 系统提示词已按页码占位渲染
    assert captured["prompt"] is not None
    assert "第 2 页" in captured["prompt"]
    assert "极限的定义" in captured["prompt"]

    # user + assistant 两条消息已持久化
    session = companion_service.get_session(db, user.id, study_doc.id)
    assert len(session["messages"]) == 2
    assert session["messages"][0]["content"] == "这页讲了什么？"
    assert session["messages"][1]["content"] == "第一段第二段"


def test_stream_reply_agent_unavailable(db, user, study_doc, monkeypatch):
    class NoAgent:
        is_ready = False

    monkeypatch.setattr(companion_service, "_get_agent", lambda uid, ds="": NoAgent())

    import asyncio

    async def run():
        chunks = []
        async for c in companion_service.stream_companion_reply(
            db, user.id, study_doc.id, "hi", 1, ""
        ):
            chunks.append(c)
        return chunks

    chunks = asyncio.run(run())
    assert "AI 服务暂时不可用" in chunks[0]["content"]
    session = companion_service.get_session(db, user.id, study_doc.id)
    assert len(session["messages"]) == 2  # user + error assistant
