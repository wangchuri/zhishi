"""知识库 + 图床：集合、全局文件去重、文档、分段、图片注册表。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _default_ts() -> datetime:
    return datetime.now(timezone.utc)


class KBCollection(Base):
    """知识库分区（学习区/生活区）。"""

    __tablename__ = "kb_collections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # 旧库 kb_collections.user_id NOT NULL；单用户默认 1
    user_id: Mapped[int] = mapped_column(Integer, default=1)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    zone: Mapped[str] = mapped_column(String(20), nullable=False, default="study")
    description: Mapped[str | None] = mapped_column(String(500))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class DocumentGroup(Base):
    """资料组：学习区内的系列（如「英语真题」下挂各年 PDF）。"""

    __tablename__ = "document_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[int] = mapped_column(Integer, default=1)
    collection_id: Mapped[str | None] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500))
    cover_document_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class GlobalDocument(Base):
    """全局文件去重（相同内容只存一份）。"""

    __tablename__ = "global_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    content_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(100))
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    parsed_text_path: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Document(Base):
    """用户文档。"""

    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # 旧库 documents.user_id NOT NULL + FK；单用户默认 1，避免 INSERT 失败
    user_id: Mapped[int] = mapped_column(Integer, default=1)
    collection_id: Mapped[str | None] = mapped_column(String(36), index=True)
    group_id: Mapped[str | None] = mapped_column(String(36), index=True)
    global_document_id: Mapped[str | None] = mapped_column(String(36), index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    zone: Mapped[str] = mapped_column(String(20), nullable=False, default="study")
    content_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    file_type: Mapped[str | None] = mapped_column(String(20))
    pdf_page_count: Mapped[int | None] = mapped_column(Integer)
    is_scanned_pdf: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[str | None] = mapped_column(Text)
    indexing_status: Mapped[str] = mapped_column(String(20), default="pending")
    segment_status: Mapped[str] = mapped_column(String(20), default="not_started")
    question_gen_status: Mapped[str] = mapped_column(String(20), default="not_started")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class DocumentSegment(Base):
    """文档分段（citation 定位 / 辅导上下文）。"""

    __tablename__ = "document_segments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str | None] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    char_start: Mapped[int] = mapped_column(Integer, default=0)
    char_end: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class DocumentImage(Base):
    """图床注册表：记录每张图片的归属与路径。"""

    __tablename__ = "document_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    page_num: Mapped[int] = mapped_column(Integer, default=0)
    image_index: Mapped[int] = mapped_column(Integer, default=0)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    relative_path: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
