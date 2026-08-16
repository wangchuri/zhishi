"""AI 对话 / 伴学 / 笔记 schemas。"""

from __future__ import annotations
from datetime import datetime

from typing import Optional

from pydantic import BaseModel


# ---- 对话 ----

class ChatSend(BaseModel):
    content: str
    session_id: Optional[str] = None
    collection_id: Optional[str] = None
    stream: bool = False


class ChatSessionMeta(BaseModel):
    id: str
    title: str = "对话"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    message_count: int = 0


class ChatHistory(BaseModel):
    session_id: str
    messages: list[dict] = []


class ChatSessionList(BaseModel):
    sessions: list[ChatSessionMeta] = []


# ---- 伴学 ----

class CompanionSend(BaseModel):
    document_id: str
    content: str
    page_number: Optional[int] = None
    page_content: Optional[str] = None


class CompanionMessage(BaseModel):
    role: str
    content: str
    created_at: Optional[datetime] = None
    citations: Optional[list[dict]] = None


class CompanionHistory(BaseModel):
    document_id: str
    document_name: Optional[str] = None
    updated_at: Optional[datetime] = None
    messages: list[CompanionMessage] = []


# ---- 笔记 ----

class NoteTipCreate(BaseModel):
    document_id: str
    page_number: Optional[int] = None
    title: str
    content: str


class NoteItem(BaseModel):
    id: str
    title: Optional[str] = None
    content_md: Optional[str] = None
    note_type: str = "manual"
    document_id: Optional[str] = None
    page_number: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class NoteListResult(BaseModel):
    notes: list[NoteItem]
    total: int = 0
