"""知识库 schemas（对齐前端 types：KbCollection/KnowledgeDoc/DocumentSegment/Citation 等）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class KbCollection(BaseModel):
    id: str
    name: str
    zone: str = "study"
    description: Optional[str] = None
    dataset_id: Optional[str] = None
    is_default: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class CollectionCreate(BaseModel):
    name: str
    zone: str = "study"
    description: Optional[str] = None


class CollectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class CollectionList(BaseModel):
    collections: list[KbCollection]
    total: int


class KnowledgeDoc(BaseModel):
    id: str
    name: str
    type: str = "txt"
    tags: list[str] = []
    status: str = "pending"
    segment_status: Optional[str] = None
    question_gen_status: Optional[str] = None
    ocr_status: Optional[str] = None
    ocr_current_page: Optional[int] = None
    ocr_total_pages: Optional[int] = None
    pdf_page_count: Optional[int] = None
    warning: Optional[str] = None
    questionCount: Optional[int] = None
    zone: Optional[str] = None
    wordCount: int = 0
    updatedAt: Optional[datetime] = None


class DocumentSegment(BaseModel):
    id: str
    document_id: str
    order_index: int
    title: Optional[str] = None
    content: str
    char_start: int = 0
    char_end: int = 0
    created_at: Optional[datetime] = None


class Citation(BaseModel):
    doc_id: str
    segment_id: Optional[str] = None
    title: Optional[str] = None
    char_start: Optional[int] = None
    char_end: Optional[int] = None
    snippet: Optional[str] = None


class UploadResult(BaseModel):
    message: str
    batch_id: str
    document_id: Optional[str] = None
    id: Optional[str] = None
    file_name: Optional[str] = None
    dataset_id: Optional[str] = None
    collection_id: Optional[str] = None
    status: str = "pending"
    ocr_processed: Optional[bool] = None
    warning: Optional[str] = None
    ocr_status: Optional[str] = None
    ocr_current_page: Optional[int] = None
    ocr_total_pages: Optional[int] = None
    completed_tasks: Optional[list[dict]] = None


class DocumentStatus(BaseModel):
    batch_id: str
    status: str
    error_message: Optional[str] = None
    completed_segments: Optional[int] = None
    total_segments: Optional[int] = None
    ocr_status: Optional[str] = None
    ocr_current_page: Optional[int] = None
    ocr_total_pages: Optional[int] = None
    completed_tasks: Optional[list[dict]] = None


class DeleteResult(BaseModel):
    message: str
    doc_id: Optional[str] = None


class DocumentContentMeta(BaseModel):
    doc_id: str
    file_name: Optional[str] = None
    content: str
    file_type: Optional[str] = None
    preview_mode: Optional[str] = None  # pdf/docx/markdown/text
    has_raw_file: Optional[bool] = None
    is_scanned_pdf: Optional[bool] = None
    mock: Optional[bool] = None
    pdf_page_count: Optional[int] = None
    warning: Optional[str] = None


class DocumentPage(BaseModel):
    page_number: int
    title: Optional[str] = None
    preview: str = ""
    char_start: Optional[int] = None
    char_end: Optional[int] = None
    content_length: int = 0
    has_builtin_questions: bool = False
    is_key_page: bool = False
    segment_id: Optional[str] = None
    preview_mode: Optional[str] = None
    file_type: Optional[str] = None
    question_count: int = 0


class DocumentPageDetail(DocumentPage):
    content: str = ""


class DocumentPageList(BaseModel):
    document_id: str
    document_name: Optional[str] = None
    total_pages: int
    has_page_markers: bool = False
    preview_mode: Optional[str] = None
    file_type: Optional[str] = None
    has_raw_file: Optional[bool] = None
    pages: list[DocumentPage]


class DocumentSegmentList(BaseModel):
    document_id: str
    segment_status: Optional[str] = None
    total: int
    segments: list[DocumentSegment]


class DocumentImageItem(BaseModel):
    file_name: str
    page_num: int = 0
    url_path: str


class DocumentImageList(BaseModel):
    document_id: str
    images: list[DocumentImageItem]


class KbConfig(BaseModel):
    rag_backend: str = "chroma"
    use_oss: bool = False
    max_upload_size: int = 0
    max_upload_size_display: str = ""
    supported_extensions: list[str] = []
    max_questions_per_document: Optional[int] = None
    max_pages_per_gen: Optional[int] = None
    question_gen_max_concurrency: Optional[int] = None


class ImportPackageResult(BaseModel):
    status: str
    document_id: Optional[str] = None
    imported_questions: Optional[int] = None
    reused_questions: Optional[int] = None


class LearningPathChapter(BaseModel):
    id: str = ""
    title: str = ""
    order: int = 0
    key_points: list[str] = []
    learned: bool = False


class LearningPathResult(BaseModel):
    document_id: str
    status: str = "missing"  # missing/pending/generated/failed
    title: Optional[str] = None
    chapters: list[LearningPathChapter] = []
